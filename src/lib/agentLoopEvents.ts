import type { GisData } from '../types/prd';
import type { AgentLoopEvent, AgentLoopEventType } from '@datasourceintelligence/shared';

export type { AgentLoopEvent, AgentLoopEventType } from '@datasourceintelligence/shared';

export type ParsedTaskStreamEvent =
  | { kind: 'agent-loop'; event: AgentLoopEvent }
  | { kind: 'legacy'; event: Record<string, unknown> }
  | { kind: 'control'; event: Record<string, unknown> }
  | { kind: 'unknown'; event: Record<string, unknown> };

const agentLoopEventTypes = new Set<string>([
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

const legacyEventTypes = new Set<string>([
  'planning',
  'planning_done',
  'routing',
  'routing_done',
  'step_update',
  'completed',
  'failed',
]);

const controlEventTypes = new Set<string>(['connected']);

export function isAgentLoopEventType(type: string): type is AgentLoopEventType {
  return agentLoopEventTypes.has(type);
}

export function parseTaskStreamEvent(value: unknown): ParsedTaskStreamEvent {
  const event = asRecord(value);
  const type = typeof event.type === 'string' ? event.type : undefined;

  if (type && isAgentLoopEventType(type)) {
    return { kind: 'agent-loop', event: event as AgentLoopEvent };
  }

  if (type && legacyEventTypes.has(type)) {
    return { kind: 'legacy', event };
  }

  if (type && controlEventTypes.has(type)) {
    return { kind: 'control', event };
  }

  return { kind: 'unknown', event };
}

export function extractGisDataFromAgentLoopEvent(event: AgentLoopEvent): GisData | undefined {
  if (event.type !== 'tool_observation') return undefined;

  const observation = asRecord(event.observation);
  const output = asRecord(observation.output);
  return readGisData(output);
}

export function extractOperationsFromAgentLoopEvent(
  event: AgentLoopEvent
): Array<Record<string, unknown>> | undefined {
  if (event.type !== 'tool_observation') return undefined;

  const observation = asRecord(event.observation);
  const output = asRecord(observation.output);
  const operations = output.operations;
  return Array.isArray(operations) ? operations.filter(isRecord) : undefined;
}

export function formatAgentLoopTraceLine(taskId: string, event: AgentLoopEvent): string {
  const prefix = `[agent-loop][${event.taskId || taskId}]`;

  if (event.type === 'agent_turn') {
    return `${prefix} agent_turn ${event.turn ?? '?'}${event.maxTurns ? `/${event.maxTurns}` : ''}`;
  }

  if (event.type === 'assistant_message') {
    const message = typeof event.message === 'object' && event.message ? event.message : undefined;
    const toolCalls = message?.toolCalls || [];
    if (toolCalls.length > 0) {
      const tools = toolCalls.map((call) => call.toolName || call.id || 'tool').join(', ');
      return `${prefix} assistant_message toolCalls=[${tools}]`;
    }
    return `${prefix} assistant_message content="${preview(message?.content || '')}"`;
  }

  if (event.type === 'tool_call') {
    return `${prefix} tool_call ${event.toolName || 'tool'} id=${event.toolCallId || '?'}`;
  }

  if (event.type === 'tool_progress') {
    const stage = event.stage ? ` stage=${event.stage}` : '';
    const percent = typeof event.percent === 'number' ? ` percent=${event.percent}` : '';
    return `${prefix} tool_progress ${event.toolName || 'tool'}${stage}${percent} ${preview(String(event.message || ''))}`;
  }

  if (event.type === 'tool_observation') {
    const gisData = extractGisDataFromAgentLoopEvent(event);
    const gisPart = gisData ? ` gisData=${gisData.type || 'unknown'}` : '';
    return `${prefix} tool_observation ${event.toolName || 'tool'} ok=${String(event.ok)}${gisPart}`;
  }

  if (event.type === 'loop_stop') {
    return `${prefix} loop_stop stoppedBy=${event.result?.stoppedBy || 'unknown'} final="${preview(event.result?.finalAnswer || '')}"`;
  }

  return `${prefix} ${event.type}`;
}

export function logAgentLoopEvent(taskId: string, event: AgentLoopEvent): void {
  if (!isAgentLoopTraceEnabled()) return;

  console.log(formatAgentLoopTraceLine(taskId, event), event);
  const maybeWindow = typeof window === 'undefined' ? undefined : window;
  if (!maybeWindow) return;

  const traceWindow = maybeWindow as Window & {
    __AGENT_LOOP_TRACE__?: Array<{ taskId: string; event: AgentLoopEvent; at: string }>;
  };
  traceWindow.__AGENT_LOOP_TRACE__ ||= [];
  traceWindow.__AGENT_LOOP_TRACE__.push({
    taskId,
    event,
    at: new Date().toISOString(),
  });
}

function isAgentLoopTraceEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_AGENT_LOOP_TRACE === 'true') return true;
  if (typeof window === 'undefined') return false;

  const params = new URLSearchParams(window.location.search);
  return params.get('agentLoopTrace') === '1' || window.localStorage.getItem('agent-loop-trace') === 'true';
}

function readGisData(output: Record<string, unknown>): GisData | undefined {
  const top = output.gisData;
  if (isRecord(top)) return top as GisData;

  const nested = asRecord(output.data).gisData;
  return isRecord(nested) ? (nested as GisData) : undefined;
}

function preview(text: string, max = 120): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
