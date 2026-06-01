import type { CapabilityContract, Observation } from "../actions/contracts/types.js";
import {
  buildCompactCatalog,
  filterCatalogByNames,
} from "../actions/contracts/buildToolCatalog.js";
import type { LLMMessage } from "./llmClient.js";

// ============================================================
// Agent Prompt 构建器
// ============================================================

/**
 * 构建 Agent 决策所需的 LLM prompt。
 */
export function buildAgentMessages(
  query: string,
  observations: Observation[],
  candidateContracts: CapabilityContract[],
  allContracts: Map<string, CapabilityContract>
): LLMMessage[] {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(query, observations, candidateContracts, allContracts);

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
}

// ============================================================
// System Prompt
// ============================================================

function buildSystemPrompt(): string {
  return [
    "你是一个智能体决策助手。你的任务是根据用户的原始请求和已收集的观察结果，决定下一步行动。",
    "",
    "## 可用决策类型",
    "",
    '1. **tool_call** — 调用一个工具继续收集信息',
    '   { "decision": "tool_call", "reason": "为什么调用这个工具", "tool": "工具名", "params": { "参数": "值" } }',
    "",
    '2. **final_answer** — 已有足够信息，直接给出最终回答',
    '   { "decision": "final_answer", "reason": "为什么可以直接回答", "finalText": "最终回答内容" }',
    "",
    '3. **legacy_fallback** — 请求超出当前工具能力，回退到旧系统处理',
    '   { "decision": "legacy_fallback", "reason": "为什么需要回退" }',
    "",
    "## 决策规则",
    "",
    "- 优先使用工具收集信息，直到有足够数据再给出 final_answer",
    "- 不要重复调用同一个工具（如果 observations 中已有该工具的结果）",
    "- 如果候选工具不足以回答用户请求，选择 legacy_fallback",
    "- 回答使用用户提问的语言（中文或英文）",
    "- 所有响应必须是合法的 JSON 对象",
    "",
    "## 输出格式",
    "",
    "必须返回严格的 JSON，不要包含 markdown 代码块标记或其他额外文本。",
  ].join("\n");
}

// ============================================================
// User Prompt
// ============================================================

function buildUserPrompt(
  query: string,
  observations: Observation[],
  candidateContracts: CapabilityContract[],
  allContracts: Map<string, CapabilityContract>
): string {
  const parts: string[] = [];

  // 1. 用户原始请求
  parts.push("## 用户请求");
  parts.push(query);
  parts.push("");

  // 2. 已收集的观察结果
  parts.push("## 已收集的观察结果");
  if (observations.length === 0) {
    parts.push("（暂无）");
  } else {
    for (const [i, obs] of observations.entries()) {
      parts.push("");
      parts.push(`### Observation ${i + 1}: ${obs.toolName}`);
      if (obs.success && obs.result) {
        const result = obs.result as Record<string, unknown>;
        parts.push(summarizeResult(result));
      } else if (obs.error) {
        parts.push(`执行失败：${obs.error}`);
      }
    }
  }
  parts.push("");

  // 3. 候选工具
  const catalog = buildCompactCatalog(allContracts);
  const filtered = filterCatalogByNames(
    catalog,
    candidateContracts.map((c) => c.name)
  );

  parts.push(`## 可用候选工具（${filtered.tools.length} 个）`);
  parts.push("");
  for (const tool of filtered.tools) {
    parts.push(`### ${tool.name}`);
    parts.push(`- 描述：${tool.description}`);
    parts.push(`- 何时使用：${tool.whenToUse}`);
    if (tool.avoidWhen) {
      parts.push(`- 何时避免：${tool.avoidWhen}`);
    }
    parts.push(`- 参数结构：`);
    parts.push("```json");
    parts.push(JSON.stringify(tool.inputSchema, null, 2));
    parts.push("```");
    if (tool.examples && tool.examples.length > 0) {
      parts.push(`- 示例：${JSON.stringify(tool.examples[0].toolInput)}`);
    }
    parts.push("");
  }

  // 4. 决策指令
  parts.push("---");
  parts.push("请基于以上信息，返回一个 JSON 决策对象。");
  parts.push(
    observations.length === 0
      ? "这是第一步，还没有任何观察结果。"
      : `当前已执行 ${observations.length} 步。`
  );
  parts.push("如果信息已足够，请直接返回 final_answer。");
  parts.push("如果还需要更多信息，请返回 tool_call 调用一个工具。");

  return parts.join("\n");
}

// ============================================================
// 结果摘要（避免 prompt 过长）
// ============================================================

function summarizeResult(result: Record<string, unknown>): string {
  const parts: string[] = [];

  if (typeof result.message === "string") {
    parts.push(result.message);
  }

  if (typeof result.overview === "string") {
    parts.push(`概览：${result.overview}`);
  }

  if (typeof result.summary === "string") {
    parts.push(`摘要：${result.summary.slice(0, 200)}`);
  }

  if (Array.isArray(result.articles)) {
    const articles = result.articles as Array<Record<string, unknown>>;
    parts.push(`共 ${articles.length} 篇文章：`);
    for (const [i, a] of articles.slice(0, 3).entries()) {
      parts.push(`  ${i + 1}. ${a.title || "无标题"} (${a.source || "未知来源"})`);
    }
    if (articles.length > 3) {
      parts.push(`  ... 还有 ${articles.length - 3} 篇`);
    }
  }

  if (typeof result.description === "string") {
    parts.push(`描述：${result.description.slice(0, 200)}`);
  }

  if (typeof result.windSpeed === "number") {
    parts.push(`风速：${result.windSpeed} m/s，风向：${result.windDirection || "未知"}`);
  }

  // fallback：输出前 3 个字段的摘要
  if (parts.length === 0) {
    const keys = Object.keys(result).slice(0, 3);
    for (const key of keys) {
      const val = result[key];
      if (typeof val === "string") {
        parts.push(`${key}：${val.slice(0, 100)}`);
      } else if (typeof val === "number") {
        parts.push(`${key}：${val}`);
      }
    }
  }

  return parts.join("\n") || "（空结果）";
}
