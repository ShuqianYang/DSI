/**
 * Episode Extractor (P1-4) - LLM-based structured episode extraction.
 *
 * Now reuses the unified model adapter layer (MODEL_* / AGENT_MODEL_*).
 * Falls back to rule-based extraction when the configured model returns
 * invalid output. Invalid shared model configuration is surfaced to callers.
 */

import type { RememberInput } from "./memoryManager.js";
import type { AgentMessage, ToolObservation } from "./tools/_shared/types.js";
import { safeJsonStringify, truncateText } from "./tools/_shared/serialization.js";
import { loadModelConfig } from "./model/config.js";
import { createModelGateway } from "./model/modelGateway.js";
import type { ModelGatewayLike } from "./model/modelGateway.js";
import type { ModelConfig } from "./model/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedEpisode {
  /** 场景分类: 地震评估 / 溢油溯源 / 船舶追踪 / 日常监测 */
  scene: string;
  userQuery: string;
  toolSequence: Array<{
    toolName: string;
    inputParams: Record<string, unknown>;
    outputSummary: string;
    success: boolean;
  }>;
  finalResult: string;
  /** 重要性 0-1 */
  importance: number;
  tags: string[];
  relatedEntities: string[];
}

export interface EpisodeExtractor {
  extract(input: RememberInput): Promise<ExtractedEpisode>;
}

export interface CreateEpisodeExtractorInput {
  /** Optional explicit model config. When omitted, AGENT_MODEL_* / MODEL_* env vars are used. */
  config?: ModelConfig;
  /** Optional gateway instance for dependency injection / testing. */
  gateway?: ModelGatewayLike;
  logger?: Pick<Console, "warn">;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_FINAL_RESULT_CHARS = 300;
const MAX_OUTPUT_SUMMARY_CHARS = 200;
const MAX_CONVERSATION_CHARS = 8000;

const SYSTEM_PROMPT = `你是一个信息提取助手。你的任务是从智能体对话记录中提取结构化的情节记忆（episodic memory）。

请严格按照以下JSON Schema输出，不要输出任何其他内容：

{
  "scene": "string — 场景分类：地震评估/溢油溯源/船舶追踪/日常监测",
  "userQuery": "string — 用户原始查询",
  "toolSequence": [
    {
      "toolName": "string — 工具名称",
      "inputParams": "object — 工具输入参数",
      "outputSummary": "string — 工具输出摘要（200字以内）",
      "success": "boolean — 工具是否成功执行"
    }
  ],
  "finalResult": "string — 最终结果摘要（300字以内）",
  "importance": "number — 重要性评分0-1，1表示非常重要",
  "tags": ["string — 标签列表"],
  "relatedEntities": ["string — 相关实体（地点、船舶、组织等）"]
}

示例1（地震评估）：
{
  "scene": "地震评估",
  "userQuery": "评估台湾花莲7.2级地震的影响",
  "toolSequence": [
    {
      "toolName": "EarthquakeAssessment",
      "inputParams": { "magnitude": 7.2, "location": "花莲" },
      "outputSummary": "震中位于花莲以东30km，预计影响半径50km，人口暴露约20万",
      "success": true
    }
  ],
  "finalResult": "花莲7.2级地震，影响半径50km，建议启动二级应急响应",
  "importance": 0.9,
  "tags": ["地震", "花莲", "应急响应"],
  "relatedEntities": ["花莲", "台湾"]
}

示例2（溢油溯源）：
{
  "scene": "溢油溯源",
  "userQuery": "追踪东海海域溢油源头",
  "toolSequence": [
    {
      "toolName": "SatelliteImage",
      "inputParams": { "area": "东海", "date": "2026-06-15" },
      "outputSummary": "检测到溢油面积约5平方公里，位于28.5N 122.3E",
      "success": true
    },
    {
      "toolName": "AisQuery",
      "inputParams": { "lat": 28.5, "lon": 122.3, "radius": 10 },
      "outputSummary": "发现3艘船舶经过该区域，其中油轮MMSI:412000001轨迹吻合",
      "success": true
    }
  ],
  "finalResult": "溢油源头疑为油轮MMSI:412000001，建议进一步核查",
  "importance": 0.8,
  "tags": ["溢油", "东海", "油轮追踪"],
  "relatedEntities": ["东海", "MMSI:412000001"]
}

请只输出JSON，不要输出任何解释或markdown。`;

const RETRY_SUFFIX = "\n\n请只输出JSON，不要输出任何其他内容。";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createEpisodeExtractor(
  input?: CreateEpisodeExtractorInput
): EpisodeExtractor {
  const logger = input?.logger ?? console;
  const gateway = input?.gateway ?? createModelGateway(input?.config ?? loadModelConfig("AGENT"));

  return new LlmEpisodeExtractor(gateway, logger);
}

// ---------------------------------------------------------------------------
// LLM-based implementation
// ---------------------------------------------------------------------------

class LlmEpisodeExtractor implements EpisodeExtractor {
  constructor(
    private readonly gateway: ModelGatewayLike,
    private readonly logger: Pick<Console, "warn">
  ) {}

  async extract(input: RememberInput): Promise<ExtractedEpisode> {
    const conversationText = formatConversationForLlm(input);

    // First attempt
    let episode = await this.tryLlmExtract(conversationText, false);
    if (episode) return episode;

    // Retry with stricter instruction
    this.logger.warn("[EpisodeExtractor] first attempt failed, retrying with stricter prompt");
    episode = await this.tryLlmExtract(conversationText, true);
    if (episode) return episode;

    // Fallback to rule-based extraction
    this.logger.warn("[EpisodeExtractor] LLM extraction failed, using rule-based fallback");
    return ruleBasedExtract(input);
  }

