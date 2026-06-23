import { z } from "zod";
import type { Entity, Trajectory } from "@datasourceintelligence/shared";
import type { ToolDefinition } from "../../_shared/types.js";
import {
  SUSPECT_TRAJECTORIES,
  SUSPECT_VESSELS,
  TOTAL_RECORD_COUNT,
  TOTAL_VESSEL_COUNT,
} from "./mockData.js";

const InputSchema = z.strictObject({
  region: z.string().trim().min(1).default("中国东海"),
});

export function buildAisFetchMockTool(): ToolDefinition {
  return {
    name: "AisFetchMock",
    aliases: ["ais-fetch"],
    description: "Deterministic mock AIS trajectory fetch for the East China Sea oil-spill demo.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute(input) {
      const parsed = input as z.infer<typeof InputSchema>;
      const now = Date.parse("2026-06-23T00:00:00+08:00");
      const entities: Entity[] = SUSPECT_VESSELS.map((vessel) => {
        const points = SUSPECT_TRAJECTORIES[vessel.mmsi]!;
        const latest = points[points.length - 1]!;
        return {
          id: vessel.mmsi,
          name: vessel.name,
          type: "ship",
          coordinates: latest.coord,
          importance: "low",
          status: "normal",
          heading: latest.heading,
          speed: latest.speedKn,
          description: `MMSI ${vessel.mmsi} | ${vessel.type} | ${vessel.flag} | 长 ${vessel.length}m | ${parsed.region}`,
        };
      });
      const trajectories: Trajectory[] = SUSPECT_VESSELS.map((vessel) => {
        const points = SUSPECT_TRAJECTORIES[vessel.mmsi]!;
        return {
          id: `ais-traj-${vessel.mmsi}`,
          name: `${vessel.name} AIS 历史轨迹`,
          type: "route",
          coordinates: points.map((point) => point.coord),
          timestamps: points.map((point) => now - point.hoursAgo * 3600 * 1000),
          status: "history",
        };
      });

      return {
        summary: `成功获取 AIS 数据 ${TOTAL_RECORD_COUNT} 条，涉及船舶 ${TOTAL_VESSEL_COUNT} 艘（演示展示 ${SUSPECT_VESSELS.length} 艘途经匹配区域候选船）。`,
        recordCount: TOTAL_RECORD_COUNT,
        vesselCount: TOTAL_VESSEL_COUNT,
        displayedCount: SUSPECT_VESSELS.length,
        region: parsed.region,
        period: "近72小时",
        vessels: SUSPECT_VESSELS,
        gisData: { type: "entity" as const, entities, trajectories },
        metadata: { capability: "ais-fetch", mock: true },
      };
    },
  };
}
