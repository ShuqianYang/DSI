import type { AgentLoopEvent, GisData, ToolObservation } from '@datasourceintelligence/shared';

export type AgentLoopGisPushSource =
  | 'agent-loop-event'
  | 'agent-loop-result'
  | 'legacy-result';

export interface AgentLoopGisPush {
  key: string;
  source: AgentLoopGisPushSource;
  gisData: GisData;
  toolCallId?: string;
  toolName?: string;
}

export function extractGisPushesFromAgentLoopEvent(
  taskId: string,
  event: AgentLoopEvent
): AgentLoopGisPush[] {
  if (event.type === 'loop_stop') {
    return extractGisPushesFromTaskResult(
      taskId,
      {
        mode: 'agent_loop',
        observations: event.result.observations,
      },
      'agent-loop-result'
    );
  }

  if (event.type !== 'tool_observation') return [];

  const observation = event.observation;
  const gisData = extractGisDataFromObservation(observation);
  if (!gisData) return [];

  const toolCallId = event.toolCallId || observation.toolCallId;
  return [
    {
      key: buildGisPushKey(taskId, toolCallId || event.toolName),
      source: 'agent-loop-event',
      toolCallId,
      toolName: event.toolName || observation.toolName,
      gisData,
    },
  ];
}

export function extractGisPushesFromTaskResult(
  taskId: string,
  result: unknown,
  nativeSource: AgentLoopGisPushSource = 'agent-loop-result'
): AgentLoopGisPush[] {
  const root = asRecord(result);
  const pushes: AgentLoopGisPush[] = [];
  const seenKeys = new Set<string>();

  if (Array.isArray(root.observations)) {
    for (const value of root.observations) {
      if (!isToolObservation(value)) continue;
      const gisData = extractGisDataFromObservation(value);
      if (!gisData) continue;
      addUniquePush(pushes, seenKeys, {
        key: buildGisPushKey(taskId, value.toolCallId),
        source: nativeSource,
        toolCallId: value.toolCallId,
        toolName: value.toolName,
        gisData,
      });
    }
  }

  for (const [actionId, actionResult] of Object.entries(root)) {
    if (isReservedTaskResultKey(actionId)) continue;
    const record = asRecord(actionResult);
    const gisData = readGisData(record) || readGisData(asRecord(asRecord(record.observation).output));
    if (!gisData) continue;
    addUniquePush(pushes, seenKeys, {
      key: buildGisPushKey(taskId, actionId),
      source: 'legacy-result',
      toolCallId: stringValue(asRecord(record.metadata).toolCallId) || actionId,
      toolName: stringValue(asRecord(record.metadata).toolName),
      gisData,
    });
  }

  return pushes;
}

function extractGisDataFromObservation(observation: ToolObservation): GisData | undefined {
  const output = asRecord(observation.output);
  return readGisData(output);
}

function readGisData(output: Record<string, unknown>): GisData | undefined {
  const top = output.gisData;
  if (isGisData(top)) return top;

  const nested = asRecord(output.data).gisData;
  return isGisData(nested) ? nested : undefined;
}

function buildGisPushKey(taskId: string, id: string | undefined): string {
  return `${taskId}:${id || 'gis'}`;
}

function addUniquePush(pushes: AgentLoopGisPush[], seenKeys: Set<string>, push: AgentLoopGisPush): void {
  if (seenKeys.has(push.key)) return;
  seenKeys.add(push.key);
  pushes.push(push);
}

function isReservedTaskResultKey(key: string): boolean {
  return (
    key === 'message' ||
    key === 'mode' ||
    key === 'turns' ||
    key === 'stoppedBy' ||
    key === 'logFilePath' ||
    key === 'observations'
  );
}

function isToolObservation(value: unknown): value is ToolObservation {
  const record = asRecord(value);
  return (
    typeof record.toolCallId === 'string' &&
    typeof record.toolName === 'string' &&
    typeof record.ok === 'boolean'
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isGisData(value: unknown): value is GisData {
  return typeof asRecord(value).type === 'string';
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