  private async tryLlmExtract(
    conversationText: string,
    isRetry: boolean
  ): Promise<ExtractedEpisode | undefined> {
    try {
      const systemContent = isRetry
        ? SYSTEM_PROMPT + RETRY_SUFFIX
        : SYSTEM_PROMPT;

      const response = await this.gateway.generate({
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: conversationText },
        ],
        purpose: "text-generation",
        temperature: 0.1,
        maxTokens: 2048,
      });

      return parseEpisodeJson(response.content);
    } catch (error) {
      this.logger.warn(
        "[EpisodeExtractor] LLM call failed:",
        error instanceof Error ? error.message : String(error)
      );
      return undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// Rule-based fallback
// ---------------------------------------------------------------------------

function ruleBasedExtract(input: RememberInput): ExtractedEpisode {
  const toolSequence = extractToolSequenceFromInput(input);
  return {
    scene: "日常监测",
    userQuery: input.query,
    toolSequence,
    finalResult: truncateText(input.finalAnswer, MAX_FINAL_RESULT_CHARS),
    importance: 0.5,
    tags: [],
    relatedEntities: [],
  };
}

function extractToolSequenceFromInput(
  input: RememberInput
): ExtractedEpisode["toolSequence"] {
  const inputMap = new Map<string, Record<string, unknown>>();
  for (const msg of input.messages) {
    if (msg.role === "assistant" && msg.toolCalls) {
      for (const call of msg.toolCalls) {
        inputMap.set(call.id, call.input);
      }
    }
  }

  return input.observations.map((obs) => ({
    toolName: obs.toolName,
    inputParams: inputMap.get(obs.toolCallId) ?? {},
    outputSummary: truncateOutputSummary(obs.output),
    success: obs.ok,
  }));
}

function truncateOutputSummary(output: unknown): string {
  if (output === undefined || output === null) return "";
  const text = typeof output === "string" ? output : safeJsonStringify(output);
  return truncateText(text, MAX_OUTPUT_SUMMARY_CHARS);
}

// ---------------------------------------------------------------------------
// Conversation formatting
// ---------------------------------------------------------------------------

function formatConversationForLlm(input: RememberInput): string {
  const lines: string[] = [];
  lines.push(`用户查询: ${input.query}`);
  lines.push("");
  lines.push("对话记录:");

  for (const msg of input.messages) {
    const role = msg.role === "user" ? "用户" : msg.role === "assistant" ? "助手" : "工具";
    let content = msg.content ?? "";

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      const toolNames = msg.toolCalls.map((tc) => tc.toolName).join(", ");
      content = content || `(调用工具: ${toolNames})`;
    }

    if (msg.toolName) {
      content = `[${msg.toolName}] ${content}`;
    }

    lines.push(`${role}: ${content}`);
  }

  lines.push("");
  lines.push(`最终答案: ${input.finalAnswer}`);
  lines.push("");
  lines.push("请提取上述对话的结构化情节记忆。");

  const result = lines.join("\n");
  if (result.length <= MAX_CONVERSATION_CHARS) return result;
  return truncateText(result, MAX_CONVERSATION_CHARS);
}

// ---------------------------------------------------------------------------
// JSON parsing & validation
// ---------------------------------------------------------------------------

function parseEpisodeJson(content: string): ExtractedEpisode | undefined {
  // Try to extract JSON from the content (model may wrap in ```json blocks)
  const jsonStr = extractJsonString(content);
  if (!jsonStr) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }

  const obj = parsed as Record<string, unknown>;
  return validateEpisode(obj);
}

function extractJsonString(content: string): string | undefined {
  const trimmed = content.trim();

  // Try direct parse first
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  // Try extracting from ```json ... ``` blocks
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) {
    return codeBlockMatch[1].trim();
  }

  // Try finding the first { ... } pair
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return undefined;
}

function validateEpisode(obj: Record<string, unknown>): ExtractedEpisode | undefined {
  const scene = typeof obj.scene === "string" ? obj.scene : "日常监测";
  const userQuery = typeof obj.userQuery === "string" ? obj.userQuery : "";
  const finalResult =
    typeof obj.finalResult === "string"
      ? truncateText(obj.finalResult, MAX_FINAL_RESULT_CHARS)
      : "";

  const importance =
    typeof obj.importance === "number" && obj.importance >= 0 && obj.importance <= 1
      ? obj.importance
      : 0.5;

  const tags = Array.isArray(obj.tags)
    ? obj.tags.filter((t): t is string => typeof t === "string")
    : [];

  const relatedEntities = Array.isArray(obj.relatedEntities)
    ? obj.relatedEntities.filter((e): e is string => typeof e === "string")
    : [];

  const toolSequence = Array.isArray(obj.toolSequence)
    ? obj.toolSequence
        .filter((t): t is Record<string, unknown> => t !== null && typeof t === "object")
        .map((t) => ({
          toolName: typeof t.toolName === "string" ? t.toolName : "unknown",
          inputParams:
            t.inputParams && typeof t.inputParams === "object" && !Array.isArray(t.inputParams)
              ? (t.inputParams as Record<string, unknown>)
              : {},
          outputSummary:
            typeof t.outputSummary === "string"
              ? truncateText(t.outputSummary, MAX_OUTPUT_SUMMARY_CHARS)
              : "",
          success: typeof t.success === "boolean" ? t.success : false,
        }))
    : [];

  if (!userQuery) return undefined;

  return {
    scene,
    userQuery,
    toolSequence,
    finalResult,
    importance,
    tags,
    relatedEntities,
  };
}

export type { ModelConfig } from "./model/types.js";
export type { ModelGatewayLike } from "./model/modelGateway.js";
