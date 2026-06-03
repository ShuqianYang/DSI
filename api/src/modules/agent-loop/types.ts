import type { z } from "zod";

export type AgentRole = "system" | "user" | "assistant" | "tool";

export interface GatewayToolCall {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  reason?: string;
}

export interface AgentMessage {
  role: AgentRole;
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: GatewayToolCall[];
}

export interface AgentRuntimeContext {
  taskId: string;
  query: string;
  turn: number;
  maxTurns: number;
  observations: ToolObservation[];
}

export interface ToolExecutionContext {
  taskId: string;
  query: string;
  observations: ToolObservation[];
}

export interface ToolDefinition<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<Input>;
  isConcurrencySafe?: (input: Input) => boolean;
  execute(input: Input, context: ToolExecutionContext): Promise<Output>;
}

export interface ToolObservation {
  toolCallId: string;
  toolName: string;
  ok: boolean;
  output?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

export type NormalizedAgentDecision =
  | {
      type: "tool_calls";
      toolCalls: GatewayToolCall[];
      content?: string;
    }
  | {
      type: "final_answer";
      content: string;
    };

export interface AgentLoopResult {
  finalAnswer: string;
  turns: number;
  observations: ToolObservation[];
  stoppedBy: "final_answer" | "max_turns" | "model_error";
}

export interface PromptSection {
  id: string;
  content: string;
}
