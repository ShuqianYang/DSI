import { parseJsonDecision } from "../../decisionAdapter.js";
import { ModelResponseParseError } from "../errors.js";
import type { ModelConfig, NormalizedModelResponse } from "../types.js";
import { extractReasoningTags } from "./thinkTag.js";
import { normalizeLegacyFunctionCall, normalizeOpenAIToolCalls } from "./toolCalls.js";

export function normalizeOpenAIResponse(
  value: unknown,
  config: ModelConfig,
  fallbackCallId = "model-call"
): NormalizedModelResponse {
  const root = requireRecord(value, "Model response must be a JSON object");
  if (!Array.isArray(root.choices) || root.choices.length === 0) {
    throw new ModelResponseParseError("Model response is missing choices[0]");
  }
  const choice = requireRecord(root.choices[0], "Model response choice must be an object");
  const message = requireRecord(choice.message, "Model response is missing assistant message");
  const warnings: string[] = [];

  let content = readContent(message.content);
  const fieldReasoning = config.reasoningMode === "disabled" || config.reasoningMode === "think-tag"
    ? undefined
    : firstString(message.reasoning_content, message.reasoning, message.analysis, choice.reasoning);
  const tagged = extractReasoningTags(content, config.reasoningMode);
  content = tagged.content;
  warnings.push(...tagged.warnings);

  const reasoning = fieldReasoning ?? tagged.reasoning;
  const reasoningSource: NormalizedModelResponse["reasoningSource"] = fieldReasoning ? "field" : tagged.source;
  if (fieldReasoning && tagged.reasoning) {
    warnings.push("Both structured reasoning and reasoning tags were returned; structured reasoning was preferred");
  }

  let toolCalls = normalizeOpenAIToolCalls(message.tool_calls, fallbackCallId);
  if (toolCalls.length === 0) {
    toolCalls = normalizeLegacyFunctionCall(message.function_call, fallbackCallId);
  }

  if (config.toolCallMode === "json" && toolCalls.length === 0 && content.trim()) {
    try {
      const decision = parseJsonDecision(content, fallbackCallId);
      if (decision.type === "tool_calls") {
        toolCalls = decision.toolCalls.map(({ id, toolName, input }) => ({ id, toolName, input }));
        content = decision.content ?? "";
      } else {
        content = decision.content;
      }
    } catch (error) {
      throw new ModelResponseParseError("Model JSON decision could not be parsed", { cause: error });
    }
  }

  if (!content.trim() && toolCalls.length === 0) {
    throw new ModelResponseParseError("Model response did not contain content or tool calls");
  }

  const rawFinishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : undefined;
  return {
    id: typeof root.id === "string" ? root.id : undefined,
    model: typeof root.model === "string" ? root.model : undefined,
    content,
    reasoning,
    reasoningSource,
    toolCalls,
    finishReason: toolCalls.length > 0 ? "tool_calls" : normalizeFinishReason(rawFinishReason),
    usage: normalizeUsage(root.usage),
    metadata: {
      rawFinishReason,
      warnings: warnings.length > 0 ? warnings : undefined,
    },
  };
}

function readContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        const raw = part as Record<string, unknown>;
        return typeof raw.text === "string" ? raw.text : "";
      })
      .join("");
  }
  throw new ModelResponseParseError("Model message content must be a string, content array, or null");
}

function normalizeFinishReason(value: string | undefined): NormalizedModelResponse["finishReason"] {
  switch (value) {
    case "stop": return "stop";
    case "tool_calls":
    case "function_call": return "tool_calls";
    case "length":
    case "max_tokens": return "length";
    case "content_filter": return "content_filter";
    case "error": return "error";
    default: return "unknown";
  }
}

function normalizeUsage(value: unknown): NormalizedModelResponse["usage"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const usage = value as Record<string, unknown>;
  const details = usage.completion_tokens_details && typeof usage.completion_tokens_details === "object"
    ? usage.completion_tokens_details as Record<string, unknown>
    : {};
  const normalized = {
    inputTokens: asNumber(usage.prompt_tokens),
    outputTokens: asNumber(usage.completion_tokens),
    reasoningTokens: asNumber(details.reasoning_tokens),
    totalTokens: asNumber(usage.total_tokens),
  };
  return Object.values(normalized).some((item) => item !== undefined) ? normalized : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim() !== "");
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ModelResponseParseError(message);
  return value as Record<string, unknown>;
}
