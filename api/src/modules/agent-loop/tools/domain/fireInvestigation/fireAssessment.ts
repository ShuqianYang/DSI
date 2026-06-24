import { z } from "zod";
import type { ToolDefinition } from "../../_shared/types.js";
import { FIRE_ASSESSMENT, FIRE_CENTER_LAT, FIRE_CENTER_LNG } from "./mockData.js";

const InputSchema = z.strictObject({
  region: z.string().trim().min(1).default("Kensai"),
});

type FireAssessmentInput = z.infer<typeof InputSchema>;

export function buildFireAssessmentMockTool(): ToolDefinition {
  return {
    name: "FireAssessmentMock",
    displayName: "火情评估",
    aliases: ["fire-assessment"],
    description:
      "Deterministic mock fire impact assessment for the Kensai demo. Returns fire intensity, spread direction/speed, wind field, and affected objects.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute(input) {
      const parsed = input as FireAssessmentInput;
      const assessment = FIRE_ASSESSMENT;

      return {
        summary:
          `${parsed.region} 火势评估：当前为${assessment.fireIntensity === "high" ? "高" : assessment.fireIntensity}强度火情，` +
          `向${assessment.spreadDirection}蔓延，速度约 ${assessment.spreadSpeedKmH} km/h。` +
          `受 ${assessment.windDirection} ${assessment.windSpeedMs} m/s 影响，风险等级 ${assessment.riskLevel === "high" ? "高" : assessment.riskLevel}。`,
        region: parsed.region,
        assessment,
        gisData: {
          type: "wind-field" as const,
          windField: {
            bbox: {
              west: FIRE_CENTER_LNG - 0.05,
              east: FIRE_CENTER_LNG + 0.05,
              south: FIRE_CENTER_LAT - 0.05,
              north: FIRE_CENTER_LAT + 0.05,
            },
            grid: { rows: 5, cols: 5 },
            u: Array(25).fill(-assessment.windSpeedMs * Math.sin(Math.PI / 4)),
            v: Array(25).fill(assessment.windSpeedMs * Math.cos(Math.PI / 4)),
            speed: Array(25).fill(assessment.windSpeedMs),
            timestamp: new Date().toISOString(),
            source: "fire-mock",
          },
        },
        metadata: { capability: "fire-assessment", mock: true },
      };
    },
  };
}
