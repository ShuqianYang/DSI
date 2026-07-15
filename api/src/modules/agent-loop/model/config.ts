import { z } from "zod";
import { ModelConfigError } from "./errors.js";
import type {
  ModelAuthType,
  ModelCapabilities,
  ModelConfig,
  ModelProvider,
  ModelReasoningMode,
  ModelResponseFormat,
  ModelToolCallMode,
} from "./types.js";

export type ModelConfigPrefix = "AGENT" | "DAILY_REPORT" | "VISION";

const DEFAULT_API_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

const ProviderSchema = z.enum(["openai-compatible", "ollama-native", "anthropic", "custom-http"]);
const AuthTypeSchema = z.enum(["none", "bearer", "api-key"]);
const ToolCallModeSchema = z.enum(["native", "json", "none"]);
const ResponseFormatSchema = z.enum([
  "auto",
  "openai",
  "deepseek-reasoning",
  "think-tag",
  "ollama",
  "anthropic",
  "json-decision",
  "plain-text",
]);
const ReasoningModeSchema = z.enum(["auto", "structured-field", "think-tag", "disabled"]);

const warnedLegacyVariables = new Set<string>();

export function loadModelConfig(
  prefix: ModelConfigPrefix = "AGENT",
  env: NodeJS.ProcessEnv = process.env
): ModelConfig {
  const read = (suffix: string): string | undefined => firstNonEmpty(
    env[`${prefix}_MODEL_${suffix}`],
    env[`MODEL_${suffix}`]
  );

  const legacy = loadLegacyValues(prefix, env, {
    apiKey: read("API_KEY") === undefined,
    apiUrl: read("API_URL") === undefined,
    model: read("NAME") === undefined,
    timeoutMs: read("TIMEOUT_MS") === undefined,
  });
  const apiUrl = read("API_URL") ?? legacy.apiUrl ?? DEFAULT_API_URL;
  const apiKey = read("API_KEY") ?? legacy.apiKey;
  const provider = parseEnum(ProviderSchema, read("PROVIDER") ?? "openai-compatible", "MODEL_PROVIDER");
  const authType = parseEnum(
    AuthTypeSchema,
    read("AUTH_TYPE") ?? inferAuthType(apiUrl, apiKey),
    "MODEL_AUTH_TYPE"
  );

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(apiUrl);
  } catch (error) {
    throw new ModelConfigError(`Invalid model API URL: ${apiUrl}`, { cause: error });
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new ModelConfigError(`Model API URL must use http or https: ${apiUrl}`);
  }
  if (authType !== "none" && !apiKey) {
    throw new ModelConfigError(
      `${prefix}_MODEL_API_KEY (or MODEL_API_KEY) is required when auth type is ${authType}`
    );
  }
  const model = read("NAME") ?? legacy.model;
  if (!model) {
    throw new ModelConfigError(
      `${prefix}_MODEL_NAME (or MODEL_NAME) is required; no default language model is selected`
    );
  }

  const capabilities = defaultCapabilities(provider);
  const stream = parseBoolean(read("STREAM"), false, "MODEL_STREAM");
  if (stream) {
    throw new ModelConfigError("MODEL_STREAM=true is reserved for phase two and is not supported yet");
  }
  return {
    provider,
    apiUrl,
    apiKey,
    apiKeyHeader: read("API_KEY_HEADER") ?? "Authorization",
    authType,
    model,
    timeoutMs: parsePositiveInteger(read("TIMEOUT_MS") ?? legacy.timeoutMs, 120_000, "MODEL_TIMEOUT_MS"),
    temperature: parseFiniteNumber(read("TEMPERATURE"), 0.1, "MODEL_TEMPERATURE"),
    maxTokens: parseOptionalPositiveInteger(read("MAX_TOKENS"), "MODEL_MAX_TOKENS"),
    toolCallMode: parseEnum(ToolCallModeSchema, read("TOOL_CALL_MODE") ?? "native", "MODEL_TOOL_CALL_MODE"),
    responseFormat: parseEnum(ResponseFormatSchema, read("RESPONSE_FORMAT") ?? "auto", "MODEL_RESPONSE_FORMAT"),
    reasoningMode: parseEnum(ReasoningModeSchema, read("REASONING_MODE") ?? "auto", "MODEL_REASONING_MODE"),
    stream,
    retryCount: parseNonNegativeInteger(read("RETRY_COUNT"), 2, "MODEL_RETRY_COUNT"),
    retryBaseDelayMs: parsePositiveInteger(read("RETRY_BASE_DELAY_MS"), 250, "MODEL_RETRY_BASE_DELAY_MS"),
    extraHeaders: parseStringRecord(read("EXTRA_HEADERS_JSON"), "MODEL_EXTRA_HEADERS_JSON"),
    extraBody: parseUnknownRecord(read("EXTRA_BODY_JSON"), "MODEL_EXTRA_BODY_JSON"),
    capabilities: {
      toolCalling: parseBoolean(read("CAPABILITY_TOOL_CALLING"), capabilities.toolCalling, "MODEL_CAPABILITY_TOOL_CALLING"),
      vision: parseBoolean(read("CAPABILITY_VISION"), capabilities.vision, "MODEL_CAPABILITY_VISION"),
      jsonMode: parseBoolean(read("CAPABILITY_JSON_MODE"), capabilities.jsonMode, "MODEL_CAPABILITY_JSON_MODE"),
      reasoning: parseBoolean(read("CAPABILITY_REASONING"), capabilities.reasoning, "MODEL_CAPABILITY_REASONING"),
      streaming: parseBoolean(read("CAPABILITY_STREAMING"), capabilities.streaming, "MODEL_CAPABILITY_STREAMING"),
    },
  };
}

