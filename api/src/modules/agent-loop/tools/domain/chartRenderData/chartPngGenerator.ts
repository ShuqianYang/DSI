import { createCanvas, type CanvasRenderingContext2D as NodeCanvasContext } from "canvas";
import type { ChartRenderDataOutput } from "../dailyReport/dailyReportTypes.js";

export interface ChartPngGeneratorOptions {
  width?: number;
  height?: number;
  backgroundColor?: string;
  textColor?: string;
  gridColor?: string;
  colors?: string[];
}

const DEFAULT_COLORS = [
  "#00E0FF",
  "#FFAA00",
  "#44FF44",
  "#FF4444",
  "#FFFF44",
  "#8884d8",
  "#82ca9d",
];

export async function generateChartPng(
  chart: ChartRenderDataOutput,
  options: ChartPngGeneratorOptions = {}
): Promise<Buffer> {
  const {
    width = 800,
    height = 480,
    backgroundColor = "#121212",
    textColor = "#EAEAEA",
    gridColor = "#3A3A4E",
    colors = DEFAULT_COLORS,
  } = options;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  // Title
  ctx.fillStyle = textColor;
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(chart.title, width / 2, 32);

  const margin = { top: 60, right: 40, bottom: 80, left: 64 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  const data = chart.data;
  if (!Array.isArray(data) || data.length === 0) {
    ctx.fillStyle = textColor;
    ctx.font = "14px sans-serif";
    ctx.fillText("暂无数据", width / 2, height / 2);
    return canvas.toBuffer("image/png");
  }

  if (chart.chart_type === "pie") {
    drawPie(ctx, data, chart, margin, chartWidth, chartHeight, textColor, colors);
  } else {
    drawCartesian(ctx, data, chart, margin, chartWidth, chartHeight, textColor, gridColor, colors);
  }

  return canvas.toBuffer("image/png");
}

function getNumericValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getStringValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function drawPie(
  ctx: NodeCanvasContext,
  data: Record<string, unknown>[],
  chart: ChartRenderDataOutput,
  margin: { top: number; right: number; bottom: number; left: number },
  chartWidth: number,
  chartHeight: number,
  textColor: string,
  colors: string[]
) {
  const labelKey = chart.config.label_key ?? Object.keys(data[0])[0];
  const valueKey = chart.config.value_key ?? Object.keys(data[0])[1];

  const values = data.map((row) => getNumericValue(row[valueKey]));
  const labels = data.map((row) => getStringValue(row[labelKey]));
  const total = values.reduce((sum, v) => sum + v, 0);

  const centerX = margin.left + chartWidth / 2;
  const centerY = margin.top + chartHeight / 2;
  const radius = Math.min(chartWidth, chartHeight) / 2 - 20;

  let startAngle = -Math.PI / 2;

  for (let i = 0; i < values.length; i++) {
    const sliceAngle = total > 0 ? (values[i] / total) * Math.PI * 2 : 0;
    const endAngle = startAngle + sliceAngle;

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();

    // Label line + text
    const midAngle = startAngle + sliceAngle / 2;
    const labelRadius = radius + 24;
    const lx = centerX + Math.cos(midAngle) * labelRadius;
    const ly = centerY + Math.sin(midAngle) * labelRadius;

    ctx.fillStyle = textColor;
    ctx.font = "12px sans-serif";
    ctx.textAlign = lx > centerX ? "left" : "right";
    ctx.fillText(`${labels[i]} ${total > 0 ? Math.round((values[i] / total) * 100) : 0}%`, lx, ly);

    startAngle = endAngle;
  }
}

function drawCartesian(
  ctx: NodeCanvasContext,
  data: Record<string, unknown>[],
  chart: ChartRenderDataOutput,
  margin: { top: number; right: number; bottom: number; left: number },
  chartWidth: number,
  chartHeight: number,
  textColor: string,
  gridColor: string,
  colors: string[]
) {
  const xKey = chart.config.x_axis ?? Object.keys(data[0])[0];
  const seriesKeys =
    chart.config.series_keys?.length
      ? chart.config.series_keys
      : [chart.config.y_axis ?? Object.keys(data[0])[1]].filter(Boolean) as string[];

  const labels = data.map((row) => getStringValue(row[xKey]));
  const seriesData = (seriesKeys as string[]).map((key) => data.map((row) => getNumericValue(row[key])));

  const allValues = seriesData.flat();
  const maxValue = Math.max(1, ...allValues);
  const yMax = Math.ceil(maxValue * 1.1);

  const originX = margin.left;
  const originY = margin.top + chartHeight;

  // Grid + Y axis
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.fillStyle = textColor;
  ctx.font = "12px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const y = originY - (chartHeight / yTicks) * i;
    const value = Math.round((yMax / yTicks) * i);

    ctx.beginPath();
    ctx.moveTo(originX, y);
    ctx.lineTo(originX + chartWidth, y);
    ctx.stroke();

    ctx.fillText(String(value), originX - 8, y);
  }

  // X axis labels
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const slotWidth = chartWidth / labels.length;

  for (let i = 0; i < labels.length; i++) {
    const x = originX + slotWidth * i + slotWidth / 2;
    const label = labels[i];
    const displayLabel = label.length > 8 ? `${label.slice(0, 6)}...` : label;

    ctx.save();
    ctx.translate(x, originY + 12);
    if (labels.length > 5) {
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = "right";
    }
    ctx.fillText(displayLabel, 0, 0);
    ctx.restore();
  }

  // Bars or lines
  if (chart.chart_type === "bar") {
    const barWidth = (slotWidth * 0.6) / seriesKeys.length;

    for (let s = 0; s < seriesKeys.length; s++) {
      ctx.fillStyle = colors[s % colors.length];
      for (let i = 0; i < labels.length; i++) {
        const value = seriesData[s][i];
        const barHeight = (value / yMax) * chartHeight;
        const x = originX + slotWidth * i + slotWidth * 0.2 + barWidth * s;
        const y = originY - barHeight;

        ctx.fillRect(x, y, barWidth - 2, barHeight);

        // Value label
        ctx.fillStyle = textColor;
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(String(value), x + barWidth / 2, y - 2);
        ctx.fillStyle = colors[s % colors.length];
      }
    }
  } else {
    // line chart
    for (let s = 0; s < seriesKeys.length; s++) {
      ctx.strokeStyle = colors[s % colors.length];
      ctx.lineWidth = 2;
      ctx.beginPath();

      for (let i = 0; i < labels.length; i++) {
        const value = seriesData[s][i];
        const x = originX + slotWidth * i + slotWidth / 2;
        const y = originY - (value / yMax) * chartHeight;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);

        // Point + value
        ctx.fillStyle = textColor;
        ctx.fillText(String(value), x, y - 8);
        ctx.fillStyle = colors[s % colors.length];
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.stroke();
    }
  }
}
