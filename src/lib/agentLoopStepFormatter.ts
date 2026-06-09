import type { AgentLoopEvent } from '@datasourceintelligence/shared';
import type { ThinkingStep } from '../types/prd';
import { extractGisDataFromAgentLoopEvent } from './agentLoopEvents';

export interface AgentLoopThinkingUpdate {
  steps: ThinkingStep[];
  content?: string;
  completeOpenStepsAs?: ThinkingStep['status'];
  logFilePath?: string;
}

export function formatAgentLoopThinkingUpdate(event: AgentLoopEvent): AgentLoopThinkingUpdate {
  if (event.type === 'agent_turn') {
    return {
      steps: [
        {
          id: `agent-turn-${event.turn}`,
          name: `Agent Turn ${event.turn}`,
          status: 'running',
          detail: event.message,
          category: 'agent',
          eventType: event.type,
        },
      ],
    };
  }

  if (event.type === 'assistant_message') {
    const toolCalls = event.message.toolCalls || [];
    if (toolCalls.length > 0) {
      return {
        steps: toolCalls.map((call) => ({
          id: call.id,
          name: call.toolName,
          status: 'pending' as const,
          detail: call.reason || '等待工具执行',
          category: 'tool' as const,
          eventType: event.type,
          toolName: call.toolName,
          toolCallId: call.id,
        })),
      };
    }

    return {
      steps: [],
      content: event.message.content,
    };
  }

  if (event.type === 'tool_call') {
    return {
      steps: [
        {
          id: event.toolCallId,
          name: event.toolName,
          status: 'running',
          detail: event.reason || '正在执行工具',
          category: 'tool',
          eventType: event.type,
          toolName: event.toolName,
          toolCallId: event.toolCallId,
        },
      ],
    };
  }

  if (event.type === 'tool_progress') {
    const stage = event.stage ? `${event.stage}: ` : '';
    const percent = typeof event.percent === 'number' ? ` (${event.percent}%)` : '';
    return {
      steps: [
        {
          id: event.toolCallId,
          name: event.toolName,
          status: 'running',
          detail: `${stage}${event.message || '正在执行'}${percent}`,
          category: 'tool',
          eventType: event.type,
          toolName: event.toolName,
          toolCallId: event.toolCallId,
        },
      ],
    };
  }

  if (event.type === 'tool_observation') {
    const ok = event.ok && event.observation.ok !== false;
    return {
      steps: [
        {
          id: event.toolCallId,
          name: event.toolName,
          status: ok ? 'completed' : 'failed',
          detail: summarizeToolObservation(event),
          category: extractGisDataFromAgentLoopEvent(event) ? 'gis' : 'tool',
          eventType: event.type,
          toolName: event.toolName,
          toolCallId: event.toolCallId,
        },
      ],
    };
  }

  if (event.type === 'loop_stop') {
    const failed = event.result.stoppedBy === 'model_error' || event.result.stoppedBy === 'aborted';
    return {
      content: event.result.finalAnswer,
      completeOpenStepsAs: failed ? 'failed' : 'completed',
      logFilePath: event.result.logFilePath,
      steps: [
        {
          id: `loop-stop-${event.turn}`,
          name: 'Loop Stop',
          status: failed ? 'failed' : 'completed',
          detail: `stoppedBy=${event.result.stoppedBy}; turns=${event.result.turns}`,
          category: 'result',
          eventType: event.type,
        },
      ],
    };
  }

  return { steps: [] };
}

export function summarizeToolObservation(
  event: Extract<AgentLoopEvent, { type: 'tool_observation' }>
): string {
  const output = asRecord(event.observation.output);
  const error = event.observation.error?.message;
  if (!event.ok || event.observation.ok === false) return error || '工具调用失败';

  if (event.toolName === 'RegionResolve') {
    if (output.resolved === false) return '未解析到可信区域';
    const selected = asRecord(output.selected);
    const name = stringValue(selected.name) || stringValue(output.regionName);
    return name ? `已解析区域：${name}` : '区域解析完成';
  }

  if (event.toolName === 'RegionMark') {
    const name = stringValue(output.regionName) || firstRegionName(output);
    return name ? `地图区域已生成：${name}` : '地图区域已生成';
  }

  if (event.toolName === 'WeatherFetch') {
    const summary = stringValue(output.summary);
    const coverage = asRecord(output.coverage);
    const valid = numberValue(coverage.validWindPoints);
    const total = numberValue(coverage.totalWindPoints);
    const coverageText =
      typeof valid === 'number' && typeof total === 'number' ? `；风场覆盖 ${valid}/${total}` : '';
    return summary ? `${summary}${coverageText}` : `天气数据已获取${coverageText}`;
  }

  const summary = stringValue(output.summary);
  if (summary) return summary;

  const rows = output.rows;
  if (Array.isArray(rows)) return `返回 ${rows.length} 行数据`;

  return '工具调用完成';
}

function firstRegionName(output: Record<string, unknown>): string | undefined {
  const gisData = asRecord(output.gisData);
  const regions = gisData.regions;
  if (!Array.isArray(regions)) return undefined;
  const first = asRecord(regions[0]);
  return stringValue(first.name);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
