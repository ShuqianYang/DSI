import { z } from "zod";
import type {
  AgentMessage,
  NormalizedAgentDecision,
  ToolDefinition,
  ToolObservation,
} from "../../tools/_shared/types.js";
import { ModelResponseParseError } from "../errors.js";
import { loadModelConfig } from "../config.js";
import { createModelGateway, type ModelGatewayDependencies, type ModelGatewayLike } from "../modelGateway.js";
import type { ModelCallOptions, ModelMessage, ModelToolDefinition } from "../types.js";

export interface ModelClient {
  decide(input: {
    messages: AgentMessage[];
    tools: ToolDefinition[];
    query: string;
    observations: ToolObservation[];
    callId: string;
    signal?: AbortSignal;
    onRetry?: ModelCallOptions["onRetry"];
  }): Promise<NormalizedAgentDecision>;
}

export class AgentModelClient implements ModelClient {
  constructor(private readonly gateway: ModelGatewayLike) {}

  async decide(input: {
    messages: AgentMessage[];
    tools: ToolDefinition[];
    query: string;
    observations: ToolObservation[];
    callId: string;
    signal?: AbortSignal;
    onRetry?: ModelCallOptions["onRetry"];
  }): Promise<NormalizedAgentDecision> {
    const response = await this.gateway.generate({
      messages: input.messages.map(toModelMessage),
      tools: input.tools.map(toModelTool),
      toolChoice: input.tools.length > 0 ? "auto" : "none",
      purpose: "agent-decision",
    }, { callId: input.callId, signal: input.signal, onRetry: input.onRetry });

    if (response.toolCalls.length > 0) {
      return {
        type: "tool_calls",
        toolCalls: response.toolCalls,
        content: response.content || undefined,
      };
    }
    if (response.content.trim()) return { type: "final_answer", content: response.content };
    throw new ModelResponseParseError("Normalized model response did not contain an agent decision");
  }
}

export function createAgentModelClient(dependencies: ModelGatewayDependencies = {}): ModelClient {
  const config = loadModelConfig("AGENT");
  return new AgentModelClient(createModelGateway(config, dependencies));
}

function toModelMessage(message: AgentMessage): ModelMessage {
  return {
    role: message.role,
    content: message.content,
    toolCallId: message.toolCallId,
    toolCalls: message.toolCalls?.map(({ id, toolName, input }) => ({ id, toolName, input })),
  };
}

function toModelTool(tool: ToolDefinition): ModelToolDefinition {
  const jsonSchema = z.toJSONSchema(tool.inputSchema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return {
    name: tool.name,
    description: tool.description,
    parameters: jsonSchema.type === "object"
      ? jsonSchema
      : { type: "object", properties: {}, additionalProperties: false },
  };
}
