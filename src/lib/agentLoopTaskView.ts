import type { GisData, ToolObservation } from '@datasourceintelligence/shared';

export interface AgentLoopToolSummary {
  toolCallId: string;
  toolName: string;
  displayName?: string;
  ok: boolean;
  summary: string;
  gisDataType?: string;
}

export interface AgentLoopGisDataItem {
  toolCallId: string;
  toolName: string;
  displayName?: string;
  gisData: GisData;
}

export interface AgentLoopTaskView {
  message: string;
  stoppedBy: string;
  turns?: number;
  logFilePath?: string;
  toolSummaries: AgentLoopToolSummary[];
  gisDataItems: AgentLoopGisDataItem[];
}

export function buildAgentLoopTaskView(result: unknown): AgentLoopTaskView | null {
  const root = asRecord(result);
  if (root.mode !== 'agent_loop') return null;

  const observations = Array.isArray(root.observations)
    ? root.observations.filter(isToolObservation)
    : [];

  return {
    message: stringValue(root.message),
    stoppedBy: stringValue(root.stoppedBy) || 'unknown',
    turns: numberValue(root.turns),
    logFilePath: stringValue(root.logFilePath) || undefined,
    toolSummaries: observations.map((observation) => {
      const gisData = extractObservationGisData(observation);
      return {
        toolCallId: observation.toolCallId,
        toolName: observation.toolName,
        displayName: observation.displayName,
        ok: observation.ok,
        summary: summarizeObservation(observation),
        gisDataType: gisData?.type,
      };
    }),
    gisDataItems: observations.flatMap((observation) => {
      const gisData = extractObservationGisData(observation);
      return gisData
        ? [{ toolCallId: observation.toolCallId, toolName: observation.toolName, displayName: observation.displayName, gisData }]
        : [];
    }),
  };
}

function summarizeObservation(observation: ToolObservation): string {
  const output = asRecord(observation.output);
  const data = asRecord(output.data);
  const selected = asRecord(output.selected);
  const error = asRecord(observation.error);

  return (
    stringValue(output.summary) ||
    stringValue(data.summary) ||
    stringValue(output.message) ||
    stringValue(data.message) ||
    (stringValue(selected.name) ? `已解析区域：${stringValue(selected.name)}` : '') ||
    stringValue(error.message) ||
    (observation.ok ? '工具调用完成。' : '工具调用失败。')
  );
}

function extractObservationGisData(observation: ToolObservation): GisData | undefined {
  const output = asRecord(observation.output);
  const topGis = output.gisData;
  if (isGisData(topGis)) return topGis;

  const data = asRecord(output.data);
  const nestedGis = data.gisData;
  return isGisData(nestedGis) ? nestedGis : undefined;
}

function isToolObservation(value: unknown): value is ToolObservation {
  const record = asRecord(value);
  return (
    typeof record.toolCallId === 'string' &&
    typeof record.toolName === 'string' &&
    typeof record.ok === 'boolean'
  );
}

function isGisData(value: unknown): value is GisData {
  const record = asRecord(value);
  return typeof record.type === 'string';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
