import type {
  Action,
  ActionResult,
  Entity,
} from "@datasourceintelligence/shared";
import type { Capability } from "../types.js";
import {
  SUSPECT_VESSELS,
  SUSPECT_TRAJECTORIES,
  RANKING_BREAKDOWN,
  POLLUTION_ORIGIN,
  getRanking,
  getVessel,
  type SuspectLevel,
} from "./_mock/oil-spill-suspects.js";

// 嫌疑船舶分级排序（subtask-7）—— scenario 终点
// - 5 艘 entity：按 RANKING_BREAKDOWN.level 映射 status
//     primary  → danger  (红 #FF4444，触发 ring 红色光圈)
//     secondary → warning (橙 #FFAA00)
//     normal   → normal  (灰 #EAEAEA)
// - cameraView: fit-bbox(首要嫌疑船 + 排污原点) —— "她从这里来"剧情视角
// - 不重推 trajectories（沿用 ais-fetch 灰色虚线）
// 详见 api/plan/oil-spill-mock-data.md §6

function levelToStatus(level: SuspectLevel): Entity["status"] {
  if (level === "primary") return "danger";
  if (level === "secondary") return "warning";
  return "normal";
}

function levelLabel(level: SuspectLevel): string {
  if (level === "primary") return "首要嫌疑";
  if (level === "secondary") return "次要嫌疑";
  return "一般嫌疑";
}

export const aisSuspectRankingCapability: Capability = {
  name: "ais-suspect-ranking",
  description:
    "嫌疑船舶分级排序：异常筛选 + 加权打分 + 三档分级（首要 / 次要 / 一般）",

  execute: async (
    _action: Action,
    _context?: Record<string, unknown>
  ): Promise<ActionResult> => {
    const start = Date.now();

    // 5 艘船按 ranking level 分色
    const entities: Entity[] = SUSPECT_VESSELS.map((v) => {
      const traj = SUSPECT_TRAJECTORIES[v.mmsi];
      const current = traj[traj.length - 1];
      const rank = getRanking(v.mmsi);
      const status = rank ? levelToStatus(rank.level) : "normal";
      const label = rank ? levelLabel(rank.level) : "未排序";
      const importance =
        rank?.level === "primary"
          ? "high"
          : rank?.level === "secondary"
            ? "medium"
            : "low";
      return {
        id: v.mmsi, // 同 mmsi 替换 ais-fetch / ais-match-suspects 的旧 entity
        name: `${label}·${v.name}`,
        type: "ship" as const,
        coordinates: current.coord,
        importance,
        status,
        heading: current.heading,
        speed: current.speedKn,
        description:
          `MMSI ${v.mmsi} | ${v.type} | ${v.flag} | ` +
          `第 ${rank?.rank ?? "—"} 名 | 得分 ${rank?.score ?? "—"} | ` +
          (rank?.reasons || ""),
      };
    });

    // 首要嫌疑船当前位置
    const primary = RANKING_BREAKDOWN.find((r) => r.level === "primary");
    const primaryVessel = primary ? getVessel(primary.mmsi) : undefined;
    const primaryTraj = primary ? SUSPECT_TRAJECTORIES[primary.mmsi] : undefined;
    const primaryCurrent = primaryTraj
      ? primaryTraj[primaryTraj.length - 1]
      : null;

    // cameraView: fit-bbox(首要嫌疑船 + 排污原点)
    const [originLng, originLat] = POLLUTION_ORIGIN;
    let bbox = {
      west: originLng,
      east: originLng,
      south: originLat,
      north: originLat,
    };
    if (primaryCurrent) {
      const [pLng, pLat] = primaryCurrent.coord;
      bbox = {
        west: Math.min(originLng, pLng),
        east: Math.max(originLng, pLng),
        south: Math.min(originLat, pLat),
        north: Math.max(originLat, pLat),
      };
    }

    // 按 level 分组打包
    const groupedByLevel = {
      primary: RANKING_BREAKDOWN.filter((r) => r.level === "primary"),
      secondary: RANKING_BREAKDOWN.filter((r) => r.level === "secondary"),
      normal: RANKING_BREAKDOWN.filter((r) => r.level === "normal"),
    };
    const enrich = (r: (typeof RANKING_BREAKDOWN)[number]) => {
      const v = getVessel(r.mmsi);
      return {
        mmsi: r.mmsi,
        name: v?.name,
        type: v?.type,
        flag: v?.flag,
        score: r.score,
        rank: r.rank,
        level: r.level,
        breakdown: r.breakdown,
        reasons: r.reasons,
      };
    };

    return {
      success: true,
      data: {
        message:
          `嫌疑船舶分级完成。` +
          `首要嫌疑 ${groupedByLevel.primary.length} 艘` +
          (primaryVessel
            ? `（${primaryVessel.name}，MMSI ${primaryVessel.mmsi}，得分 ${primary?.score}）`
            : "") +
          `，次要嫌疑 ${groupedByLevel.secondary.length} 艘，一般嫌疑 ${groupedByLevel.normal.length} 艘。`,
        totalSuspects: RANKING_BREAKDOWN.length,
        primary: groupedByLevel.primary.map(enrich),
        secondary: groupedByLevel.secondary.map(enrich),
        normal: groupedByLevel.normal.map(enrich),
        gisData: {
          type: "entity" as const,
          entities,
        },
      },
      metadata: {
        capability: "ais-suspect-ranking",
        executionTime: Date.now() - start,
        mock: true,
        bbox,
        primaryMmsi: primary?.mmsi,
      },
    };
  },
};
