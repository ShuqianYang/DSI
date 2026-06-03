import type { AgentMessage, AgentLoopResult } from "./types.js";

export type AgentTranscriptEntryKind =
  | "model_request"
  | "assistant_message"
  | "tool_message"
  | "loop_stop";

export interface AgentTranscriptEntry {
  taskId: string;
  turn: number;
  sequence: number;
  kind: AgentTranscriptEntryKind;
  message?: AgentMessage;
  messages?: AgentMessage[];
  finalAnswer?: string;
  error?: string;
  stoppedBy?: AgentLoopResult["stoppedBy"];
  createdAt?: Date;
}

export interface AgentTranscriptStore {
  append(entry: AgentTranscriptEntry): Promise<void>;
  load(taskId: string): Promise<AgentTranscriptEntry[]>;
}

export const disabledTranscriptStore: AgentTranscriptStore = {
  async append() {
    return;
  },
  async load() {
    return [];
  },
};
