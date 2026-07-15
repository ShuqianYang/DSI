import { z } from "zod";
import type { ToolDefinition } from "../../_shared/types.js";

const ChartTypeSchema = z.enum(["auto", "bar", "line", "pie"]);

export const ChartRenderDataInputSchema = z.strictObject({
  chart_type: ChartTypeSchema.default("auto").describe(
    "图表类型：auto（自动推荐）、bar（柱状图）、line（折线图）、pie（饼图）"
  ),
  data: z
    .array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])))
    .min(1)
    .describe("来自 MysqlQuery 的结果行数据"),
  title: z.string().min(1).describe("图表标题"),
  x_key: z.string().optional().describe("柱状图/折线图的 X 轴字段"),
  y_key: z.string().optional().describe("柱状图/折线图的 Y 轴字段"),
  label_key: z.string().optional().describe("饼图的标签字段"),
  value_key: z.string().optional().describe("饼图的数值字段"),
  series_keys: z.array(z.string()).optional().describe("折线图的多系列字段"),
});

export type ChartRenderDataInput = z.infer<typeof ChartRenderDataInputSchema>;

export interface ChartRenderDataOutput {
  chart_type: "bar" | "line" | "pie";
  title: string;
  chart_id: string;
  data: Record<string, unknown>[];
  config: {
    x_axis?: string;
    y_axis?: string;
    label_key?: string;
    value_key?: string;
    series_keys?: string[];
  };
}

function isNumeric(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function isString(value: unknown): boolean {
  return typeof value === "string";
}

function inferKeys(data: Record<string, unknown>[]): {
  stringKeys: string[];
  numericKeys: string[];
} {
  if (data.length === 0) {
    return { stringKeys: [], numericKeys: [] };
  }
  const keys = Object.keys(data[0]);
  const stringKeys = keys.filter((key) => data.every((row) => isString(row[key])));
  const numericKeys = keys.filter((key) => data.every((row) => isNumeric(row[key])));
  return { stringKeys, numericKeys };
}

function suggestChartType(data: Record<string, unknown>[], xKey?: string): "bar" | "line" | "pie" {
  if (data.length === 0) {
    return "bar";
  }

  const { stringKeys, numericKeys } = inferKeys(data);

  // 明确指定了时间字段 → 折线图
  if (xKey && /time|date|day|hour|month|year/i.test(xKey)) {
    return "line";
  }

  // 只有两列：一列字符串 + 一列数值
  if (stringKeys.length === 1 && numericKeys.length === 1) {
    // 分类数少 → 饼图，否则柱状图
    return data.length <= 5 ? "pie" : "bar";
  }

  // 默认柱状图
  return "bar";
}

function buildConfig(input: ChartRenderDataInput, chartType: "bar" | "line" | "pie"): ChartRenderDataOutput["config"] {
  const { stringKeys, numericKeys } = inferKeys(input.data);

  if (chartType === "pie") {
    return {
      label_key:
        input.label_key ||
        (stringKeys.length === 1 ? stringKeys[0] : stringKeys[0]),
      value_key:
        input.value_key ||
        (numericKeys.length === 1 ? numericKeys[0] : numericKeys[0]),
    };
  }

  return {
    x_axis:
      input.x_key ||
      (stringKeys.length === 1 ? stringKeys[0] : stringKeys[0]),
    y_axis:
      input.y_key ||
      (numericKeys.length === 1 ? numericKeys[0] : numericKeys[0]),
    series_keys: input.series_keys,
  };
}

function generateChartId(): string {
  return `chart_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function filterPieData(
  data: Record<string, unknown>[],
  valueKey: string | undefined
): Record<string, unknown>[] {
  if (!valueKey) {
    throw new Error("ChartRenderData pie chart requires a numeric value key");
  }

  return data.filter((row) => {
    const value = row[valueKey];
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  });
}

export function buildChartRenderDataTool(): ToolDefinition {
  return {
    name: "ChartRenderData",
    displayName: "图表数据准备",
    aliases: ["chart-render", "chart_render"],
    description:
      "将 MysqlQuery 返回的表格数据转换为前端 recharts 可用的结构化图表数据。支持 bar/line/pie，chart_type 传 auto 时自动推荐。",
    kind: "domain",
    inputSchema: ChartRenderDataInputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    maxResultSizeChars: 50_000,
    execute(input) {
      const parsed = input as ChartRenderDataInput;
      if (!Array.isArray(parsed.data) || parsed.data.length === 0) {
        throw new Error("ChartRenderData requires non-empty data array");
      }
      const chartType =
        parsed.chart_type === "auto" ? suggestChartType(parsed.data, parsed.x_key) : parsed.chart_type;

      const config = buildConfig(parsed, chartType);
      const chartData =
        chartType === "pie"
          ? filterPieData(parsed.data, config.value_key)
          : parsed.data;
      if (chartData.length === 0) {
        throw new Error("ChartRenderData pie chart requires at least one positive numeric value");
      }
      const output: ChartRenderDataOutput = {
        chart_type: chartType,
        title: parsed.title,
        chart_id: generateChartId(),
        data: chartData,
        config,
      };

      return Promise.resolve(output);
    },
  };
}
