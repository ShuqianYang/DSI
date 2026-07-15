import path from "node:path";
import fs from "node:fs/promises";
import { createConnection } from "mysql2/promise";
import type { Connection, RowDataPacket } from "mysql2/promise";
import type { ToolDefinition, ToolExecutionContext } from "../../_shared/types.js";
import { createTextGenerationClient } from "../../../model/clients/textGenerationClient.js";
import { buildDailyReportSql } from "./dailyReportSql.js";
import { DailyReportInputSchema } from "./dailyReportInput.js";
import { getDailyReportFieldLabels, getDailyReportSystemPrompt } from "./dailyReportResources.js";
import {
  type DailyReportDataRow,
  type DailyReportInput,
  type DailyReportOutput,
  type DailyReportType,
  type ChartRenderDataOutput,
} from "./dailyReportTypes.js";
import { resolveDailyReportOutputDir } from "./reportOutputDir.js";

const DAILY_REPORT_TIMEOUT_MS = 120_000;
const MAX_RESULT_SIZE_CHARS = 100_000;
const REPORT_OUTPUT_DIR = resolveDailyReportOutputDir();

function getMysqlDatabaseConfig(): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} {
  return {
    host: process.env.BORDER_DEFENSE_DB_HOST || "127.0.0.1",
    port: Number(process.env.BORDER_DEFENSE_DB_PORT || "3306"),
    user: process.env.BORDER_DEFENSE_DB_USER || "",
    password: process.env.BORDER_DEFENSE_DB_PASSWORD || "",
    database: process.env.BORDER_DEFENSE_DB_NAME || "xjzhdd_bj",
  };
}

let createConnectionOverride: ((timeoutMs: number) => Promise<Connection>) | undefined;

export function setCreateConnectionOverride(
  override: ((timeoutMs: number) => Promise<Connection>) | undefined
): void {
  createConnectionOverride = override;
}

async function createMysqlConnection(timeoutMs: number): Promise<Connection> {
  if (createConnectionOverride) {
    return createConnectionOverride(timeoutMs);
  }

  const config = getMysqlDatabaseConfig();
  if (!config.user || !config.database) {
    throw new Error("MySQL border-defense database is missing required configuration (user/database).");
  }

  return createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectTimeout: timeoutMs,
    multipleStatements: false,
    rowsAsArray: false,
  });
}

function getMidnightStrings(targetDate: string): { startTime: string; endTime: string } {
  return {
    startTime: `${targetDate} 00:00:00`,
    endTime: `${targetDate} 23:59:59`,
  };
}

function formatTop5BusyBuckle(value: unknown): string {
  if (!value || value === "[]") return "无数据";
  try {
    const data = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
    if (!Array.isArray(data) || data.length === 0) return "无数据";
    const rows = data as Array<{ buckle_id?: string; buckle_name?: string; total_access_count?: number }>;
    const lines = ["| 卡口ID | 卡口名称 | 往来对象数量 |", "| :----- | :------- | :----------- |"];
    for (const item of rows) {
      lines.push(
        `| ${item.buckle_id ?? ""} | ${item.buckle_name ?? ""} | ${item.total_access_count ?? ""} |`
      );
    }
    return lines.join("\n");
  } catch {
    return String(value);
  }
}

function formatDataResult(reportType: DailyReportType, row: DailyReportDataRow): string {
  const labels = getDailyReportFieldLabels()[reportType];
  const parts: string[] = [];

  for (const [key, value] of Object.entries(row)) {
    if (value === undefined || value === null) continue;
    const label = labels[key] ?? key;
    if (key === "top5_busy_buckle") {
      parts.push(`${label}：\n${formatTop5BusyBuckle(value)}`);
    } else {
      parts.push(`${label}： ${value}`);
    }
  }

  return parts.join("\n");
}

