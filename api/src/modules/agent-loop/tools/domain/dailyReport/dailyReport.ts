import { z } from "zod";
import { createConnection } from "mysql2/promise";
import type { Connection, RowDataPacket } from "mysql2/promise";
import type { ToolDefinition, ToolExecutionContext } from "../../_shared/types.js";
import { buildDailyReportSql, type DailyReportType } from "./dailyReportSql.js";
import {
  FIELD_LABELS,
  type DailyReportDataRow,
  type DailyReportInput,
  type DailyReportOutput,
  type ChartRenderDataOutput,
} from "./dailyReportTypes.js";

const DAILY_REPORT_TIMEOUT_MS = 120_000;
const MAX_RESULT_SIZE_CHARS = 100_000;
const REPORT_OUTPUT_DIR = process.env.DAILY_REPORT_OUTPUT_DIR || "api/tmp/agent-loop/reports";

const DAILY_REPORT_MODEL_API_KEY = process.env.QWEN_API_KEY || process.env.DAILY_REPORT_MODEL_API_KEY || "";
const DAILY_REPORT_MODEL_API_URL =
  process.env.QWEN_API_URL ||
  process.env.DAILY_REPORT_MODEL_API_URL ||
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const DAILY_REPORT_MODEL = process.env.QWEN_MODEL || process.env.DAILY_REPORT_MODEL || "qwen-plus";
const DAILY_REPORT_MODEL_TIMEOUT_MS = parsePositiveIntegerEnv(
  process.env.QWEN_API_TIMEOUT_MS || process.env.DAILY_REPORT_MODEL_TIMEOUT_MS,
  120_000
);

function parsePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const ReportTypeSchema = z.enum(["all", "buckle", "event"]);

const DailyReportInputSchema = z.strictObject({
  query: z
    .string()
    .min(1)
    .describe(
      "Date description for the report, such as '今天', '昨天', '前天', '2025-11-10', or '2025年11月10日'. If omitted, today is used."
    ),
  report_type: ReportTypeSchema.default("all").describe(
    "Report category: 'all' (default), 'buckle', or 'event'."
  ),
});

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

