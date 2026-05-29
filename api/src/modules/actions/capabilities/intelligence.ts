import { v4 as uuidv4 } from "uuid";
import type { Action, ActionResult } from "@datasourceintelligence/shared";
import type { Capability } from "../types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 情报问答分析能力
// 未来替换为真实 Agent API 调用

export const intelligenceCapability: Capability = {
  name: "intelligence",
  description: "情报问答：基于开源情报回答地缘政治、军事动态、行业风险等问题",

  execute: async (action: Action, _context?: Record<string, unknown>): Promise<ActionResult> => {
    await sleep(2000);
    const params = action.params as { query?: string; depth?: string };
    const query = params.query || "未指定查询";

    // Mock 数据
    const mockData = {
      query,
      analysisId: uuidv4(),
      timestamp: new Date().toISOString(),
      summary: `基于开源情报分析，关于"${query}"的主要发现如下：`,
      findings: [
        {
          title: "地缘动态",
          content: "该区域近期军事活动频率有所增加，建议持续关注。",
          confidence: 0.85,
          sources: ["开源卫星影像", "AIS数据"],
        },
        {
          title: "航运影响",
          content: "受局势影响，该海域商船航线出现小幅调整，整体航运秩序正常。",
          confidence: 0.78,
          sources: ["航运数据库", "港口数据"],
        },
        {
          title: "风险评估",
          content: "当前区域风险等级为中等，未检测到重大安全威胁。",
          confidence: 0.72,
          sources: ["情报综合研判"],
        },
      ],
      recommendations: [
        "建议加强对该区域的日常监测",
        "关注后续军事演习动态",
        "保持与相关方沟通渠道畅通",
      ],
      keyEntities: [
        { name: "东海舰队", type: "军事单位", relevance: 0.9 },
        { name: "上海港", type: "港口", relevance: 0.7 },
        { name: "台湾海峡", type: "航道", relevance: 0.85 },
      ],
    };

    return {
      success: true,
      data: mockData,
      metadata: {
        capability: "intelligence",
        executionTime: 800,
        mock: true,
      },
    };
  },
};