function loadLegacyValues(
  prefix: ModelConfigPrefix,
  env: NodeJS.ProcessEnv,
  needed: Record<string, boolean>
) {
  const candidates: Record<string, Array<[string, string | undefined]>> = prefix === "DAILY_REPORT"
    ? {
        apiKey: [["QWEN_API_KEY", env.QWEN_API_KEY], ["DEEPSEEK_API_KEY", env.DEEPSEEK_API_KEY]],
        apiUrl: [["QWEN_API_URL", env.QWEN_API_URL], ["DEEPSEEK_API_URL", env.DEEPSEEK_API_URL]],
        model: [["DAILY_REPORT_MODEL", env.DAILY_REPORT_MODEL], ["QWEN_MODEL", env.QWEN_MODEL], ["DEEPSEEK_MODEL", env.DEEPSEEK_MODEL]],
        timeoutMs: [["QWEN_API_TIMEOUT_MS", env.QWEN_API_TIMEOUT_MS], ["DEEPSEEK_API_TIMEOUT_MS", env.DEEPSEEK_API_TIMEOUT_MS]],
      }
    : {
        apiKey: [["QWEN_API_KEY", env.QWEN_API_KEY], ["DEEPSEEK_API_KEY", env.DEEPSEEK_API_KEY]],
        apiUrl: [["QWEN_API_URL", env.QWEN_API_URL], ["DEEPSEEK_API_URL", env.DEEPSEEK_API_URL]],
        model: [["QWEN_MODEL", env.QWEN_MODEL], ["DEEPSEEK_MODEL", env.DEEPSEEK_MODEL]],
        timeoutMs: [["QWEN_API_TIMEOUT_MS", env.QWEN_API_TIMEOUT_MS], ["DEEPSEEK_API_TIMEOUT_MS", env.DEEPSEEK_API_TIMEOUT_MS], ["API_TIMEOUT_MS", env.API_TIMEOUT_MS]],
      };

  const result: Record<string, string | undefined> = {};
  for (const [field, values] of Object.entries(candidates)) {
    if (!needed[field]) continue;
    const selected = values.find(([, value]) => firstNonEmpty(value) !== undefined);
    if (selected) {
      warnLegacyVariable(selected[0]);
      result[field] = firstNonEmpty(selected[1]);
    }
  }
  return result;
}

function warnLegacyVariable(name: string): void {
  if (warnedLegacyVariables.has(name) || process.env.NODE_ENV === "test") return;
  warnedLegacyVariables.add(name);
  console.warn(`[ModelAdapter] ${name} is deprecated; migrate to MODEL_* or role-specific *_MODEL_* variables.`);
}

function inferAuthType(apiUrl: string, apiKey?: string): ModelAuthType {
  if (apiKey) return "bearer";
  try {
    const host = new URL(apiUrl).hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "none";
  } catch {
    // URL validation below provides the actionable error.
  }
  return "bearer";
}

function defaultCapabilities(provider: ModelProvider): ModelCapabilities {
  if (provider === "openai-compatible") {
    return { toolCalling: true, vision: false, jsonMode: true, reasoning: true, streaming: true };
  }
  return { toolCalling: false, vision: false, jsonMode: false, reasoning: false, streaming: false };
}

function parseEnum<T extends z.ZodType<string>>(schema: T, value: string, name: string): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ModelConfigError(`${name} has unsupported value: ${value}`);
  return result.data;
}

function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new ModelConfigError(`${name} must be a positive integer`);
  return parsed;
}

function parseOptionalPositiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  return parsePositiveInteger(value, 1, name);
}

function parseNonNegativeInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new ModelConfigError(`${name} must be a non-negative integer`);
  return parsed;
}

function parseFiniteNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new ModelConfigError(`${name} must be a finite number`);
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined) return fallback;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  throw new ModelConfigError(`${name} must be a boolean`);
}

function parseUnknownRecord(value: string | undefined, name: string): Record<string, unknown> {
  if (value === undefined) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("expected an object");
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new ModelConfigError(`${name} must be a JSON object`, { cause: error });
  }
}

function parseStringRecord(value: string | undefined, name: string): Record<string, string> {
  const record = parseUnknownRecord(value, name);
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== "string") throw new ModelConfigError(`${name}.${key} must be a string`);
  }
  return record as Record<string, string>;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim() !== "")?.trim();
}

export type {
  ModelAuthType,
  ModelProvider,
  ModelReasoningMode,
  ModelResponseFormat,
  ModelToolCallMode,
};
