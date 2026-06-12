import {
  parseTaskStreamEvent,
  type AgentLoopEvent,
  type ParsedTaskStreamEvent,
} from './agentLoopEvents';
import type { TaskStreamModeTracker } from './taskStreamLifecycle';

export type RoutedTaskStreamEvent =
  | { kind: 'agent-loop'; event: AgentLoopEvent; parsed: ParsedTaskStreamEvent }
  | { kind: 'ignored-legacy'; event: Record<string, unknown>; parsed: ParsedTaskStreamEvent }
  | { kind: 'control'; event: Record<string, unknown>; parsed: ParsedTaskStreamEvent }
  | { kind: 'unknown'; event: Record<string, unknown>; parsed: ParsedTaskStreamEvent };

export function routeTaskStreamEvent(input: {
  taskId: string;
  event: unknown;
  tracker: TaskStreamModeTracker;
}): RoutedTaskStreamEvent {
  const parsed = parseTaskStreamEvent(input.event);

  if (parsed.kind === 'agent-loop') {
    input.tracker.recordNativeEvent(input.taskId, parsed.event);
    return { kind: 'agent-loop', event: parsed.event, parsed };
  }

  if (parsed.kind === 'legacy') {
    return { kind: 'ignored-legacy', event: parsed.event, parsed };
  }

  if (parsed.kind === 'control') {
    return { kind: 'control', event: parsed.event, parsed };
  }

  return { kind: 'unknown', event: parsed.event, parsed };
}
