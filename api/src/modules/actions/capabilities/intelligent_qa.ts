import { v4 as uuidv4 } from "uuid";
import type { Action, ActionResult } from "@datasourceintelligence/shared";
import type { Capability } from "../types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 智能问答能力
// 真实接口：POST http://192.168.0.27:18800/intelligent-QA-direct
// 未来替换为真实 Agent API 调用

export const intelligentQaCapability: Capability = {
  name: "intelligent_qa",
  description: "智能问答：回答统计查询、数据分析类问题，如预警事件数量、趋势统计等",

  execute: async (action: Action, _context?: Record<string, unknown>): Promise<ActionResult> => {
    await sleep(1500);
    const params = action.params as { query?: string };
    const query = params.query || "未指定查询";

    const mockData = {
      query,
      answerId: uuidv4(),
      timestamp: new Date().toISOString(),
      report_content: `## 查询结果：${query}

根据系统数据统计，为您整理了以下信息：

### 统计概览

| 指标 | 数值 |
| --- | --- |
| 查询时段 | 2026年3月 |
| 预警总数 | **128 起** |
| 一级预警 | 12 起 |
| 二级预警 | 45 起 |
| 三级预警 | 71 起 |

### 趋势分析

从趋势上看，本月预警数量较上月增加 8%，其中二级预警增幅最为明显（+15%）。

主要风险时段集中在每日的 14:00-16:00 和 20:00-22:00。

### 重点设备

预警产生最多的前 3 个设备：

| 排名 | 设备名称 | 预警数量 |
| --- | --- | --- |
| 1 | 大门入口摄像头-A1 | 23 起 |
| 2 | 周界雷达-R3 | 19 起 |
| 3 | 码头监控-Z2 | 16 起 |

如需进一步分析，可以告诉我具体的时间范围或设备信息。`,
      stats: {
        total: 128,
        level1: 12,
        level2: 45,
        level3: 71,
        trend: "+8%",
      },
      sources: ["预警数据库", "设备日志"],
    };

    return {
      success: true,
      data: mockData,
      metadata: {
        capability: "intelligent_qa",
        executionTime: 600,
        mock: true,
      },
    };
  },
};
