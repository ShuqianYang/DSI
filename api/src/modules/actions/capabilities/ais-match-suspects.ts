import type {
  Action,
  ActionResult,
  Entity,
} from "@datasourceintelligence/shared";
import type { Capability } from "../types.js";
import {
  SUSPECT_VESSELS,
  SUSPECT_TRAJECTORIES,
  MATCH_INFOS,
  POLLUTION_ORIGIN,
  getMatch,
  TOTAL_VESSEL_COUNT,
} from "./_mock/oil-spill-suspects.js";

// 匹配嫌疑船舶（subtask-6）
// - 输入：context 里的 ais-fetch vessels 和 oil-drift pollutionOrigin（mock 场景下都从 _mock 直接读）
// - 输出：5 艘 entity（status=warning 橙色高亮，同 mmsi 替换 ais-fetch 推出的 normal entity）
// - 不重推 trajectories（ais-fetch 那批灰色 history 轨迹保留显示）
// - cameraView: fit-bbox(5 艘船当前位置 bbox) —— 触发前端拉远到全场视角
// 详见 api/plan/oil-spill-mock-data.md §5

export const aisMatchSuspectsCapability: Capability = {
  name: "ais-match-suspects",
  description:
    "AIS 匹配嫌疑：以排污原点 ±1 km × 排污时间窗双重筛选，从 AIS 数据中找出途经候选船",

  execute: async (
    _action: Action,
    _context?: Record<string, unknown>
  ): Promise<ActionResult> => {
    const start = Date.now();

    // 5 艘候选船 entity：status="warning" 橙色高亮
    // 位置用轨迹末点（当前位置），便于 fit-bbox 计算反映当前散布
    const entities: Entity[] = SUSPECT_VESSELS.map((v) => {
      const traj = SUSPECT_TRAJECTORIES[v.mmsi];
      const current = traj[traj.length - 1];
      const match = getMatch(v.mmsi);
      const gapStr = match?.aisGapMin
        ? ` | AIS 信号断 ${match.aisGapMin} 分钟`
        : "";
      return {
        id: v.mmsi, // 同 mmsi → 前端按 id 替换 ais-fetch 推的 normal 版本
        name: v.name,
        type: "ship" as const,
        coordinates: current.coord,
        importance: "medium" as const,
        status: "warning" as const,
        heading: current.heading,
        speed: current.speedKn,
        description:
          `MMSI ${v.mmsi} | ${v.type} | ${v.flag} | ` +
          `停留 ${match?.stayDurationMin ?? "—"} 分钟 | ` +
          `距原点 ${match?.closestDistanceM ?? "—"} m${gapStr}`,
      };
    });

    // 5 艘船当前位置算 bbox
    const lngs = entities.map((e) => e.coordinates[0]);
    const lats = entities.map((e) => e.coordinates[1]);
    const bbox = {
      west: Math.min(...lngs),
      south: Math.min(...lats),
      east: Math.max(...lngs),
      north: Math.max(...lats),
    };

    return {
      success: true,
      data: {
        message:
          `从 ${TOTAL_VESSEL_COUNT} 艘船中匹配出 ${SUSPECT_VESSELS.length} 艘途经候选船 ` +
          `（排污原点 ±1 km × 排污时间窗 10:00-12:00）。`,
        matchCriteria: {
          center: POLLUTION_ORIGIN,
          rangeKm: 1,
          timeRange: "近72小时内10:00-12:00（UTC+8）",
        },
        matchedCount: SUSPECT_VESSELS.length,
        totalScanned: TOTAL_VESSEL_COUNT,
        vessels: SUSPECT_VESSELS.map((v) => {
          const match = getMatch(v.mmsi);
          const traj = SUSPECT_TRAJECTORIES[v.mmsi];
          const current = traj[traj.length - 1];
          return {
            ...v,
            speed: current.speedKn,
            heading: current.heading,
            stayDurationMin: match?.stayDurationMin,
            closestDistanceM: match?.closestDistanceM,
            aisGapMin: match?.aisGapMin,
            matchedAt: match?.matchedAt,
          };
        }),
        gisData: {
          type: "entity" as const,
          entities,
          cameraView: {
            type: "point" as const,
            lng: 124.451871,
            lat: 30.721557,
            altitude: 1159060,
          },
        },
      },
      metadata: {
        capability: "ais-match-suspects",
        executionTime: Date.now() - start,
        mock: true,
        bbox,
        matchInfosCount: MATCH_INFOS.length,
      },
    };
  },
};
