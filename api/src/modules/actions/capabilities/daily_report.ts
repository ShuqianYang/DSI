import { v4 as uuidv4 } from "uuid";
import type { Action, ActionResult } from "@datasourceintelligence/shared";
import type { Capability } from "../types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 日报生成能力
// 真实接口：POST http://192.168.0.27:18800/daily-report-direct
// 未来替换为真实 Agent API 调用

export const dailyReportCapability: Capability = {
  name: "daily_report",
  description: "日报生成：生成安防日报、周报、专项报告，支持总体/设备监控/预警事态三种类型",

  execute: async (action: Action, _context?: Record<string, unknown>): Promise<ActionResult> => {
    await sleep(2000);
    const params = action.params as { query?: string; report_type?: string };
    const date = params.query || new Date().toISOString().slice(0, 10);
    const reportType = params.report_type || "all";

    const typeMap: Record<string, string> = {
      all: "总体态势",
      buckle: "设备监控",
      event: "预警事态",
    };
    const typeName = typeMap[reportType] || "总体态势";

    const mockData = {
      date,
      report_type: reportType,
      report_content: `## ${date} 园区安防日报（${typeName}）

### 一、总体态势

今日园区整体安全态势平稳，未发生重大安全事件。系统运行正常，各监测设备在线率 98.7%。

### 二、设备监控

| 设备类型 | 在线数 | 离线数 | 在线率 |
| --- | --- | --- | --- |
| 摄像头 | 142 | 3 | 97.9% |
| 周界雷达 | 8 | 0 | 100% |
| 门禁系统 | 24 | 1 | 96.0% |
| 环境监测 | 16 | 0 | 100% |

### 三、预警事态

今日共产生预警 **${Math.floor(Math.random() * 30 + 10)} 起**，均已处理完毕。

| 预警级别 | 数量 | 处理状态 |
| --- | --- | --- |
| 一级预警 | ${Math.floor(Math.random() * 5)} | 已处理 |
| 二级预警 | ${Math.floor(Math.random() * 10 + 3)} | 已处理 |
| 三级预警 | ${Math.floor(Math.random() * 15 + 5)} | 已处理 |

### 四、重点关注

- 大门入口在 08:30-09:00 期间出现人员高峰，属正常通勤时段
- 码头区域今日无异常船舶活动
- 建议明日关注天气预报，做好防风准备

---
*报告生成时间：${new Date().toLocaleString("zh-CN")}*
`,
      summary: `今日园区安防态势平稳，设备在线率 98.7%，预警均已处理。`,
    };

    return {
      success: true,
      data: mockData,
      metadata: {
        capability: "daily_report",
        executionTime: 1200,
        mock: true,
      },
    };
  },
};
