import { safeJsonStringify } from "../../tools/_shared/serialization.js";
import { ModelResponseParseError, toModelHttpError } from "../errors.js";
import type {
  ModelConfig,
  ModelContent,
  ModelFetch,
  ModelMessage,
  ModelProviderAdapter,
  ModelRequest,
  ModelToolDefinition,
  ProviderCallOptions,
} from "../types.js";

const MAX_ERROR_BODY_CHARS = 2_000;

export class OpenAICompatibleProvider implements ModelProviderAdapter {
  constructor(
    private readonly config: ModelConfig,
    private readonly fetchImpl: ModelFetch = fetch
  ) {}

  async generate(request: ModelRequest, options: ProviderCallOptions = {}): Promise<unknown> {
    const body: Record<string, unknown> = {
      ...this.config.extraBody,
      model: this.config.model,
      messages: buildMessages(request, this.config),
      stream: false,
      temperature: request.temperature ?? this.config.temperature,
    };
    const maxTokens = request.maxTokens ?? this.config.maxTokens;
    if (maxTokens !== undefined) body.max_tokens = maxTokens;

    if (request.tools?.length && this.config.toolCallMode === "native") {
      body.tools = request.tools.map(toOpenAITool);
      body.tool_choice = request.toolChoice ?? "auto";
    }
    if (request.responseFormat === "json_object") {
      body.response_format = { type: "json_object" };
    } else if (request.responseFormat === "json_schema") {
      body.response_format = {
        type: "json_schema",
        json_schema: request.jsonSchema ?? {},
      };
    }

    const response = await this.fetchImpl(this.config.apiUrl, {
      method: "POST",
      signal: options.signal,
      headers: buildHeaders(this.config),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw toModelHttpError({
        status: response.status,
        statusText: response.statusText,
        bodyPreview: responseText.slice(0, MAX_ERROR_BODY_CHARS),
        provider: this.config.provider,
        model: this.config.model,
      });
    }

    try {
      return await response.json() as unknown;
    } catch (error) {
      throw new ModelResponseParseError("Model API returned invalid JSON", {
        cause: error,
        provider: this.config.provider,
        model: this.config.model,
      });
    }
  }
}

function buildMessages(request: ModelRequest, config: ModelConfig): Array<Record<string, unknown>> {
  const messages = request.messages.map(toOpenAIMessage);
  if (!request.tools?.length || config.toolCallMode !== "json") return messages;

  const contract = {
    instruction: "Native tool calling is disabled. Respond with exactly one JSON object and no prose.",
    allowedResponses: [
      { type: "tool_calls", toolCalls: [{ id: "optional", toolName: "tool name", input: {} }] },
      { type: "final_answer", content: "answer" },
    ],
    tools: request.tools,
  };
  return [
    {
      role: "system",
      content: `JSON decision protocol:\n${safeJsonStringify(contract)}`,
    },
    ...messages,
  ];
}

function buildHeaders(config: ModelConfig): Record<string, string> {
  const headers: Record<string, string> = {
    ...config.extraHeaders,
    "Content-Type": "application/json",
  };
  if (config.authType === "bearer" && config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  } else if (config.authType === "api-key" && config.apiKey) {
    headers[config.apiKeyHeader] = config.apiKey;
  }
  return headers;
}

function toOpenAIMessage(message: ModelMessage): Record<string, unknown> {
  if (message.role === "tool") {
    if (!message.toolCallId) throw new ModelResponseParseError("Tool message is missing toolCallId");
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: toOpenAIContent(message.content),
    };
  }

  const result: Record<string, unknown> = {
    role: message.role,
    content: toOpenAIContent(message.content),
  };
  if (message.role === "assistant" && message.toolCalls?.length) {
    result.tool_calls = message.toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: "function",
      function: {
        name: toolCall.toolName,
        arguments: safeJsonStringify(toolCall.input),
      },
    }));
    if (message.content === "") result.content = null;
  }
  return result;
}

function toOpenAIContent(content: ModelContent): unknown {
  if (typeof content === "string") return content;
  return content.map((part) => part.type === "text"
    ? { type: "text", text: part.text }
    : {
        type: "image_url",
        image_url: {
          url: part.imageUrl,
          ...(part.detail ? { detail: part.detail } : {}),
        },
      });
}

function toOpenAITool(tool: ModelToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
