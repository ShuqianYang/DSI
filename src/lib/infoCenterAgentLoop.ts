import { buildAgentLoopTaskView, type AgentLoopTaskView } from './agentLoopTaskView';

export interface InfoCenterAgentLoopTaskLike {
  result?: unknown;
}

export function buildInfoCenterAgentLoopView(task: InfoCenterAgentLoopTaskLike): AgentLoopTaskView | null {
  return buildAgentLoopTaskView(task.result);
}

export function shouldRefreshInfoCenterForStreamEvent(event: unknown): boolean {
  const type = asRecord(event).type;
  if (typeof type !== 'string') return false;

  return (
    type === 'step_update' ||
    type === 'progress' ||
    type === 'completed' ||
    type === 'failed' ||
    type === 'subscription_completed' ||
    type === 'subscription_failed' ||
    type === 'tool_observation' ||
    type === 'loop_stop'
  );
}

export function shouldCloseInfoCenterStreamForEvent(event: unknown): boolean {
  const type = asRecord(event).type;
  return (
    type === 'completed' ||
    type === 'failed' ||
    type === 'subscription_completed' ||
    type === 'subscription_failed' ||
    type === 'loop_stop'
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
