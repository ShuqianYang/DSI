import type { NormalizedAgentDecision } from "./types.js";

interface RawDecision {
  type?: unknown;
  tool?: unknown;
  toolName?: unknown;
  tools?: unknown;
  toolCalls?: unknown;
  args?: unknown;
  input?: unknown;
  reason?: unknown;
  content?: unknown;
}

export function parseJsonDecision(text: string, fallbackCallId: string): NormalizedAgentDecision {
  const jsonText = extractJson(text);
  const raw = JSON.parse(jsonText) as RawDecision;

  if (raw.type === "final_answer") {
    const content = typeof raw.content === "string" ? raw.content : "";
    return {
      type: "final_answer",
      content,
    };
  }

  if (raw.type === "tool_call") {
    return {
      type: "tool_calls",
      toolCalls: [parseToolCall(raw, fallbackCallId)],
    };
  }

  if (raw.type === "tool_calls") {
    const candidates = Array.isArray(raw.toolCalls)
      ? raw.toolCalls
      : Array.isArray(raw.tools)
        ? raw.tools
        : [];
    const toolCalls = candidates.map((item, index) =>
      parseToolCall(item, `${fallbackCallId}-${index + 1}`)
    );
    if (toolCalls.length === 0) {
      throw new Error("tool_calls decision missing tool calls");
    }
    return {
      type: "tool_calls",
      toolCalls,
    };
  }

  throw new Error(`Unknown agent decision type: ${String(raw.type)}`);
}

function parseToolCall(value: unknown, fallbackCallId: string) {
  const raw = normalizeRecord(value);
  const toolName =
    typeof raw.tool === "string"
      ? raw.tool
      : typeof raw.toolName === "string"
        ? raw.toolName
        : "";
  const input = normalizeRecord(raw.args ?? raw.input);
  const reason = typeof raw.reason === "string" ? raw.reason : undefined;

  if (!toolName) {
    throw new Error("tool_call decision missing tool name");
  }

  return {
    id: typeof raw.id === "string" ? raw.id : fallbackCallId,
    toolName,
    input,
    reason,
  };
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlock?.[1]) return codeBlock[1].trim();

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch?.[0]) return objectMatch[0];

  return trimmed;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
