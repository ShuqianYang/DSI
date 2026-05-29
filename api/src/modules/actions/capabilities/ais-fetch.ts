import type {
  Action,
  ActionResult,
  Entity,
  Trajectory,
} from "@datasourceintelligence/shared";
import type { Capability } from "../types.js";
import {
  SUSPECT_VESSELS,
  SUSPECT_TRAJECTORIES,
  TOTAL_VESSEL_COUNT,
  TOTAL_RECORD_COUNT,
} from "./_mock/oil-spill-suspects.js";

// 拉取近 72h 东海全域船舶 AIS 轨迹（Mock 演示版）
// - 故事化：返回 vesselCount=157、recordCount=2863 与 oil-detector.md 剧情一致
// - 实际：vessels[]/gisData 只填 5 艘候选船（共享 _mock/oil-spill-suspects.ts）
// - GIS 效果：5 艘 entity（status=normal 蓝色淡点）+ 5 条 trajectory（status=history 灰色虚线）
//   下游 ais-match-suspects / ais-suspect-ranking 同 mmsi 重推 entity 改变 status，
//   触发 蓝（全场）→ 橙（匹配）→ 红/橙/绿（排名）三阶段视觉演进

export const aisFetchCapability: Capability = {
  name: "ais-fetch",
  description:
    "AIS 数据：拉取近 72 小时东海全域船舶 AIS 轨迹（Mock 演示版，5 艘候选船完整数据）",

  execute: async (
    action: Action,
    _context?: Record<string, unknown>
  ): Promise<ActionResult> => {
    const start = Date.now();
    const params = action.params as { region?: string };
    const region = params.region || "中国东海";
    const now = Date.now();

    // 5 艘船的 vessel/trajectory 转 GIS Entity / Trajectory
    const entities: Entity[] = SUSPECT_VESSELS.map((v) => {
      const points = SUSPECT_TRAJECTORIES[v.mmsi];
      const latest = points[points.length - 1];
      return {
        id: v.mmsi,
        name: v.name,
        type: "ship" as const,
        coordinates: latest.coord,
        importance: "low" as const,
        status: "normal" as const,
        heading: latest.heading,
        speed: latest.speedKn,
        description: `MMSI ${v.mmsi} | ${v.type} | ${v.flag} | 长 ${v.length}m | ${region}`,
      };
    });

    const trajectories: Trajectory[] = SUSPECT_VESSELS.map((v) => {
      const points = SUSPECT_TRAJECTORIES[v.mmsi];
      return {
        id: `ais-traj-${v.mmsi}`,
        name: `${v.name} AIS 历史轨迹`,
        type: "route" as const,
        coordinates: points.map((p) => p.coord),
        timestamps: points.map((p) => now - p.hoursAgo * 3600 * 1000),
        status: "history" as const,
      };
    });

    // 富数据格式（供下游 ais-match-suspects / ais-suspect-ranking 通过 context 读取）
    const vessels = SUSPECT_VESSELS.map((v) => {
      const points = SUSPECT_TRAJECTORIES[v.mmsi];
      const latest = points[points.length - 1];
      return {
        ...v,
        speed: latest.speedKn,
        heading: latest.heading,
        points: points.map((p) => ({
          ...p,
          timestamp: now - p.hoursAgo * 3600 * 1000,
        })),
      };
    });

    return {
      success: true,
      data: {
        message:
          `成功获取 AIS 数据 ${TOTAL_RECORD_COUNT} 条，涉及船舶 ${TOTAL_VESSEL_COUNT} 艘 ` +
          `（演示展示 ${SUSPECT_VESSELS.length} 艘途经匹配区域候选船）。`,
        recordCount: TOTAL_RECORD_COUNT,
        vesselCount: TOTAL_VESSEL_COUNT,
        displayedCount: SUSPECT_VESSELS.length,
        region,
        period: "近72小时",
        vessels,
        gisData: {
          type: "entity" as const,
          entities,
          trajectories,
        },
      },
      metadata: {
        capability: "ais-fetch",
        executionTime: Date.now() - start,
        mock: true,
      },
    };
  },
};
