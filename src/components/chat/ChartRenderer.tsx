"use client";

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";

export interface ChartRenderData {
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

const DEFAULT_COLORS = ["#00E0FF", "#FFAA00", "#44FF44", "#FF4444", "#FFFF44", "#8884d8", "#82ca9d"];

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

export function ChartRenderer({ chartData }: { chartData: ChartRenderData }) {
  const { chart_type, title, data, config } = chartData;

  if (!data || data.length === 0) {
    return null;
  }

  const normalizedData = data.map((item) => {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      normalized[key] = value;
    }
    return normalized;
  });

  if (chart_type === "bar") {
    const xKey = config.x_axis || Object.keys(normalizedData[0])[0];
    const yKey = config.y_axis || Object.keys(normalizedData[0])[1];

    return (
      <div className="my-3">
        <div className="text-sm font-medium text-[#EAEAEA] mb-2">{title}</div>
        <ChartContainer config={{}} className="aspect-video w-full">
          <BarChart data={normalizedData} margin={{ top: 8, right: 16, bottom: 32, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#3A3A4E" vertical={false} />
            <XAxis
              dataKey={xKey}
              tick={{ fill: "#8888AA", fontSize: 12 }}
              angle={normalizedData.length > 5 ? -45 : 0}
              textAnchor={normalizedData.length > 5 ? "end" : "middle"}
              height={normalizedData.length > 5 ? 60 : 30}
            />
            <YAxis tick={{ fill: "#8888AA", fontSize: 12 }} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey={yKey} fill="#00E0FF" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </div>
    );
  }

  if (chart_type === "line") {
    const xKey = config.x_axis || Object.keys(normalizedData[0])[0];
    const seriesKeys =
      config.series_keys?.length
        ? config.series_keys
        : [config.y_axis || Object.keys(normalizedData[0])[1]].filter(Boolean) as string[];

    return (
      <div className="my-3">
        <div className="text-sm font-medium text-[#EAEAEA] mb-2">{title}</div>
        <ChartContainer config={{}} className="aspect-video w-full">
          <LineChart data={normalizedData} margin={{ top: 8, right: 16, bottom: 32, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#3A3A4E" />
            <XAxis
              dataKey={xKey}
              tick={{ fill: "#8888AA", fontSize: 12 }}
              angle={normalizedData.length > 8 ? -45 : 0}
              textAnchor={normalizedData.length > 8 ? "end" : "middle"}
              height={normalizedData.length > 8 ? 60 : 30}
            />
            <YAxis tick={{ fill: "#8888AA", fontSize: 12 }} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            {seriesKeys.map((key, index) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={DEFAULT_COLORS[index % DEFAULT_COLORS.length]}
                strokeWidth={2}
                dot={{ fill: DEFAULT_COLORS[index % DEFAULT_COLORS.length], r: 3 }}
              />
            ))}
          </LineChart>
        </ChartContainer>
      </div>
    );
  }

  if (chart_type === "pie") {
    const labelKey = config.label_key || Object.keys(normalizedData[0])[0];
    const valueKey = config.value_key || Object.keys(normalizedData[0])[1];

    const pieData = normalizedData.map((item) => ({
      name: getStringValue(item[labelKey]),
      value: getNumericValue(item[valueKey]),
      raw: item,
    }));

    return (
      <div className="my-3">
        <div className="text-sm font-medium text-[#EAEAEA] mb-2">{title}</div>
        <ChartContainer config={{}} className="aspect-video w-full">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius="70%"
              label={({ name, percent }) =>
                `${name}: ${(percent * 100).toFixed(1)}%`
              }
            >
              {pieData.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={DEFAULT_COLORS[index % DEFAULT_COLORS.length]}
                />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
      </div>
    );
  }

  return null;
}
