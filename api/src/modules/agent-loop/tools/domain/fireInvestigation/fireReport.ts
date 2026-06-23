import { z } from "zod";
import type { ToolDefinition } from "../../_shared/types.js";
import { BURNED_AREA_HECTARES, FIRE_ASSESSMENT, FIRE_CENTER_LAT, FIRE_CENTER_LNG, FIRE_TYPE } from "./mockData.js";

const InputSchema = z.strictObject({
  region: z.string().trim().min(1).default("Kensai"),
});

type FireReportInput = z.infer<typeof InputSchema>;

export function buildFireReportMockTool(): ToolDefinition {
  return {
    name: "FireReportMock",
    aliases: ["fire-report"],
    description:
      "Deterministic mock fire investigation report for the Kensai demo. Returns a structured summary and final assessment.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute(input) {
      const parsed = input as FireReportInput;
      const assessment = FIRE_ASSESSMENT;

      const report = {
        title: `${parsed.region} 火情智能研判报告`,
        location: {
          region: parsed.region,
          center: [FIRE_CENTER_LNG, FIRE_CENTER_LAT],
          description: "哈萨克斯坦 Kensai 地区河谷地带",
        },
        detection: {
          fireDetected: true,
          confidence: "高",
          fireType: FIRE_TYPE,
          burnedAreaHectares: BURNED_AREA_HECTARES,
        },
        assessment,
        recommendations: [
          "持续监测火情蔓延趋势，重点关注东北-西南向扩散路径",
          "调集边境巡逻力量加强现场巡查与 early warning",
          "评估边境围栏、通信线路等基础设施受损风险",
          "准备灾后植被恢复与生态修复方案",
        ],
        disclaimer: "本报告基于演示数据生成，仅供系统功能验证使用。",
      };

      return {
        summary: `${parsed.region} 火情研判完成。烧毁面积约 ${BURNED_AREA_HECTARES} 公顷，风险等级高，建议持续监测并部署边境巡查。`,
        region: parsed.region,
        report,
        gisData: {
          type: "entity" as const,
          entities: [
            {
              id: "fire-report-marker",
              name: `${parsed.region} 研判结论点`,
              type: "fire",
              coordinates: [FIRE_CENTER_LNG, FIRE_CENTER_LAT] as [number, number],
              importance: "high",
              status: "danger",
              description: `火情研判完成 | ${FIRE_TYPE} | 烧毁 ${BURNED_AREA_HECTARES} 公顷`,
            },
          ],
        },
        metadata: { capability: "fire-report", mock: true },
      };
    },
  };
}
