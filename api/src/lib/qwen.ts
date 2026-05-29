/**
 * qwen API 封装（阿里百练 OpenAI 兼容模式）
 *
 * MODEL_SERVER: https://dashscope.aliyuncs.com/compatible-mode/v1
 * MODEL: qwen3.5-27b
 */

// 配置（从环境变量读取，fallback 到默认值便于测试）
const QWEN_API_KEY = process.env.QWEN_API_KEY || "";
const QWEN_API_URL = process.env.QWEN_API_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const QWEN_MODEL = process.env.QWEN_MODEL || "qwen3.5-27b";

interface QwenMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface QwenResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface QwenCallOptions {
  /** 用户提示词（system 角色已固定为"你是一个有用的助手"） */
  prompt: string;
  /** 温度，默认 0.1（分类任务需要稳定） */
  temperature?: number;
  /** 超时毫秒，默认 60000 */
  timeoutMs?: number;
  /** 最大 token，默认 2048 */
  maxTokens?: number;
}

export interface QwenCallResult {
  /** 模型原始回答文本 */
  answer: string;
  /** token 用量 */
  usage?: { prompt: number; completion: number; total: number };
}

/**
 * 调用 qwen API
 */
export async function callQwen(options: QwenCallOptions): Promise<QwenCallResult> {
  const { prompt, temperature = 0.1, timeoutMs = 60000, maxTokens = 2048 } = options;

  if (!QWEN_API_KEY) {
    throw new Error("QWEN_API_KEY not configured");
  }

  const messages: QwenMessage[] = [
    { role: "system", content: "你是一个有用的助手。请严格按照用户要求的格式输出。" },
    { role: "user", content: prompt },
  ];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(QWEN_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${QWEN_API_KEY}`,
      },
      body: JSON.stringify({
        model: QWEN_MODEL,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`qwen API error: ${resp.status} ${body.slice(0, 200)}`);
    }

    const data = (await resp.json()) as QwenResponse;
    const answer = data.choices?.[0]?.message?.content?.trim() || "";

    return {
      answer,
      usage: data.usage
        ? {
            prompt: data.usage.prompt_tokens,
            completion: data.usage.completion_tokens,
            total: data.usage.total_tokens,
          }
        : undefined,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`qwen API timeout after ${timeoutMs}ms`);
    }
    throw err;
  }
}

// ==================== JSON 解析容错工具 ====================

/**
 * 从模型回答中提取 JSON 对象（去除 markdown 代码块等）
 */
export function extractJsonFromAnswer(answer: string): unknown {
  const trimmed = answer.trim();

  // 1. 去除 markdown 代码块
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  let candidate = codeBlockMatch ? codeBlockMatch[1].trim() : trimmed;
  candidate = candidate.replace(/^json\s*/i, "");

  // 2. 尝试直接解析
  try {
    return JSON.parse(candidate);
  } catch {
    // continue
  }

  // 3. 从文本中提取 {...} 块
  const objectMatch = candidate.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      // continue
    }
  }

  return null;
}

/**
 * 安全解析意图分类 JSON
 */
export function parseIntentClassification(answer: string): {
  intent: string;
  params: Record<string, unknown>;
  missingParams: string[];
  confidence: number;
} | null {
  const parsed = extractJsonFromAnswer(answer);
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;

  const intent = typeof obj.intent === "string" ? obj.intent : "unknown";
  const params = typeof obj.params === "object" && obj.params !== null
    ? (obj.params as Record<string, unknown>)
    : {};
  const missingParams = Array.isArray(obj.missingParams)
    ? (obj.missingParams as string[])
    : [];
  const confidence = typeof obj.confidence === "number" ? obj.confidence : 0;

  return { intent, params, missingParams, confidence };
}

/**
 * 安全解析 requirement 生成 JSON
 */
export function parseRequirementData(answer: string): {
  name: string;
  description: string;
  applicationScenario: string;
} | null {
  const parsed = extractJsonFromAnswer(answer);
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;

  const name = typeof obj.name === "string" ? obj.name : "";
  const description = typeof obj.description === "string" ? obj.description : "";
  const applicationScenario = typeof obj.applicationScenario === "string"
    ? obj.applicationScenario
    : "";

  if (!name && !description) return null;

  return { name, description, applicationScenario };
}
