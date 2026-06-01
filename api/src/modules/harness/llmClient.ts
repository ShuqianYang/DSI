/**
 * DeepSeek LLM 客户端（OpenAI 兼容 API）
 *
 * 参考项目内现有模式：planner/service.ts, router/service.ts, news.ts
 * 模型：deepseek-v4-flash
 */

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_API_URL =
  process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
const DEEPSEEK_TIMEOUT_MS = 120_000;

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * 调用 DeepSeek API。
 *
 * 兼容 OpenAI 格式：
 * {
 *   model: "deepseek-v4-flash",
 *   messages: [...],
 *   response_format: { type: "json_object" }
 * }
 */
export async function callDeepSeek(
  messages: LLMMessage[],
  options?: { temperature?: number; maxTokens?: number; jsonMode?: boolean }
): Promise<LLMResponse> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS);

  const body: Record<string, unknown> = {
    model: DEEPSEEK_MODEL,
    messages,
    stream: false,
    temperature: options?.temperature ?? 0.3,
    max_tokens: options?.maxTokens ?? 2048,
  };
  if (options?.jsonMode !== false) {
    body.response_format = { type: "json_object" };
  }

  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `DeepSeek API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
    const message = choice?.message as Record<string, unknown> | undefined;
    const content = (message?.content as string) || "";
    const usage = data.usage as
      | {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        }
      | undefined;

    return { content, usage };
  } finally {
    clearTimeout(timeout);
  }
}
