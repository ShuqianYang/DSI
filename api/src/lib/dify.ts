/**
 * Dify Chat App API 客户端
 * 统一处理 /chat-messages 的 streaming 响应
 */

export interface DifyChatOptions {
  apiKey: string;
  apiUrl: string; // base URL, e.g. https://api.dify.ai/v1
  query: string;
  inputs?: Record<string, unknown>;
  user?: string;
  conversationId?: string;
  timeoutMs?: number;
}

export interface DifyChatResult {
  answer: string;
  conversationId: string;
  messageId: string;
  taskId: string;
}

/**
 * 调用 Dify Chat App (Agent 模式)
 * Agent 模式强制 streaming，因此需要读取 SSE 流并拼接 answer
 */
export async function callDifyChat(options: DifyChatOptions): Promise<DifyChatResult> {
  const {
    apiKey,
    apiUrl,
    query,
    inputs = {},
    user = "system",
    conversationId = "",
    timeoutMs = 60_000,
  } = options;

  if (!apiKey) {
    throw new Error("Dify API key not configured");
  }

  // 自动拼接 /chat-messages
  const url = apiUrl.endsWith("/chat-messages")
    ? apiUrl
    : apiUrl.replace(/\/$/, "") + "/chat-messages";

  // 某些 Dify App 把 query 配置为 input form 变量，需要在 inputs 中提供
  const enrichedInputs = { ...inputs, query };
  const requestBody = {
    query,
    inputs: enrichedInputs,
    response_mode: "streaming",
    conversation_id: conversationId,
    user,
  };
  console.log(`[Dify] POST ${url} body preview:`, JSON.stringify(requestBody).slice(0, 500));

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(timeoutMs), // 默认 60s，可由调用方覆盖
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "unknown");
    throw new Error(`Dify API error: ${response.status} ${response.statusText} - ${errText}`);
  }

  if (!response.body) {
    throw new Error("Dify API returned empty body");
  }

  // 读取 SSE 流
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let answer = "";
  let finalConversationId = "";
  let finalMessageId = "";
  let finalTaskId = "";

  // 诊断用
  const eventsSeen: string[] = [];
  const unhandledSamples: Array<{ event: string; preview: string }> = [];
  let parseFailures = 0;
  const MAX_UNHANDLED_SAMPLES = 5;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const jsonStr = trimmed.slice(5).trim();
      if (!jsonStr) continue;

      try {
        const event = JSON.parse(jsonStr) as {
          event?: string;
          answer?: string;
          conversation_id?: string;
          message_id?: string;
          task_id?: string;
        };

        if (event.conversation_id) finalConversationId = event.conversation_id;
        if (event.message_id) finalMessageId = event.message_id;
        if (event.task_id) finalTaskId = event.task_id;
        if (event.event) eventsSeen.push(event.event);

        if (event.event === "message" || event.event === "agent_message") {
          if (event.answer) {
            answer += event.answer;
          }
        } else if (event.event === "message_end") {
          // 流结束，但继续读取直到 done
        } else if (event.event === "agent_thought") {
          // Agent 思考步骤，暂不处理（可用于调试）
        } else if (event.event === "error") {
          throw new Error(`Dify stream error: ${JSON.stringify(event)}`);
        } else if (event.event && event.event !== "ping" && unhandledSamples.length < MAX_UNHANDLED_SAMPLES) {
          // 未识别事件类型：采样前若干条原始 JSON，用于排查 Dify 配置 / 事件 schema
          unhandledSamples.push({
            event: event.event,
            preview: jsonStr.slice(0, 300),
          });
        }
        // ping 事件忽略
      } catch {
        parseFailures++;
      }
    }
  }

  // 诊断日志：事件序列、解析失败、空 answer 时 dump 未识别事件样本
  console.log(
    `[Dify] events received (${eventsSeen.length}): ${eventsSeen.slice(0, 30).join(" → ")}${eventsSeen.length > 30 ? " → ..." : ""}`
  );
  if (parseFailures > 0) {
    console.warn(`[Dify] SSE line parse failures: ${parseFailures}`);
  }
  if (!answer) {
    console.warn(
      `[Dify] empty answer detected; total events: ${eventsSeen.length}, answer length: 0`
    );
    if (unhandledSamples.length > 0) {
      console.warn(`[Dify] unhandled event samples (showing ${unhandledSamples.length}):`);
      for (const s of unhandledSamples) {
        console.warn(`  - ${s.event}: ${s.preview}`);
      }
    }
  }

  return {
    answer,
    conversationId: finalConversationId,
    messageId: finalMessageId,
    taskId: finalTaskId,
  };
}
