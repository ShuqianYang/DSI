import "dotenv/config";
import type { Connection } from "mysql2/promise";
import { buildDefaultToolRegistry } from "../../src/modules/agent-loop/tools/_shared/toolRegistry.js";
import type { ModelClient } from "../../src/modules/agent-loop/modelClient.js";
import type {
  AgentLoopEvent,
  NormalizedAgentDecision,
  ToolDefinition,
  ToolObservation,
} from "../../src/modules/agent-loop/tools/_shared/types.js";
import type { AgentLoopTaskResult } from "../../src/modules/tasks/agentLoopResultProjection.js";
import { setCreateConnectionOverride } from "../../src/modules/agent-loop/tools/domain/dailyReport/dailyReport.js";

export const DAILY_REPORT_SCENARIO = "daily-report";
export const DAILY_REPORT_TOOLS = ["DailyReport"] as const;
export const DAILY_REPORT_QUERY = "生成昨天的边防日报。";

export interface DailyReportValidationInput {
  rawEvents: AgentLoopEvent[];
  projectedResult: AgentLoopTaskResult;
}

export interface DailyReportValidationReport {
  toolOrder: string[];
  date: string;
  reportType: string;
  contentLength: number;
  chartCount: number;
}

function createMockConnection(): Connection {
  return {
    execute: async (sql: string) => {
      const normalizedSql = String(sql).toLowerCase();
      if (normalizedSql.includes("from alarm_event") || normalizedSql.includes("from buckle_access_record")) {
        return [
          [
            {
              total_alarms: 15,
              valid_intrusion: 5,
              handle_rate: 93.33,
              avg_handle_seconds: 420,
              sla_rate: 88.5,
              device_total: 128,
              online_count: 120,
              offline_count: 8,
              online_rate: 93.75,
              top1_name: "一号点位",
              top1_count: 6,
              top2_name: "二号点位",
              top2_count: 4,
              top3_name: "三号点位",
              top3_count: 3,
              most_freq_device: "一号点位",
              most_freq_count: 6,
              level1_count: 5,
              level1_ratio: 33.33,
              level1_avg_sec: 380,
              level2_count: 6,
              level2_ratio: 40,
              level2_avg_sec: 450,
              level3_count: 4,
              level3_ratio: 26.67,
              peak_start_hour: 9,
              peak_end_hour: 10,
              peak_count: 5,
              total_access: 1024,
              person_times: 680,
              vehicle_times: 344,
              normal_entry: 900,
              normal_leave: 100,
              reject_entry: 24,
              black_count: 3,
              black_objects: 2,
              stranger_count: 12,
              stranger_objects: 8,
              white_count: 1009,
              white_objects: 120,
              stay_cnt: 2,
              curr_stay_cnt: 1,
              top5_busy_buckle: JSON.stringify([
                { buckle_id: "b1", buckle_name: "A卡口", total_access_count: 256 },
                { buckle_id: "b2", buckle_name: "B卡口", total_access_count: 198 },
                { buckle_id: "b3", buckle_name: "C卡口", total_access_count: 176 },
                { buckle_id: "b4", buckle_name: "D卡口", total_access_count: 142 },
                { buckle_id: "b5", buckle_name: "E卡口", total_access_count: 98 },
              ]),
            },
          ],
          [],
        ];
      }
      return [[], []];
    },
    end: async () => undefined,
  } as unknown as Connection;
}

export function installMockDailyReportMysql(): () => void {
  setCreateConnectionOverride(async () => createMockConnection());
  return () => setCreateConnectionOverride(undefined);
}

export function createDailyReportSmokeModelClient(): ModelClient {
  return {
    async decide(input): Promise<NormalizedAgentDecision> {
      const dailyReportObservation = findObservation(input.observations, "DailyReport");

      if (!dailyReportObservation) {
        return {
          type: "tool_calls",
          content: "Generating the daily security report for the requested date.",
          toolCalls: [
            {
              id: "daily-report-call-1",
              toolName: "DailyReport",
              input: {
                date: "2026-06-16",
                report_type: "all",
              },
              reason: "User requested a daily security report for yesterday.",
            },
          ],
        };
      }

      if (!dailyReportObservation.ok) {
        return {
          type: "final_answer",
          content: `DailyReport tool failed: ${dailyReportObservation.error?.message ?? "unknown error"}.`,
        };
      }

      const output = objectRecord(dailyReportObservation.output);
      const date = readString(output.date) ?? "";
      const reportType = readString(output.report_type) ?? "";
      const content = readString(output.report_content) ?? "";

      return {
        type: "final_answer",
        content: `已为您生成 ${date} 的日报（类型：${reportType}）。\n\n关键信息：\n${content.slice(0, 500)}`,
      };
    },
  };
}

export function validateDailyReportSmoke(input: DailyReportValidationInput): DailyReportValidationReport {
  const observations = input.rawEvents.filter(
    (event): event is Extract<AgentLoopEvent, { type: "tool_observation" }> => event.type === "tool_observation"
  );

  const dailyReport = requireObservation(observations, "DailyReport");
  assertCondition(dailyReport.ok, "DailyReport observation failed.");

  const output = objectRecord(dailyReport.observation.output);
  const date = readString(output.date) ?? "";
  const reportType = readString(output.report_type) ?? "";
  const content = readString(output.report_content) ?? "";
  const charts = Array.isArray(output.charts) ? output.charts : [];

  assertCondition(/^\d{4}-\d{2}-\d{2}$/.test(date), `DailyReport returned invalid date format: ${date}`);
  assertCondition(reportType.length > 0, "DailyReport returned empty report_type.");
  assertCondition(content.length > 0, "DailyReport returned empty report_content.");

  const toolOrder = observations.map((event) => event.toolName);
  assertCondition(
    toolOrder.includes("DailyReport"),
    `Missing DailyReport in tool observation order: ${toolOrder.join(" -> ")}`
  );

  assertCondition(
    input.projectedResult.stoppedBy === "final_answer",
    `Agent loop did not stop with final_answer: ${input.projectedResult.stoppedBy}`
  );

  return {
    toolOrder,
    date,
    reportType,
    contentLength: content.length,
    chartCount: charts.length,
  };
}

export function getDailyReportTool(): ToolDefinition {
  const registry = buildDefaultToolRegistry();
  const tool = registry.get("DailyReport");
  if (!tool) {
    throw new Error("DailyReport tool is not registered");
  }
  return tool;
}

function findObservation(observations: ToolObservation[], toolName: string): ToolObservation | undefined {
  return observations.find((observation) => observation.toolName === toolName);
}

function requireObservation(
  observations: Array<Extract<AgentLoopEvent, { type: "tool_observation" }>>,
  toolName: string
): Extract<AgentLoopEvent, { type: "tool_observation" }> {
  const observation = observations.find((event) => event.toolName === toolName);
  if (!observation) {
    throw new Error(`Missing ${toolName} tool_observation.`);
  }
  return observation;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
