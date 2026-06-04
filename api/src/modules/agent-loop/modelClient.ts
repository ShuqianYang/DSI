import { z } from "zod";
import { safeJsonStringify } from "./serialization.js";
import type {
  AgentMessage,
  GatewayToolCall,
  NormalizedAgentDecision,
  ToolDefinition,
  ToolObservation,
} from "./types.js";

export interface ModelClient {
  decide(input: {
    messages: AgentMessage[];
    tools: ToolDefinition[];
    query: string;
    observations: ToolObservation[];
    callId: string;
  }): Promise<NormalizedAgentDecision>;
}

interface DeepSeekToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface DeepSeekMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

interface DeepSeekTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_API_URL =
  process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
const DEEPSEEK_API_TIMEOUT_MS = parsePositiveIntegerEnv(
  process.env.DEEPSEEK_API_TIMEOUT_MS || process.env.API_TIMEOUT_MS,
  120_000
);

export function createModelClient(): ModelClient {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY is required for agent loop model decisions");
  }
  return new DeepSeekToolCallingModelClient();
}

class DeepSeekToolCallingModelClient implements ModelClient {
  async decide(input: {
    messages: AgentMessage[];
    tools: ToolDefinition[];
    callId: string;
  }): Promise<NormalizedAgentDecision> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), DEEPSEEK_API_TIMEOUT_MS);

    let response: Response;
    try {
      const body: Record<string, unknown> = {
        model: DEEPSEEK_MODEL,
        messages: input.messages.map(toDeepSeekMessage),
        stream: false,
        temperature: 0.1,
      };
      if (input.tools.length > 0) {
        body.tools = input.tools.map(toDeepSeekTool);
        body.tool_choice = "auto";
      }

      response = await fetch(DEEPSEEK_API_URL, {
        method: "POST",
        signal: abortController.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        throw new Error(`DeepSeek API request timed out after ${DEEPSEEK_API_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`DeepSeek API error: ${response.status} ${text}`);
    }

    const json = await response.json();
    const choice = json.choices?.[0];
    const message = choice?.message;
    if (!message || typeof message !== "object") {
      throw new Error("DeepSeek response missing assistant message");
    }

    const toolCalls = normalizeDeepSeekToolCalls(message.tool_calls, input.callId);
    if (toolCalls.length > 0) {
      return {
        type: "tool_calls",
        toolCalls,
        content: typeof message.content === "string" ? message.content : undefined,
      };
    }

    if (typeof message.content === "string" && message.content.trim()) {
      return {
        type: "final_answer",
        content: message.content,
      };
    }

    throw new Error(`DeepSeek response did not contain content or tool_calls`);
  }
}

function toDeepSeekMessage(message: AgentMessage): DeepSeekMessage {
  if (message.role === "tool") {
    if (!message.toolCallId) {
      throw new Error("Tool message missing toolCallId");
    }
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }

  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map(toolCall => ({
        id: toolCall.id,
        type: "function",
        function: {
          name: toolCall.toolName,
          arguments: safeJsonStringify(toolCall.input),
        },
      })),
    };
  }

  return {
    role: message.role,
    content: message.content,
  };
}

function toDeepSeekTool(tool: ToolDefinition): DeepSeekTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toJsonSchemaObject(tool.inputSchema),
    },
  };
}

function normalizeDeepSeekToolCalls(value: unknown, fallbackCallId: string): GatewayToolCall[] {
  if (!Array.isArray(value)) return [];

  return value.map((toolCall, index) => {
    const raw = toolCall as DeepSeekToolCall;
    const toolName = raw.function?.name;
    if (!toolName) {
      throw new Error("DeepSeek tool call missing function name");
    }

    return {
      id: raw.id || `${fallbackCallId}-${index + 1}`,
      toolName,
      input: parseToolArguments(raw.function?.arguments),
    };
  });
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || value.trim() === "") return {};

  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("DeepSeek tool call arguments must be a JSON object");
  }

  return parsed as Record<string, unknown>;
}

function toJsonSchemaObject(schema: ToolDefinition["inputSchema"]): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete jsonSchema.$schema;

  if (jsonSchema.type !== "object") {
    return {
      type: "object",
      properties: {},
      additionalProperties: false,
    };
  }

  return jsonSchema;
}

function parsePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
