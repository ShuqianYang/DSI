export type AgentRole = "system" | "user" | "assistant" | "tool";

export interface GatewayToolCall {
  id: string;
  toolName: string;
  displayName?: string;
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

export interface ToolProgressEvent {
  toolCallId?: string;
  toolName?: string;
  displayName?: string;
  stage?: string;
  message?: string;
  percent?: number;
  data?: unknown;
}

export interface ToolObservation {
  toolCallId: string;
  toolName: string;
  displayName?: string;
  /** Agent turn that produced this observation. Turn 0 is reserved for pre-loop tools. */
  turn?: number;
  ok: boolean;
  output?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

export interface AgentLoopResult {
  finalAnswer: string;
  turns: number;
  observations: ToolObservation[];
  stoppedBy: "final_answer" | "max_turns" | "model_error" | "aborted";
  logFilePath?: string;
}

export type AgentLoopEvent =
  | {
      type: "agent_turn";
      taskId: string;
      turn: number;
      maxTurns: number;
      message: string;
    }
  | {
      type: "model_request";
      taskId: string;
      turn: number;
      messages: AgentMessage[];
    }
  | {
      type: "assistant_message";
      taskId: string;
      turn: number;
      message: AgentMessage;
    }
  | {
      type: "tool_calls";
      taskId: string;
      turn: number;
      count: number;
      tools: string[];
    }
  | {
      type: "tool_batch";
      taskId: string;
      turn: number;
      mode: "concurrent" | "sequential";
      tools: string[];
    }
  | {
      type: "tool_call";
      taskId: string;
      turn: number;
      toolCallId: string;
      toolName: string;
      displayName?: string;
      reason?: string;
    }
  | {
      type: "tool_observation";
      taskId: string;
      turn: number;
      toolCallId: string;
      toolName: string;
      displayName?: string;
      ok: boolean;
      observation: ToolObservation;
    }
  | {
      type: "tool_progress";
      taskId: string;
      turn: number;
      toolCallId: string;
      toolName: string;
      displayName?: string;
      stage?: string;
      message?: string;
      percent?: number;
      data?: unknown;
    }
  | {
      type: "tool_message";
      taskId: string;
      turn: number;
      message: AgentMessage;
    }
  | {
      type: "loop_stop";
      taskId: string;
      turn: number;
      result: AgentLoopResult;
    };

export type AgentLoopEventType = AgentLoopEvent["type"];
