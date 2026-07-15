import { z } from "zod";
import type { ToolDefinition, ToolObservation } from "../../_shared/types.js";
import { OIL_FILM_CENTER, POLLUTION_ORIGIN } from "./mockData.js";
import { buildCircle, compassWindToFlowDeg, toDMS } from "./gisHelpers.js";

const InputSchema = z.strictObject({});

function readOutputRecord(observation: ToolObservation): Record<string, unknown> {
  return observation.output && typeof observation.output === "object" && !Array.isArray(observation.output)
    ? (observation.output as Record<string, unknown>)
    : {};
}

function pickOilCenter(observations: ToolObservation[]): { lng: number; lat: number } {
  for (const observation of observations) {
    const output = readOutputRecord(observation);
    const oilSpill = output.oilSpill as { centerLng?: number; centerLat?: number } | undefined;
    if (typeof oilSpill?.centerLng === "number" && typeof oilSpill.centerLat === "number") {
      return { lng: oilSpill.centerLng, lat: oilSpill.centerLat };
    }
  }
  return OIL_FILM_CENTER;
}

function pickWeather(observations: ToolObservation[]): {
  windSpeed: number;
  windDirection: string;
  currentSpeed: number;
  currentDirection: string;
} {
  for (const observation of observations) {
    const output = readOutputRecord(observation);
    if (typeof output.windSpeed === "number" && typeof output.currentSpeed === "number") {
      return {
        windSpeed: output.windSpeed,
        windDirection: typeof output.windDirection === "string" ? output.windDirection : "东北",
        currentSpeed: output.currentSpeed,
        currentDirection: typeof output.currentDirection === "string" ? output.currentDirection : "东南",
      };
    }
  }
  return { windSpeed: 3.2, windDirection: "东北", currentSpeed: 0.8, currentDirection: "东南" };
}

export function buildOilDriftTraceMockTool(): ToolDefinition {
  return {
    name: "OilDriftTraceMock",
    displayName: "油污漂移溯源",
    aliases: ["oil-drift"],
    description: "Deterministic mock oil-drift backtrace for the East China Sea oil-spill demo.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute(_input, context) {
      const oilCenter = pickOilCenter(context.observations);
      const weather = pickWeather(context.observations);
      const [originLng, originLat] = POLLUTION_ORIGIN;
      const offsetLng = Number((originLng - oilCenter.lng).toFixed(4));
      const offsetLat = Number((originLat - oilCenter.lat).toFixed(4));
      const driftPath = Array.from({ length: 5 }, (_value, index) => {
        const t = index / 4;
        return [
          Number((originLng - offsetLng * t).toFixed(4)),
          Number((originLat - offsetLat * t).toFixed(4)),
        ] as [number, number];
      });
      const originLngDMS = toDMS(originLng, true);
      const originLatDMS = toDMS(originLat, false);

      return {
        summary: `油污漂移反推完成。排污原点 ${originLngDMS}, ${originLatDMS}。`,
        driftPathLengthKm: 3.3,
        driftPath,
        pollutionOrigin: {
          lng: originLng,
          lat: originLat,
          lngDMS: originLngDMS,
          latDMS: originLatDMS,
          timeRange: "近72小时内10:00-12:00（UTC+8）",
          confidence: "误差≤2小时",
        },
        weatherInput: weather,
        gisData: {
          type: "trajectory" as const,
          trajectories: [
            {
              id: "drift-path",
              name: "油污漂移溯源路径",
              type: "route" as const,
              coordinates: driftPath,
              status: "history" as const,
            },
          ],
          regions: [
            {
              id: "pollution-origin-area",
              name: "排污原点",
              type: "monitor" as const,
              coordinates: buildCircle(originLng, originLat, 0.002, 16),
              style: {
                fill: true,
                fillColor: "rgba(220, 38, 38, 0.4)",
                outlineColor: "#dc2626",
                outlineWidth: 3,
                diffusion: {
                  windFlowDeg: compassWindToFlowDeg(weather.windDirection),
                  windSpeed: weather.windSpeed,
                },
              },
              label: {
                text: `排污原点\n${originLngDMS}\n${originLatDMS}`,
                position: [originLng, originLat + 0.003] as [number, number],
              },
            },
          ],
          cameraView: { type: "point" as const, lng: 123.035275, lat: 30.271615, altitude: 7968 },
        },
        metadata: {
          capability: "oil-drift",
          mock: true,
          oilCenter,
        },
      };
    },
  };
}
