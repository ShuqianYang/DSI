import { z } from "zod";
import type { ToolDefinition } from "../../_shared/types.js";
import { OIL_FILM_CENTER } from "./mockData.js";
import { buildMockWindField } from "./gisHelpers.js";

const InputSchema = z.strictObject({
  region: z.string().trim().min(1).default("东海油膜片区"),
});

export function buildWeatherFetchMockTool(): ToolDefinition {
  return {
    name: "WeatherFetchMock",
    aliases: ["oil-spill-weather-fetch"],
    description:
      "Deterministic mock weather and ocean-current data for the East China Sea oil-spill demo. Use this only inside oil-spill tracing.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute(input) {
      const parsed = input as z.infer<typeof InputSchema>;
      const windField = buildMockWindField(OIL_FILM_CENTER);
      return {
        summary: "风 3.2 m/s · 东北风 | 洋流 0.8 m/s · 东南向 | 数据源: oil-spill-mock",
        windSpeed: 3.2,
        windDirection: "东北",
        currentSpeed: 0.8,
        currentDirection: "东南",
        period: "近72小时",
        region: parsed.region,
        dataSource: "oil-spill-mock",
        gisData: {
          type: "wind-field" as const,
          windField,
        },
        metadata: {
          capability: "weather-fetch",
          mock: true,
          dataSource: "oil-spill-mock",
        },
      };
    },
  };
}
