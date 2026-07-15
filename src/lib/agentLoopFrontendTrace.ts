import type { AgentLoopEvent } from '@datasourceintelligence/shared';
import type { GisData } from '../types/prd';
import type { ParsedTaskStreamEvent } from './agentLoopEvents';
import type { AgentLoopThinkingUpdate } from './agentLoopStepFormatter';

export type AgentLoopFrontendTraceEventKind =
  | 'sse'
  | 'agent_loop_update'
  | 'gis_push'
  | 'task_finished';

export interface AgentLoopFrontendTraceEvent {
  at: string;
  kind: AgentLoopFrontendTraceEventKind;
  rawType?: string;
  parsedKind?: ParsedTaskStreamEvent['kind'];
  eventType?: string;
  summary?: string;
  data?: unknown;
}

export interface AgentLoopFrontendTrace {
  taskId: string;
  startedAt: string;
  updatedAt: string;
  backendLogFilePath?: string;
  events: AgentLoopFrontendTraceEvent[];
}

const traces = new Map<string, AgentLoopFrontendTrace>();
const MAX_EVENTS_PER_TASK = 500;

export function recordTaskStreamEvent(
  taskId: string,
  raw: unknown,
  parsed: ParsedTaskStreamEvent
): void {
  const rawRecord = asRecord(raw);
  appendTraceEvent(taskId, {
    kind: 'sse',
    rawType: stringValue(rawRecord.type),
    parsedKind: parsed.kind,
    eventType: parsed.kind === 'agent-loop' ? parsed.event.type : stringValue(rawRecord.type),
    summary: formatSseSummary(rawRecord, parsed),
    data: {
      raw: sanitizeForTrace(raw),
      parsedKind: parsed.kind,
    },
  });
}

export function recordAgentLoopUpdate(
  taskId: string,
  event: AgentLoopEvent,
  update: AgentLoopThinkingUpdate
): void {
  const stepSummaries = update.steps.map((step) => `${step.name}: ${step.status}`);
  appendTraceEvent(taskId, {
    kind: 'agent_loop_update',
    eventType: event.type,
    summary: stepSummaries[0] || update.content || event.type,
    data: sanitizeForTrace({
      eventType: event.type,
      toolName: 'toolName' in event ? event.toolName : undefined,
      toolCallId: 'toolCallId' in event ? event.toolCallId : undefined,
      steps: update.steps,
      contentPreview: update.content ? preview(update.content) : undefined,
      completeOpenStepsAs: update.completeOpenStepsAs,
      logFilePath: update.logFilePath,
    }),
  });
}

export function recordGisPush(taskId: string, gisData: GisData, source: string): void {
  appendTraceEvent(taskId, {
    kind: 'gis_push',
    summary: `gisData=${gisData.type || 'unknown'} source=${source}`,
    data: sanitizeForTrace({
      source,
      gisDataType: gisData.type,
      hasCameraView: !!gisData.cameraView,
      regionsCount: gisData.regions?.length ?? 0,
      entitiesCount: gisData.entities?.length ?? 0,
      imageOverlaysCount: gisData.imageOverlays?.length ?? 0,
      cameraView: gisData.cameraView,
    }),
  });
}

export function recordTaskFinished(
  taskId: string,
  status: 'completed' | 'failed',
  backendLogFilePath?: string
): void {
  const trace = ensureTrace(taskId);
  if (backendLogFilePath) {
    trace.backendLogFilePath = backendLogFilePath;
  }
  appendTraceEvent(taskId, {
    kind: 'task_finished',
    summary: backendLogFilePath ? `${status}; log=${backendLogFilePath}` : status,
    data: { status, backendLogFilePath },
  });
}

export function getAgentLoopFrontendTrace(taskId: string): AgentLoopFrontendTrace {
  return sanitizeForTrace(ensureTrace(taskId)) as AgentLoopFrontendTrace;
}

export function serializeAgentLoopFrontendTrace(taskId: string): string {
  return JSON.stringify(getAgentLoopFrontendTrace(taskId), null, 2);
}

export async function copyAgentLoopFrontendTrace(
  taskId: string,
  writeText?: (text: string) => Promise<void> | void
): Promise<boolean> {
  const text = serializeAgentLoopFrontendTrace(taskId);
  const writer = writeText ?? getClipboardWriter();
  if (!writer) return false;
  await writer(text);
  return true;
}

export function clearAgentLoopFrontendTrace(taskId?: string): void {
  if (taskId) {
    traces.delete(taskId);
    return;
  }
  traces.clear();
}

function appendTraceEvent(
  taskId: string,
  event: Omit<AgentLoopFrontendTraceEvent, 'at'>
): void {
  const trace = ensureTrace(taskId);
  trace.updatedAt = new Date().toISOString();
  trace.events.push({
    at: trace.updatedAt,
    ...event,
  });
  if (trace.events.length > MAX_EVENTS_PER_TASK) {
    trace.events.splice(0, trace.events.length - MAX_EVENTS_PER_TASK);
  }
}

function ensureTrace(taskId: string): AgentLoopFrontendTrace {
  const existing = traces.get(taskId);
  if (existing) return existing;

  const now = new Date().toISOString();
  const trace: AgentLoopFrontendTrace = {
    taskId,
    startedAt: now,
    updatedAt: now,
    events: [],
  };
  traces.set(taskId, trace);
  exposeTraceMapForDebugging();
  return trace;
}

function exposeTraceMapForDebugging(): void {
  if (typeof window === 'undefined') return;
  const traceWindow = window as Window & {
    __AGENT_LOOP_FRONTEND_TRACE__?: Map<string, AgentLoopFrontendTrace>;
  };
  traceWindow.__AGENT_LOOP_FRONTEND_TRACE__ = traces;
}

function formatSseSummary(raw: Record<string, unknown>, parsed: ParsedTaskStreamEvent): string {
  const rawType = stringValue(raw.type) || 'unknown';
  if (parsed.kind === 'agent-loop') {
    return `agent-loop:${parsed.event.type}`;
  }
  return `${parsed.kind}:${rawType}`;
}

function sanitizeForTrace(value: unknown): unknown {
  const seen = new WeakSet<object>();
  return JSON.parse(
    JSON.stringify(value, (_key, current) => {
      if (typeof current === 'bigint') return `${current.toString()}n`;
      if (typeof current === 'function') return `[Function ${current.name || 'anonymous'}]`;
      if (typeof current === 'symbol') return current.toString();
      if (current && typeof current === 'object') {
        if (seen.has(current)) return '[Circular]';
        seen.add(current);
      }
      return current;
    })
  );
}

function getClipboardWriter(): ((text: string) => Promise<void>) | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.clipboard?.writeText?.bind(navigator.clipboard);
}

function preview(text: string, max = 160): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
