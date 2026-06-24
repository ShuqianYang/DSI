import { z } from "zod";
import type { Entity } from "@datasourceintelligence/shared";
import type { ToolDefinition } from "../../_shared/types.js";
import {
  MATCH_INFOS,
  POLLUTION_ORIGIN,
  SUSPECT_TRAJECTORIES,
  SUSPECT_VESSELS,
  TOTAL_VESSEL_COUNT,
  getMatch,
} from "./mockData.js";
import { bboxFromCoordinates } from "./gisHelpers.js";

const InputSchema = z.strictObject({});

export function buildAisMatchSuspectsMockTool(): ToolDefinition {
  return {
    name: "AisMatchSuspectsMock",
    displayName: "嫌疑船舶匹配",
    aliases: ["ais-match-suspects"],
    description: "Deterministic mock AIS suspect matching around the oil-spill pollution origin.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute() {
      const entities: Entity[] = SUSPECT_VESSELS.map((vessel) => {
        const current = SUSPECT_TRAJECTORIES[vessel.mmsi]!.at(-1)!;
        const match = getMatch(vessel.mmsi);
        const gap = match?.aisGapMin ? ` | AIS 信号断 ${match.aisGapMin} 分钟` : "";
        return {
          id: vessel.mmsi,
          name: vessel.name,
          type: "ship",
          coordinates: current.coord,
          importance: "medium",
          status: "warning",
          heading: current.heading,
          speed: current.speedKn,
          description: `MMSI ${vessel.mmsi} | ${vessel.type} | ${vessel.flag} | 停留 ${match?.stayDurationMin ?? "-"} 分钟 | 距原点 ${match?.closestDistanceM ?? "-"} m${gap}`,
        };
      });

      return {
        summary: `从 ${TOTAL_VESSEL_COUNT} 艘船中匹配出 ${SUSPECT_VESSELS.length} 艘途经候选船（排污原点 ±1 km × 排污时间窗 10:00-12:00）。`,
        matchCriteria: {
          center: POLLUTION_ORIGIN,
          rangeKm: 1,
          timeRange: "近72小时内10:00-12:00（UTC+8）",
        },
        matchedCount: SUSPECT_VESSELS.length,
        totalScanned: TOTAL_VESSEL_COUNT,
        vessels: SUSPECT_VESSELS.map((vessel) => ({ ...vessel, match: getMatch(vessel.mmsi) })),
        gisData: {
          type: "entity" as const,
          entities,
          cameraView: { type: "point" as const, lng: 124.451871, lat: 30.721557, altitude: 1159060 },
        },
        metadata: {
          capability: "ais-match-suspects",
          mock: true,
          bbox: bboxFromCoordinates(entities.map((entity) => entity.coordinates)),
          matchInfosCount: MATCH_INFOS.length,
        },
      };
    },
  };
}
