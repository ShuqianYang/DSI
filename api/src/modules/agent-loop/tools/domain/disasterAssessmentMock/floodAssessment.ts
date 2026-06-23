import { z } from "zod";
import type { ToolDefinition } from "../../_shared/types.js";
import { FLOOD_DEFAULT_REGION } from "./floodMockData.js";
import {
  buildFloodAssessmentGisData,
  loadFloodDamageZones,
} from "./floodShared.js";

const InputSchema = z.strictObject({
  region: z.string().trim().min(1).default(FLOOD_DEFAULT_REGION),
});

type FloodAssessmentInput = z.infer<typeof InputSchema>;

export function buildFloodAssessmentMockTool(): ToolDefinition {
  return {
    name: "FloodAssessmentMock",
    aliases: ["flood-assessment"],
    description:
      "Deterministic mock flood damage assessment for the Hunan Shimen demo. Loads flood.geojson damage zones and returns flood comparison GIS data.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute(input) {
      const parsed = InputSchema.parse(input) as FloodAssessmentInput;
      const damageZones = await loadFloodDamageZones();
      const floodedAreaKm2 = round3(
        damageZones.filter((zone) => zone.level !== "none").reduce((sum, zone) => sum + zone.areaKm2, 0),
      );
      const summary = {
        location: parsed.region,
        eventTime: "2026-05-17~05-18",
        assessmentTime: new Date().toISOString(),
        dataSource: "国家气象信息中心、湖南省气象局、水利部水文信息官网",
        floodedAreaKm2,
        bridgesDamaged: damageZones.filter((zone) => zone.name.includes("桥梁") || zone.name.includes("桥面")).length,
        roadsInterrupted: damageZones.filter(
          (zone) => zone.level !== "none" && (zone.name.includes("道路") || zone.name.includes("桥头")),
        ).length,
        housesFlooded: damageZones.filter((zone) => zone.name.includes("建筑")).length,
      };

      return {
        summary,
        message:
          `${parsed.region} 暴雨洪涝灾后评估：淹没/受损面积约 ${summary.floodedAreaKm2} km²，` +
          `桥梁损毁 ${summary.bridgesDamaged} 处，道路中断 ${summary.roadsInterrupted} 处，` +
          `房屋受淹风险 ${summary.housesFlooded} 处。`,
        region: parsed.region,
        damageZones,
        gisData: buildFloodAssessmentGisData(parsed.region, damageZones),
        metadata: {
          capability: "flood-assessment",
          responseType: "flood_assessment",
          mock: true,
          source: "flood.geojson",
        },
      };
    },
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
