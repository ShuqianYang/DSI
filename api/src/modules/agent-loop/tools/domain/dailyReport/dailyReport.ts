import { z } from "zod";
import type { ToolDefinition, ToolExecutionContext } from "../../_shared/types.js";

const DAILY_REPORT_API_URL = process.env.DAILY_REPORT_API_URL || "http://192.168.0.27:18820/daily-report";
const DAILY_REPORT_TIMEOUT_MS = 120_000;
const MAX_RESULT_SIZE_CHARS = 100_000;

const ReportTypeSchema = z.enum(["all", "总体", "设备监控", "预警事态"]);

type ReportType = z.infer<typeof ReportTypeSchema>;

const DailyReportInputSchema = z.strictObject({
  query: z
    .string()
    .min(1)
    .describe(
      "Date description for the report, such as '今天', '昨天', '前天', '2025-11-10', or '2025年11月10日'. If omitted, today is used."
    ),
  report_type: ReportTypeSchema.default("all").describe(
    "Report category: 'all' (default), '总体', '设备监控', or '预警事态'."
  ),
});

type DailyReportInput = z.infer<typeof DailyReportInputSchema>;

interface DailyReportOutput {
  date: string;
  report_type: ReportType;
  report_content: string;
  executionTime: number;
  source: string;
}

interface SseEvent {
  type: string;
  content?: string;
}

/** 从用户输入中提取日期，返回 YYYY-MM-DD 格式 */
function extractDate(input: string): string {
  const today = new Date();
  const normalized = input.toLowerCase().replace(/\s+/g, "");

  // 相对日期
  if (normalized.includes("今天") || normalized.includes("今日")) {
    return today.toISOString().slice(0, 10);
  }
  if (normalized.includes("昨天") || normalized.includes("昨日")) {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().slice(0, 10);
  }
  if (normalized.includes("前天")) {
    const dayBefore = new Date(today);
    dayBefore.setDate(dayBefore.getDate() - 2);
    return dayBefore.toISOString().slice(0, 10);
  }

  // 绝对日期：2025-11-10 / 2025/11/10
  const isoMatch = input.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // 绝对日期：2025年11月10日
  const cnMatch = input.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (cnMatch) {
    const [, y, m, d] = cnMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // 兜底：今天
  return today.toISOString().slice(0, 10);
}

async function callDailyReportApi(query: string, reportType: ReportType): Promise<string> {
  const controller = new AbortController();
  let streamTimeout: ReturnType<typeof setTimeout> | null = null;
  let hasReceivedChunk = false;

  const startStreamTimeout = () => {
    if (hasReceivedChunk) return;
    hasReceivedChunk = true;
    streamTimeout = setTimeout(() => controller.abort(), DAILY_REPORT_TIMEOUT_MS);
  };

  try {
    const resp = await fetch(DAILY_REPORT_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ query, report_type: reportType }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new Error(`Daily report API error: ${resp.status} ${resp.statusText}`);
    }

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const contentParts: string[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        startStreamTimeout();
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let data: SseEvent;
          try {
            data = JSON.parse(raw);
          } catch {
            continue;
          }

          if ((data.type === "thinking" || data.type === "typing") && data.content) {
            contentParts.push(data.content);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError" && contentParts.length > 0) {
        return contentParts.join("");
      }
      throw err;
    }

    return contentParts.join("");
  } finally {
    if (streamTimeout) clearTimeout(streamTimeout);
  }
}

export function buildDailyReportTool(): ToolDefinition {
  return {
    name: "DailyReport",
    aliases: ["daily-report", "daily_report"],
    description:
      "Generate a border-defense daily report for a specific date. Input: {\"query\":\"今天\",\"report_type\":\"all\"}. Supports report types: all, 总体, 设备监控, 预警事态. The tool calls the daily-report API and returns the generated report content.",
    kind: "domain",
    inputSchema: DailyReportInputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    maxResultSizeChars: MAX_RESULT_SIZE_CHARS,
    async execute(input, context) {
      const start = Date.now();
      const parsed = input as DailyReportInput;
      const date = extractDate(parsed.query);
      const reportType = parsed.report_type;

      context.onProgress?.({
        stage: "start",
        message: `Generating daily report for ${date} (${reportType})`,
      });

      try {
        const reportContent = await callDailyReportApi(date, reportType);

        context.onProgress?.({
          stage: "complete",
          message: `Daily report generated for ${date} (${reportType}), ${reportContent.length} chars`,
        });

        return {
          date,
          report_type: reportType,
          report_content: reportContent,
          executionTime: Date.now() - start,
          source: "daily-report-api",
        };
      } catch (err) {
        throw new Error(`日报生成服务调用失败: ${(err as Error).message}`);
      }
    },
  };
}
