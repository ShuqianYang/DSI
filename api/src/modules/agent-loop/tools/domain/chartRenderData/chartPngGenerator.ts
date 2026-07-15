import type { ChartRenderDataOutput } from "../dailyReport/dailyReportTypes.js";

type NodeCanvasContext = import("canvas").CanvasRenderingContext2D;

export interface ChartPngGeneratorOptions {
  width?: number;
  height?: number;
  backgroundColor?: string;
  textColor?: string;
  gridColor?: string;
  colors?: string[];
}

const DEFAULT_COLORS = [
  "#0891B2",
  "#F59E0B",
  "#16A34A",
  "#DC2626",
  "#CA8A04",
  "#7C3AED",
  "#0284C7",
];

export async function generateChartPng(
  chart: ChartRenderDataOutput,
  options: ChartPngGeneratorOptions = {}
): Promise<Buffer> {
  let createCanvas: typeof import("canvas").createCanvas;
  try {
    ({ createCanvas } = await import("canvas"));
  } catch (error) {
    console.warn(
      "[ChartPngGenerator] canvas is unavailable, rendering with sharp:",
      error instanceof Error ? error.message : String(error)
    );
    return generateChartPngWithSharp(chart, options);
  }
  const {
    width = 800,
    height = 480,
    backgroundColor = "#FFFFFF",
    textColor = "#1F2937",
    gridColor = "#D1D5DB",
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

async function generateChartPngWithSharp(
  chart: ChartRenderDataOutput,
  options: ChartPngGeneratorOptions
): Promise<Buffer> {
  const {
    width = 800,
    height = 480,
    backgroundColor = "#FFFFFF",
    textColor = "#1F2937",
    gridColor = "#D1D5DB",
    colors = DEFAULT_COLORS,
  } = options;

  const svg = buildChartSvg(chart, {
    width,
    height,
    backgroundColor,
    textColor,
    gridColor,
    colors,
  });
  try {
    const { default: sharp } = await import("sharp");
    return sharp(Buffer.from(svg)).png().toBuffer();
  } catch (error) {
    throw new Error(
      `Unable to render chart PNG because neither canvas nor sharp is available: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildChartSvg(
  chart: ChartRenderDataOutput,
  options: Required<ChartPngGeneratorOptions>
): string {
  const { width, height, backgroundColor, textColor, gridColor, colors } = options;
  const data = Array.isArray(chart.data) ? chart.data : [];
  const elements: string[] = [
    `<rect width="${width}" height="${height}" fill="${backgroundColor}"/>`,
    `<text x="${width / 2}" y="34" fill="${textColor}" font-family="Microsoft YaHei, Arial, sans-serif" font-size="18" font-weight="700" text-anchor="middle">${escapeXml(chart.title)}</text>`,
  ];

  if (data.length === 0) {
    elements.push(`<text x="${width / 2}" y="${height / 2}" fill="${textColor}" font-family="Microsoft YaHei, Arial, sans-serif" font-size="14" text-anchor="middle">暂无数据</text>`);
  } else if (chart.chart_type === "pie") {
    elements.push(...buildPieSvgElements(chart, data, options));
  } else {
    elements.push(...buildCartesianSvgElements(chart, data, options));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${elements.join("")}</svg>`;
}

function buildPieSvgElements(
  chart: ChartRenderDataOutput,
  data: Record<string, unknown>[],
  options: Required<ChartPngGeneratorOptions>
): string[] {
  const { width, height, textColor, colors } = options;
  const labelKey = chart.config.label_key ?? Object.keys(data[0])[0];
  const valueKey = chart.config.value_key ?? Object.keys(data[0])[1];
  const values = data.map((row) => Math.max(0, getNumericValue(row[valueKey])));
  const total = values.reduce((sum, value) => sum + value, 0);
  const centerX = width / 2;
  const centerY = height / 2 + 16;
  const radius = Math.min(width * 0.28, height * 0.32);
  const elements: string[] = [];
  let startAngle = -Math.PI / 2;

  values.forEach((value, index) => {
    if (total <= 0 || value <= 0) return;
    const endAngle = startAngle + (value / total) * Math.PI * 2;
    const x1 = centerX + Math.cos(startAngle) * radius;
    const y1 = centerY + Math.sin(startAngle) * radius;
    const x2 = centerX + Math.cos(endAngle) * radius;
    const y2 = centerY + Math.sin(endAngle) * radius;
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    const path = `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    elements.push(`<path d="${path}" fill="${colors[index % colors.length]}" stroke="${options.backgroundColor}" stroke-width="2"/>`);

    const midAngle = (startAngle + endAngle) / 2;
    const labelRadius = radius + 30;
    const labelX = centerX + Math.cos(midAngle) * labelRadius;
    const labelY = centerY + Math.sin(midAngle) * labelRadius;
    const anchor = labelX >= centerX ? "start" : "end";
    const label = `${getStringValue(data[index][labelKey])} ${Math.round((value / total) * 100)}%`;
    elements.push(`<text x="${labelX}" y="${labelY}" fill="${textColor}" font-family="Microsoft YaHei, Arial, sans-serif" font-size="12" text-anchor="${anchor}" dominant-baseline="middle">${escapeXml(label)}</text>`);
    startAngle = endAngle;
  });

  return elements;
}

function buildCartesianSvgElements(
  chart: ChartRenderDataOutput,
  data: Record<string, unknown>[],
  options: Required<ChartPngGeneratorOptions>
): string[] {
  const { width, height, textColor, gridColor, colors } = options;
  const margin = { top: 64, right: 40, bottom: 82, left: 64 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const originY = margin.top + chartHeight;
  const xKey = chart.config.x_axis ?? Object.keys(data[0])[0];
  const seriesKeys = chart.config.series_keys?.length
    ? chart.config.series_keys
    : [chart.config.y_axis ?? Object.keys(data[0])[1]].filter(Boolean) as string[];
  const labels = data.map((row) => getStringValue(row[xKey]));
  const seriesData = seriesKeys.map((key) => data.map((row) => getNumericValue(row[key])));
  const maxValue = Math.max(1, ...seriesData.flat());
  const yMax = Math.ceil(maxValue * 1.1);
  const slotWidth = chartWidth / Math.max(labels.length, 1);
  const elements: string[] = [];

  for (let tick = 0; tick <= 5; tick += 1) {
    const y = originY - (chartHeight / 5) * tick;
    const value = Math.round((yMax / 5) * tick);
    elements.push(`<line x1="${margin.left}" y1="${y}" x2="${margin.left + chartWidth}" y2="${y}" stroke="${gridColor}" stroke-width="1"/>`);
    elements.push(`<text x="${margin.left - 8}" y="${y}" fill="${textColor}" font-family="Arial, sans-serif" font-size="12" text-anchor="end" dominant-baseline="middle">${value}</text>`);
  }

  labels.forEach((label, index) => {
    const x = margin.left + slotWidth * index + slotWidth / 2;
    const displayLabel = label.length > 10 ? `${label.slice(0, 8)}…` : label;
    elements.push(`<text x="${x}" y="${originY + 22}" fill="${textColor}" font-family="Microsoft YaHei, Arial, sans-serif" font-size="11" text-anchor="middle">${escapeXml(displayLabel)}</text>`);
  });

  if (chart.chart_type === "bar") {
    const barWidth = (slotWidth * 0.62) / Math.max(seriesKeys.length, 1);
    seriesData.forEach((values, seriesIndex) => {
      values.forEach((value, index) => {
        const barHeight = (Math.max(0, value) / yMax) * chartHeight;
        const x = margin.left + slotWidth * index + slotWidth * 0.19 + barWidth * seriesIndex;
        const y = originY - barHeight;
        elements.push(`<rect x="${x}" y="${y}" width="${Math.max(1, barWidth - 3)}" height="${barHeight}" fill="${colors[seriesIndex % colors.length]}"/>`);
        elements.push(`<text x="${x + barWidth / 2}" y="${y - 5}" fill="${textColor}" font-family="Arial, sans-serif" font-size="11" text-anchor="middle">${value}</text>`);
      });
    });
  } else {
    seriesData.forEach((values, seriesIndex) => {
      const points = values.map((value, index) => {
        const x = margin.left + slotWidth * index + slotWidth / 2;
        const y = originY - (value / yMax) * chartHeight;
        return { x, y, value };
      });
      elements.push(`<polyline points="${points.map(({ x, y }) => `${x},${y}`).join(" ")}" fill="none" stroke="${colors[seriesIndex % colors.length]}" stroke-width="3"/>`);
      points.forEach(({ x, y, value }) => {
        elements.push(`<circle cx="${x}" cy="${y}" r="4" fill="${colors[seriesIndex % colors.length]}"/>`);
        elements.push(`<text x="${x}" y="${y - 9}" fill="${textColor}" font-family="Arial, sans-serif" font-size="11" text-anchor="middle">${value}</text>`);
      });
    });
  }

  return elements;
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
