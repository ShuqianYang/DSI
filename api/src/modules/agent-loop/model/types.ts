export type ModelProvider =
  | "openai-compatible"
  | "ollama-native"
  | "anthropic"
  | "custom-http";

export type ModelAuthType = "none" | "bearer" | "api-key";
export type ModelToolCallMode = "native" | "json" | "none";
export type ModelResponseFormat =
  | "auto"
  | "openai"
  | "deepseek-reasoning"
  | "think-tag"
  | "ollama"
  | "anthropic"
  | "json-decision"
  | "plain-text";
export type ModelReasoningMode = "auto" | "structured-field" | "think-tag" | "disabled";

export interface ModelCapabilities {
  toolCalling: boolean;
  vision: boolean;
  jsonMode: boolean;
  reasoning: boolean;
  streaming: boolean;
}

export interface ModelConfig {
  provider: ModelProvider;
  apiUrl: string;
  apiKey?: string;
  apiKeyHeader: string;
  authType: ModelAuthType;
  model: string;
  timeoutMs: number;
  temperature: number;
  maxTokens?: number;
  toolCallMode: ModelToolCallMode;
  responseFormat: ModelResponseFormat;
  reasoningMode: ModelReasoningMode;
  stream: boolean;
  retryCount: number;
  retryBaseDelayMs: number;
  extraHeaders: Record<string, string>;
  extraBody: Record<string, unknown>;
  capabilities: ModelCapabilities;
}

export type ModelContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; imageUrl: string; detail?: "auto" | "low" | "high" }
    >;

export interface NormalizedToolCall {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: ModelContent;
  toolCallId?: string;
  toolCalls?: NormalizedToolCall[];
}

export interface ModelToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelRequest {
  messages: ModelMessage[];
  tools?: ModelToolDefinition[];
  toolChoice?: "auto" | "none" | "required";
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json_object" | "json_schema";
  jsonSchema?: Record<string, unknown>;
  purpose: "agent-decision" | "text-generation" | "vision-analysis";
}

export interface ModelCallOptions {
  signal?: AbortSignal;
  callId?: string;
  onRetry?: (event: {
    attempt: number;
    nextAttempt: number;
    maxAttempts: number;
    delayMs: number;
    error: Error;
  }) => void;
}

export interface NormalizedModelResponse {
  id?: string;
  model?: string;
  content: string;
  reasoning?: string;
  reasoningSource?: "field" | "think_tag" | "analysis_tag";
  toolCalls: NormalizedToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "content_filter" | "error" | "unknown";
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
  };
  metadata?: {
    providerRequestId?: string;
    rawFinishReason?: string;
    warnings?: string[];
  };
}

export interface ProviderCallOptions {
  signal?: AbortSignal;
}

export interface ModelProviderAdapter {
  generate(request: ModelRequest, options?: ProviderCallOptions): Promise<unknown>;
}

export type ModelFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
