import type { AgentLoopEvent, ToolObservation } from '@datasourceintelligence/shared';

export type TaskFinishStatus = 'completed' | 'failed';

export interface TaskFinishInfo {
  status: TaskFinishStatus;
  logFilePath?: string;
}

export type AgentLoopStopTaskResult = {
  message: string;
  mode: 'agent_loop';
  turns: number;
  stoppedBy: AgentLoopEvent extends infer E
    ? E extends { type: 'loop_stop'; result: infer R }
      ? R extends { stoppedBy: infer S }
        ? S
        : string
      : string
    : string;
  observations: ToolObservation[];
  logFilePath?: string;
};

export function getTaskFinishFromAgentLoopEvent(event: unknown): TaskFinishInfo | undefined {
  const record = asRecord(event);
  if (record.type !== 'loop_stop') return undefined;

  const result = asRecord(record.result);
  const stoppedBy = stringValue(result.stoppedBy);
  return {
    status: stoppedBy === 'model_error' || stoppedBy === 'aborted' ? 'failed' : 'completed',
    logFilePath: stringValue(result.logFilePath),
  };
}

export function getTaskFinishFromStreamEvent(event: unknown): TaskFinishInfo | undefined {
  return getTaskFinishFromAgentLoopEvent(event);
}

export function buildAgentLoopTaskResultFromStop(event: Extract<AgentLoopEvent, { type: 'loop_stop' }>): AgentLoopStopTaskResult {
  return {
    message: event.result.finalAnswer,
    mode: 'agent_loop',
    turns: event.result.turns,
    stoppedBy: event.result.stoppedBy,
    observations: event.result.observations,
    ...(event.result.logFilePath ? { logFilePath: event.result.logFilePath } : {}),
  };
}

export function isNativeAgentLoopProgressEvent(event: unknown): boolean {
  const type = stringValue(asRecord(event).type);
  return type === 'tool_observation' || type === 'tool_progress' || type === 'tool_call' || type === 'agent_turn';
}

export interface TaskStreamModeTracker {
  preferNative(taskId: string): void;
  recordNativeEvent(taskId: string, event: unknown): void;
  clear(taskId: string): void;
}

const nativeAgentLoopEventTypes = new Set([
  'agent_turn',
  'model_request',
  'assistant_message',
  'tool_calls',
  'tool_batch',
  'tool_call',
  'tool_progress',
  'tool_observation',
  'tool_message',
  'loop_stop',
]);

export function createTaskStreamModeTracker(): TaskStreamModeTracker {
  const nativeTaskIds = new Set<string>();

  return {
    preferNative(taskId: string) {
      nativeTaskIds.add(taskId);
    },
    recordNativeEvent(taskId: string, event: unknown) {
      const type = stringValue(asRecord(event).type);
      if (type && nativeAgentLoopEventTypes.has(type)) {
        nativeTaskIds.add(taskId);
      }
    },
    clear(taskId: string) {
      nativeTaskIds.delete(taskId);
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