async function runMysqlQuery(sql: string, signal?: AbortSignal): Promise<DailyReportDataRow[]> {
  const connection = await createMysqlConnection(DAILY_REPORT_TIMEOUT_MS);
  if (signal?.aborted) {
    connection.destroy();
    throw new Error(typeof signal.reason === "string" ? signal.reason : "任务已停止");
  }
  const abortConnection = () => connection.destroy();
  signal?.addEventListener("abort", abortConnection, { once: true });
  try {
    const [rows] = await connection.execute<RowDataPacket[]>(sql);
    return (rows as DailyReportDataRow[]) || [];
  } catch (error) {
    if (signal?.aborted) {
      throw new Error(typeof signal.reason === "string" ? signal.reason : "任务已停止");
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", abortConnection);
    await connection.end().catch(() => undefined);
  }
}

function buildDailyReportCharts(
  reportType: DailyReportType,
  row: DailyReportDataRow
): ChartRenderDataOutput[] {
  const charts: ChartRenderDataOutput[] = [];

  if (reportType === "all" || reportType === "event") {
    const onlineCount = Number(row.online_count ?? 0);
    const offlineCount = Number(row.offline_count ?? 0);
    const deviceTotal = Number(row.device_total ?? onlineCount + offlineCount);

    if (deviceTotal > 0 || onlineCount > 0 || offlineCount > 0) {
      charts.push({
        chart_type: "pie",
        title: "设备在线状态",
        chart_id: `chart_pie_devices_${Date.now()}`,
        data: [
          { status: "在线", count: onlineCount },
          { status: "离线", count: offlineCount },
        ],
        config: {
          label_key: "status",
          value_key: "count",
        },
      });
    }
  }

  if (reportType === "all" || reportType === "event") {
    const levelData = [
      { level: "一级预警", count: Number(row.level1_count ?? 0) },
      { level: "二级预警", count: Number(row.level2_count ?? 0) },
      { level: "三级预警", count: Number(row.level3_count ?? 0) },
    ].filter((d) => d.count > 0);

    if (levelData.length > 0) {
      charts.push({
        chart_type: "pie",
        title: "预警等级占比",
        chart_id: `chart_pie_levels_${Date.now()}`,
        data: levelData,
        config: {
          label_key: "level",
          value_key: "count",
        },
      });
    }
  }

  if (reportType === "all" || reportType === "buckle") {
    const top5 = formatTop5BusyBuckle(row.top5_busy_buckle);
    if (top5 !== "无数据") {
      try {
        const parsed = JSON.parse(String(row.top5_busy_buckle ?? "[]")) as Array<{
          buckle_name?: string;
          total_access_count?: number;
        }>;
        if (Array.isArray(parsed) && parsed.length > 0) {
          charts.push({
            chart_type: "bar",
            title: "卡口繁忙度Top5",
            chart_id: `chart_bar_buckle_${Date.now()}`,
            data: parsed.map((item) => ({
              buckle_name: item.buckle_name ?? "未知",
              count: item.total_access_count ?? 0,
            })),
            config: {
              x_axis: "buckle_name",
              y_axis: "count",
            },
          });
        }
      } catch {
        // ignore invalid JSON
      }
    }
  }

  return charts;
}

function appendMissingChartPlaceholders(
  content: string,
  charts: ChartRenderDataOutput[]
): string {
  const missing = charts.filter((chart) => !content.includes(`chart://${chart.chart_id}`));
  if (missing.length === 0) return content;

  const placeholders = missing
    .map((chart) => `![${chart.title}](chart://${chart.chart_id})`)
    .join("\n\n");
  return `${content.trimEnd()}\n\n## 数据图表\n\n${placeholders}\n`;
}

async function generateReportWithModel(
  reportType: DailyReportType,
  date: string,
  dataResult: string,
  charts: ChartRenderDataOutput[],
  context: ToolExecutionContext
): Promise<{ content: string; generation: DailyReportOutput["generation"] }> {
  const systemPrompt = getDailyReportSystemPrompt(reportType);
  const chartPlaceholders = charts
    .map((chart) => {
      if (chart.chart_type === "pie") {
        return `![${chart.title}](chart://${chart.chart_id})`;
      }
      if (chart.chart_type === "bar") {
        return `![${chart.title}](chart://${chart.chart_id})`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");

  const userPrompt = `${date}的数据情况如下：\n\n${dataResult}\n\n${chartPlaceholders}\n\n请根据上述数据，生成日报。严格按照输出格式示例填写，只替换 XXX/XX/图片部分。`;

  context.onProgress?.({
    stage: "progress",
    message: "正在调用模型生成日报内容",
  });

  const fallback = `# ${reportType === "all" ? "总体日报" : reportType === "buckle" ? "卡口往来日报" : "预警事态日报"}
**统计周期： ${date} 00:00 - ${date} 23:59**

${dataResult}

${chartPlaceholders}
`;

  try {
    const client = createTextGenerationClient("DAILY_REPORT");
    const modelStartedAt = Date.now();
    const heartbeat = setInterval(() => {
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - modelStartedAt) / 1000));
      context.onProgress?.({
        stage: "progress",
        message: `日报正文生成中，已等待 ${elapsedSeconds} 秒`,
      });
    }, 10_000);
    heartbeat.unref?.();

    try {
      const content = await client.generateText([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ], {
        temperature: 0.1,
        signal: context.signal,
        onRetry: ({ nextAttempt, maxAttempts, error }) => {
          context.onProgress?.({
            stage: "progress",
            message: `日报模型调用失败（${error.message}），正在进行第 ${nextAttempt}/${maxAttempts} 次尝试`,
          });
        },
      });
      return {
        content: appendMissingChartPlaceholders(content, charts),
        generation: { status: "generated", modelUsed: true },
      };
    } finally {
      clearInterval(heartbeat);
    }
  } catch (err) {
    if (context.signal?.aborted) throw err;
    console.error("[DailyReport] LLM generation failed:", (err as Error).message);
    context.onProgress?.({
      stage: "progress",
      message: "日报模型生成失败，已切换为原始数据降级报告",
    });
    return {
      content: fallback,
      generation: {
        status: "degraded",
        modelUsed: false,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

async function saveDailyReportMarkdown(report: DailyReportOutput, taskId: string): Promise<string | undefined> {
  try {
    await fs.mkdir(REPORT_OUTPUT_DIR, { recursive: true });
    const filename = `${report.date}_${report.report_type}_${taskId}.md`;
    const filePath = path.join(REPORT_OUTPUT_DIR, filename);
    await fs.writeFile(filePath, report.report_content, "utf-8");
    return filename;
  } catch (err) {
    console.error("[DailyReport] failed to save markdown:", (err as Error).message);
    return undefined;
  }
}

export function buildDailyReportTool(): ToolDefinition {
  return {
    name: "DailyReport",
    displayName: "日报生成",
    aliases: ["daily-report", "daily_report"],
    description:
      "Generate one border-defense daily report from a selected date and report type. Input: {\"date\":\"2026-07-11\",\"report_type\":\"all\"}. The tool loads SQL, field labels, and Markdown templates from the border-defense-daily-report skill.",
    kind: "domain",
    inputSchema: DailyReportInputSchema,
    isReadOnly: () => false,
    isDestructive: () => true,
    isConcurrencySafe: () => false,
    riskLevel: "high",
    checkPermissions(_input, context) {
      const allowedByActiveSkill = context.toolUseContext?.skillAllowedToolNames?.has("DailyReport") === true;
      if (allowedByActiveSkill) {
        return { behavior: "allow" };
      }
      return {
        behavior: "ask",
        message: "DailyReport can create report artifacts. Load the border-defense-daily-report skill before running it.",
      };
    },
    maxResultSizeChars: MAX_RESULT_SIZE_CHARS,
    async execute(input, context) {
      const start = Date.now();
      const parsed = input as DailyReportInput;
      const date = parsed.date;
      const reportType = parsed.report_type;
      const { startTime, endTime } = getMidnightStrings(date);

      context.onProgress?.({
        stage: "start",
        message: `正在生成 ${date} 的${reportType}日报`,
      });

      try {
        const sql = buildDailyReportSql(reportType, startTime, endTime);
        const rows = await runMysqlQuery(sql, context.signal);

        context.onProgress?.({
          stage: "progress",
          message: "日报数据查询完成，正在整理指标和图表",
        });

        if (rows.length === 0) {
          return {
            date,
            report_type: reportType,
            report_content: `当前时间范围内暂无相关数据（${date}）。`,
            charts: [],
            executionTime: Date.now() - start,
            source: "daily-report-local",
            generation: { status: "not_required", modelUsed: false },
          };
        }

        const row = rows[0] as DailyReportDataRow;
        const dataResult = formatDataResult(reportType, row);
        const charts = buildDailyReportCharts(reportType, row);
        const generated = await generateReportWithModel(
          reportType,
          date,
          dataResult,
          charts,
          context
        );

        context.onProgress?.({
          stage: "complete",
          message: generated.generation.status === "degraded"
            ? `${date} 的${reportType}日报已生成降级版本`
            : `${date} 的${reportType}日报生成完成`,
        });

        const output: DailyReportOutput = {
          date,
          report_type: reportType,
          report_content: generated.content,
          charts,
          executionTime: Date.now() - start,
          source: "daily-report-local",
          generation: generated.generation,
        };

        const markdownFilename = await saveDailyReportMarkdown(output, context.taskId);
        if (markdownFilename) {
          (output as unknown as Record<string, unknown>).markdown_filename = markdownFilename;
        }

        return output;
      } catch (err) {
        throw new Error(`日报生成失败: ${(err as Error).message}`);
      }
    },
  };
}
