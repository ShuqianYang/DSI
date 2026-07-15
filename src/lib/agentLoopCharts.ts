import type { AgentLoopEvent } from '@datasourceintelligence/shared';
import type { ChartData } from '@/types/prd';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isChartData(value: unknown): value is ChartData {
  if (!isRecord(value)) return false;
  const chartType = value.chart_type;
  if (chartType !== 'bar' && chartType !== 'line' && chartType !== 'pie') return false;
  if (typeof value.title !== 'string' || typeof value.chart_id !== 'string') return false;
  if (!Array.isArray(value.data)) return false;
  if (!isRecord(value.config)) return false;
  return true;
}

function readChartsFromOutput(output: Record<string, unknown>): ChartData[] {
  const charts: ChartData[] = [];

  // 1. Direct charts array (e.g. from DailyReport or ChartRenderData)
  const directCharts = output.charts;
  if (Array.isArray(directCharts)) {
    for (const item of directCharts) {
      if (isChartData(item)) {
        charts.push(item);
      }
    }
  }

  // 2. Nested in data.charts (legacy shape)
  const nested = asRecord(output.data);
  const nestedCharts = nested.charts;
  if (Array.isArray(nestedCharts)) {
    for (const item of nestedCharts) {
      if (isChartData(item)) {
        charts.push(item);
      }
    }
  }

  // 3. The output itself is a chart (ChartRenderData returns a single chart object)
  if (isChartData(output)) {
    charts.push(output);
  }

  return charts;
}

export function extractChartsFromAgentLoopEvent(event: AgentLoopEvent): ChartData[] {
  if (event.type !== 'tool_observation') return [];

  const observation = asRecord(event.observation);
  const output = asRecord(observation.output);
  return readChartsFromOutput(output);
}

export function extractChartsFromTaskResult(result: Record<string, unknown>): ChartData[] {
  const charts: ChartData[] = [];

  for (const [actionId, stepResult] of Object.entries(result)) {
    if (actionId === 'logFilePath') continue;
    if (!isRecord(stepResult)) continue;

    charts.push(...readChartsFromOutput(stepResult));
  }

  return charts;
}
