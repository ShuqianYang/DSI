import { z } from "zod";
import type { Entity } from "@datasourceintelligence/shared";
import type { ToolDefinition } from "../../_shared/types.js";
import {
  POLLUTION_ORIGIN,
  RANKING_BREAKDOWN,
  SUSPECT_TRAJECTORIES,
  SUSPECT_VESSELS,
  getRanking,
  getVessel,
  type SuspectLevel,
} from "./mockData.js";

const InputSchema = z.strictObject({});

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

export function buildAisSuspectRankingMockTool(): ToolDefinition {
  return {
    name: "AisSuspectRankingMock",
    aliases: ["ais-suspect-ranking"],
    description: "Deterministic mock suspect-vessel ranking for the East China Sea oil-spill demo.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute() {
      const entities: Entity[] = SUSPECT_VESSELS.map((vessel) => {
        const current = SUSPECT_TRAJECTORIES[vessel.mmsi]!.at(-1)!;
        const ranking = getRanking(vessel.mmsi);
        const level = ranking?.level ?? "normal";
        return {
          id: vessel.mmsi,
          name: `${levelLabel(level)}·${vessel.name}`,
          type: "ship",
          coordinates: current.coord,
          importance: level === "primary" ? "high" : level === "secondary" ? "medium" : "low",
          status: levelToStatus(level),
          heading: current.heading,
          speed: current.speedKn,
          description: `MMSI ${vessel.mmsi} | ${vessel.type} | ${vessel.flag} | 第 ${ranking?.rank ?? "-"} 名 | 得分 ${ranking?.score ?? "-"} | ${ranking?.reasons ?? ""}`,
        };
      });

      const grouped = {
        primary: RANKING_BREAKDOWN.filter((ranking) => ranking.level === "primary"),
        secondary: RANKING_BREAKDOWN.filter((ranking) => ranking.level === "secondary"),
        normal: RANKING_BREAKDOWN.filter((ranking) => ranking.level === "normal"),
      };
      const enrich = (ranking: (typeof RANKING_BREAKDOWN)[number]) => {
        const vessel = getVessel(ranking.mmsi);
        return { ...ranking, name: vessel?.name, type: vessel?.type, flag: vessel?.flag };
      };
      const primary = grouped.primary[0];
      const primaryVessel = primary ? getVessel(primary.mmsi) : undefined;

      return {
        summary: `嫌疑船舶分级完成。首要嫌疑 ${grouped.primary.length} 艘${primaryVessel ? `（${primaryVessel.name}，MMSI ${primaryVessel.mmsi}，得分 ${primary?.score}）` : ""}，次要嫌疑 ${grouped.secondary.length} 艘，一般嫌疑 ${grouped.normal.length} 艘。`,
        totalSuspects: RANKING_BREAKDOWN.length,
        primary: grouped.primary.map(enrich),
        secondary: grouped.secondary.map(enrich),
        normal: grouped.normal.map(enrich),
        gisData: { type: "entity" as const, entities },
        metadata: {
          capability: "ais-suspect-ranking",
          mock: true,
          pollutionOrigin: POLLUTION_ORIGIN,
          primaryMmsi: primary?.mmsi,
        },
      };
    },
  };
}
