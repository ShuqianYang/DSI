import { ModelResponseParseError } from "../errors.js";
import type { NormalizedToolCall } from "../types.js";

export function normalizeOpenAIToolCalls(value: unknown, fallbackCallId: string): NormalizedToolCall[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ModelResponseParseError("Model tool_calls must be an array");
  return value.map((item, index) => normalizeToolCall(item, fallbackCallId, index));
}

export function normalizeLegacyFunctionCall(value: unknown, fallbackCallId: string): NormalizedToolCall[] {
  if (value === undefined || value === null) return [];
  return [normalizeToolCall({ function: value }, fallbackCallId, 0)];
}

export function parseToolArguments(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value === "string") {
    if (!value.trim()) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(value) as unknown;
    } catch (error) {
      throw new ModelResponseParseError("Model tool arguments contain invalid JSON", { cause: error });
    }
    return requireRecord(parsed);
  }
  return requireRecord(value);
}

function normalizeToolCall(value: unknown, fallbackCallId: string, index: number): NormalizedToolCall {
  const raw = requireRecord(value, "Model tool call must be an object");
  const fn = requireRecord(raw.function, "Model tool call is missing function");
  if (typeof fn.name !== "string" || !fn.name.trim()) {
    throw new ModelResponseParseError("Model tool call is missing function name");
  }
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : `${fallbackCallId}-${index + 1}`,
    toolName: fn.name,
    input: parseToolArguments(fn.arguments),
  };
}

function requireRecord(value: unknown, message = "Model tool arguments must be a JSON object"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ModelResponseParseError(message);
  }
  return value as Record<string, unknown>;
}
