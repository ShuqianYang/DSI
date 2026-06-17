import "dotenv/config";
import { buildDefaultToolRegistry } from "../../src/modules/agent-loop/tools/_shared/toolRegistry.js";
import { callTool } from "../../src/modules/agent-loop/tools/_shared/toolGateway.js";
import type { ModelClient } from "../../src/modules/agent-loop/modelClient.js";
import type {
  AgentLoopEvent,
  NormalizedAgentDecision,
  ToolDefinition,
  ToolObservation,
} from "../../src/modules/agent-loop/tools/_shared/types.js";
import type { AgentLoopTaskResult } from "../../src/modules/tasks/agentLoopResultProjection.js";

export const DAILY_REPORT_SCENARIO = "daily-report";
export const DAILY_REPORT_TOOLS = ["DailyReport"] as const;
export const DAILY_REPORT_QUERY = "生成昨天的边防日报。";

const SSE_LINE_PREFIX = "data: ";

export interface DailyReportValidationInput {
  rawEvents: AgentLoopEvent[];
  projectedResult: AgentLoopTaskResult;
}

export interface DailyReportValidationReport {
  toolOrder: string[];
  date: string;
  reportType: string;
  contentLength: number;
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
                query: "昨天",
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

export function installMockDailyReportFetch(options: {
  reportContent?: string;
  httpStatus?: number;
  networkError?: boolean;
}): () => void {
  const restore = createMockDailyReportApiFetch(options);
  const originalFetch = restore();
  return () => {
    globalThis.fetch = originalFetch;
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

function createMockDailyReportApiFetch(options: {
  reportContent?: string;
  httpStatus?: number;
  networkError?: boolean;
}): () => typeof globalThis.fetch {
  const originalFetch = globalThis.fetch;
  return () => {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (!url.includes("/daily-report")) {
        return originalFetch(input, init);
      }

      if (options.networkError) {
        throw new Error("ECONNREFUSED");
      }

      if (options.httpStatus && options.httpStatus >= 400) {
        return new Response(null, { status: options.httpStatus, statusText: "Internal Server Error" });
      }

      const content = options.reportContent ?? "昨日边境态势总体平稳，设备运行正常，未发生重大预警事态。";
      const encoder = new TextEncoder();
      const lines = [
        `${SSE_LINE_PREFIX}${JSON.stringify({ type: "thinking", content: "" })}\n\n`,
        `${SSE_LINE_PREFIX}${JSON.stringify({ type: "typing", content })}\n\n`,
      ].join("");

      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(lines));
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      );
    };
    return originalFetch;
  };
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