function extractDate(input: string): string {
  const today = new Date();
  const normalized = input.toLowerCase().replace(/\s+/g, "");

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

  const isoMatch = input.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const cnMatch = input.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (cnMatch) {
    const [, y, m, d] = cnMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  return today.toISOString().slice(0, 10);
}

function getMidnightStrings(targetDate: string): { startTime: string; endTime: string } {
  const dateObj = new Date(`${targetDate}T00:00:00`);
  const midnightToday = new Date(dateObj);
  const midnightTomorrow = new Date(dateObj);
  midnightTomorrow.setDate(midnightTomorrow.getDate() + 1);
  midnightTomorrow.setSeconds(midnightTomorrow.getSeconds() - 1);

  return {
    startTime: midnightToday.toISOString().slice(0, 19).replace("T", " "),
    endTime: midnightTomorrow.toISOString().slice(0, 19).replace("T", " "),
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
  const labels = FIELD_LABELS[reportType];
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

async function runMysqlQuery(sql: string): Promise<DailyReportDataRow[]> {
  const connection = await createMysqlConnection(DAILY_REPORT_TIMEOUT_MS);
  try {
    const [rows] = await connection.execute<RowDataPacket[]>(sql);
    return (rows as DailyReportDataRow[]) || [];
  } finally {
    await connection.end().catch(() => undefined);
  }
}

function buildDailyReportCharts(
  reportType: DailyReportType,
  row: DailyReportDataRow
): ChartRenderDataOutput[] {
  const charts: ChartRenderDataOutput[] = [];

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

function buildSystemPrompt(reportType: DailyReportType): string {
  const base = `你是一位资深的边防执勤数据分析专家，具有丰富的安全态势分析、设备运维管理和风险预警经验。
你始终用中文进行思考和回答问题。
本项目是基于新疆地区边防管控为背景，有三个主要对象，传感器、事件、事件处置。检测非法入境和非法出境的人车等。
检测到非法入境和出境的人和车即记录为一次事件，这些事件需要执勤房/警卫站的值班人员及时处置，并记录在处置表中。

## 整体要求-重要必须遵守
- 智能体及工具调用的思考过程和回答必须为中文。
- 思考过程中禁止出现代码块、表格信息。
- 所有数值必须来自传入数据，不得猜测或填充虚构数值，不用考虑数据合理性，直接填入。
- 不用考虑数据可行性与准确性及合理性，直接使用传入的数据。

## 严格约束（必须遵守）
你是一个中文智能助手，必须全程使用**简体中文**进行思考和回答。
- 所有解释、推理、分析、总结都必须用中文；
- **禁止出现任何英文句子、短语或解释性文字**；
- 技术名词（如字段名、函数名、SQL关键字）可保留原文，但**前后必须用中文包围，且不得对它们用英文解释**；
- 如果需要引用代码、SQL、JSON、Markdown 等，用代码块包裹，其余文字一律中文；
- 思考过程必须使用中文。

## 输出要求
- 图表引用格式：![图表描述](chart://<chart_id>)
- 格式严格按照最终输出格式示例输出填写。
- 只允许替换 XXX部分、XX部分、图片部分。
- 替换图片没有地址时去除图片相关部分。
- 表格中没有XXX部分，不要修改。
- 你最终输出必须是标准 markdown。
- 传入的图片存在地址时，必须替换图片地址。
`;

  if (reportType === "all") {
    return (
      base +
      `
## 最终输出格式示例
# 总体日报
**统计周期： 20XX年XX月XX日 00:00 - 20XX年XX月XX日 23:59**

## 一、 核心指标概览
本周期内，系统共捕获预警事件 XXX 起。
- **有效告警（入侵）**： XXX 起。
- **处理完成率**： XXX%
- **平均处理时长**： XXX 秒
- **1000s 处理达标率**： XXX%

## 二、 摄像头运行状态分析
1. **传感器状态**
- **设备总量**：XXX 台
- **在线状态**： 在线 XXX 台 / 离线 XXX 台（在线率：XXX%）
- **前三高发预警点位**： XXX（ XXX 次）、XXX（ XXX 次）、XXX（ XXX 次）

2. **监测层分析要点**
- **高频触发**： 告警触发最频繁的设备为 XXX，共触发 XXX 次。

## 三、 预警事件深度分析
1. **预警分类结构**

| 预警等级 | 预警分类名称 | 事件数量 | 占比 | 响应均时 |
| :---: | :---: | :---: | :---: | :---: |
| **一级(高风险)** | 入侵 | XXX | XXX% | XXXs |
| **二级(潜在风险)** | 触碰/调整/维修 | XXX | XXX% | XXXs |
| **三级** | 其他 | XXX | XXX%  | / |

2. **告警时空分布特征**
- **高发时段** ： XXX:00 - XXX:00（触发 XXX 次）

![预警等级占比饼图](chart://<pie_chart_id>)

## 四、卡口往来数据分析
1. **卡口流量概览**
本周期内，各卡口共记录往来事件 XXX 起。
- **人员通行**： XXX 人次
- **车辆通行**： XXX 辆次
- **通行结果**： 正常进入 XXX 起，正常离开 XXX 起，拒绝进入 XXX 起。

2. **往来对象风险研判**

| 名单类型 | 进场次数 | 涉及人数/车数 | 风险说明 |
| :---: | :---: | :---: | :---: |
| **黑名单** | XXX | XXX | 触发系统严正预警，需核实处置记录 |
| **陌生人** | XXX | XXX | 自动转为临时白名单关注 |
| **白名单** | XXX | XXX | 常规通行（工作人员/牧民等）|

3. **滞留风险监控** (超时分析)
- **滞留风险报警**： XXX 起
- **当前仍滞留对象**： XXX 个。

![卡口繁忙度Top5柱状图](chart://<bar_chart_id>)

## 五、异常研判和改进建议
（根据智能体研判自动生成）
`
    );
  }

  if (reportType === "buckle") {
    return (
      base +
      `
## 最终输出格式示例
# 卡口往来日报
**统计周期： 20XX年XX月XX日 00:00 - 20XX年XX月XX日 23:59**

1. **卡口流量概览**
本周期内，各卡口共记录往来事件 XXX 起。
- **人员通行**： XXX 人次
- **车辆通行**： XXX 辆次
- **通行结果**： 正常进入 XXX 起，正常离开 XXX 起，拒绝进入 XXX 起。

2. **往来对象风险研判**

| 名单类型 | 进场次数 | 涉及人数/车数 | 风险说明 |
| :---: | :---: | :---: | :---: |
| **黑名单** | XXX | XXX | 触发系统严正预警，需核实处置记录 |
| **陌生人** | XXX | XXX | 自动转为临时白名单关注 |
| **白名单** | XXX | XXX | 常规通行（工作人员/牧民等）|

3. **滞留风险监控**
- **滞留风险报警**： XXX 起
- **当前仍滞留对象**： XXX 个。

![卡口繁忙度Top5柱状图](chart://<bar_chart_id>)
`
    );
  }

  return (
    base +
    `
## 最终输出格式示例
# 预警事态日报
**统计周期： 20XX年XX月XX日 00:00 - 20XX年XX月XX日 23:59**

## 一、 核心指标概览
本周期内，系统共捕获预警事件 XXX 起。
- **有效告警（入侵）**： XXX 起。
- **处理完成率**： XXX%
- **平均处理时长**： XXX 秒
- **1000s 处理达标率**： XXX%

## 二、 摄像头运行状态分析
1. **传感器状态**
- **设备总量**：XXX 台
- **在线状态**： 在线 XXX 台 / 离线 XXX 台（在线率：XXX%）
- **前三高发预警点位**： XXX（ XXX 次）、XXX（ XXX 次）、XXX（ XXX 次）

## 三、 预警事件深度分析
1. **预警分类结构**

| 预警等级 | 预警分类名称 | 事件数量 | 占比 | 响应均时 |
| :---: | :---: | :---: | :---: | :---: |
| **一级(高风险)** | 入侵 | XXX | XXX% | XXXs |
| **二级(潜在风险)** | 触碰/调整/维修 | XXX | XXX% | XXXs |
| **三级** | 其他 | XXX | XXX%  | / |

2. **告警时空分布特征**
- **高发时段** ： XXX:00 - XXX:00（触发 XXX 次）

![预警等级占比饼图](chart://<pie_chart_id>)

## 四、异常研判和改进建议
（根据智能体研判自动生成）
`
  );
}

async function generateReportWithModel(
  reportType: DailyReportType,
  date: string,
  dataResult: string,
  charts: ChartRenderDataOutput[],
  context: ToolExecutionContext
): Promise<string> {
  const systemPrompt = buildSystemPrompt(reportType);
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

  if (!DAILY_REPORT_MODEL_API_KEY) {
    console.warn("[DailyReport] LLM API key not configured, returning fallback report.");
    return fallback;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DAILY_REPORT_MODEL_TIMEOUT_MS);

    const response = await fetch(DAILY_REPORT_MODEL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DAILY_REPORT_MODEL_API_KEY}`,
      },
      body: JSON.stringify({
        model: DAILY_REPORT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM API error: ${response.status} ${text}`);
    }

    const json = (await response.json()) as Record<string, unknown>;
    const content = (json.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content;

    if (typeof content === "string" && content.trim()) {
      return content;
    }

    throw new Error("LLM response did not contain content");
  } catch (err) {
    console.error("[DailyReport] LLM generation failed:", (err as Error).message);
    return fallback;
  }
}

export function buildDailyReportTool(): ToolDefinition {
  return {
    name: "DailyReport",
    displayName: "日报生成",
    aliases: ["daily-report", "daily_report"],
    description:
      "Generate a border-defense daily report for a specific date. Input: {\"query\":\"今天\",\"report_type\":\"all\"}. Supports report types: all, buckle, event. The tool executes local SQL templates and uses LLM to generate the report content.",
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
      const { startTime, endTime } = getMidnightStrings(date);

      context.onProgress?.({
        stage: "start",
        message: `正在生成 ${date} 的${reportType}日报`,
      });

      try {
        const sql = buildDailyReportSql(reportType, startTime, endTime);
        const rows = await runMysqlQuery(sql);

        if (rows.length === 0) {
          return {
            date,
            report_type: reportType,
            report_content: `当前时间范围内暂无相关数据（${date}）。`,
            charts: [],
            executionTime: Date.now() - start,
            source: "daily-report-local",
          };
        }

        const row = rows[0] as DailyReportDataRow;
        const dataResult = formatDataResult(reportType, row);
        const charts = buildDailyReportCharts(reportType, row);
        const reportContent = await generateReportWithModel(
          reportType,
          date,
          dataResult,
          charts,
          context
        );

        context.onProgress?.({
          stage: "complete",
          message: `${date} 的${reportType}日报生成完成`,
        });

        return {
          date,
          report_type: reportType,
          report_content: reportContent,
          charts,
          executionTime: Date.now() - start,
          source: "daily-report-local",
        };
      } catch (err) {
        throw new Error(`日报生成失败: ${(err as Error).message}`);
      }
    },
  };
}
