# Issue: 旧 Capability（火情/油污/海域等）调用链路中断

> **优先级**: P0（阻塞合并）  
> **关联**: [合并阻塞项汇总](agent-loop-merge-blockers.md)

---

## 问题描述

agent-loop 分支的 `pipeline.ts` 被替换为直接调用 `runAgentLoop`，不再走旧的 Planner → Router → Executor → Actions 链路。

结果是：
- `api/src/modules/actions/capabilities/fire.ts` 文件**还在磁盘上**
- 但**没有任何代码路径调用它**
- 用户发起"火情研判"、"排查漏油"等 query 时，Agent Loop 不认识这些 capability

---

## 受影响的 Capability

| Capability | 文件 | 当前状态 |
|---|---|---|
| 火情分析 | `fire.ts` | ❌ 无法触发 |
| 油污漂移溯源 | `oil-drift.ts` | ❌ 无法触发 |
| 海域态势分析 | `maritime.ts` | ❌ 无法触发 |
| 天基数据查询 | `satellite.ts` | ❌ 无法触发 |
| 情报分析 | `intelligence.ts` | ❌ 无法触发 |
| 新闻/舆情分析 | `news.ts` | ❌ 无法触发 |
| 气象数据获取 | `weather-fetch.ts` | ❌ 无法触发 |
| 地震灾后评估 | `earthquake-evaluation.ts` | ❌ 无法触发 |
| 洪水灾后评估 | `flood-evaluation.ts` | ❌ 无法触发 |
| AIS 数据获取 | `ais-fetch.ts` | ❌ 无法触发 |
| 区域标记 | `region-mark.ts` | ❌ 无法触发 |
| 边境推送 | `border-push.ts` | ❌ 无法触发 |
| GIS 操作 | `gis.ts` | ❌ 无法触发 |
| 需求收集 | `requirement.ts` | ❌ 无法触发 |

**注意**：`daily_report.ts` 和 `intelligent_qa.ts` 在 Agent Loop 中有同名工具，但实现不同（Agent Loop 版本直接调用外部 API，旧版本走 Executor）。

---

## 旧调用链路（main 分支）

```
用户: "分析东海火情"
  ↓
Planner → plan: { goal: "分析东海火情", steps: [...] }
  ↓
Router → actions: [{ type: "fire", params: { region: "东海" } }]
  ↓
Executor → 遍历 actions
  ↓
actionsService.execute(action)
  ↓
fire.ts → 调用外部 API → 生成结果
  ↓
SSE 推送 step_update → 前端展示
```

## 新调用链路（agent-loop 分支）

```
用户: "分析东海火情"
  ↓
runAgentLoop
  ↓
modelClient.decide() → DeepSeek API
  ↓
模型不认识 "fire" capability
  ↓
模型可能调用 Read/WebSearch/Bash 等通用工具
  ↓
结果不完整或错误
```

---

## 修复方案

### 方案 A：包装为 Agent Loop 工具（推荐）

把每个旧 capability 包装成一个 Agent Loop 可识别的 `ToolDefinition`：

```typescript
// systemTools.ts 或新增 capabilityTools.ts
import { analyzeFire } from "../actions/capabilities/fire.js";

registry.register({
  name: "FireAnalyze",
  description: "分析指定区域的火情，返回火点位置、强度、扩散趋势",
  inputSchema: z.object({
    region: z.string().describe("区域名称，如'东海'、'南海'"),
    date: z.string().optional().describe("日期，YYYY-MM-DD，默认今天"),
  }),
  kind: "system",
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  riskLevel: "low",
  async execute(input, context) {
    // 复用旧 capability 的核心逻辑
    const result = await analyzeFire(input.region, input.date);
    return {
      firePoints: result.points,
      intensity: result.intensity,
      spreadTrend: result.trend,
      gisData: result.gisData,  // 前端地图用
    };
  },
});
```

**优点**：
- 复用旧 capability 的核心业务逻辑
- 模型可以自主决策何时调用（"分析火情"→调用 FireAnalyze）
- 与 Agent Loop 架构一致

**缺点**：
- 每个 capability 都要包装
- 需要处理旧 capability 中的数据库写入、SSE 推送等副作用

### 方案 B：Pipeline 分流（短期兼容）

在 `pipeline.ts` 中根据 query 意图选择走哪条路：

```typescript
export async function runAgentPipeline(taskId: string, body: CreateTaskRequest) {
  // 判断是否为旧 capability query
  if (isLegacyCapabilityQuery(body.query)) {
    // 走旧 Pipeline
    return runOldPipeline(taskId, body);
  }
  // 走 Agent Loop
  return runAgentLoop({ taskId, query: body.query });
}

function isLegacyCapabilityQuery(query: string): boolean {
  const legacyKeywords = ["火情", "火灾", "漏油", "油污", "海域", "地震", "洪水", "卫星"];
  return legacyKeywords.some(kw => query.includes(kw));
}
```

**优点**：
- 改动最小，立即可用
- 旧 capability 零改动

**缺点**：
- 维护两套 Pipeline
- 关键词匹配不准确（"卫星地图"vs"卫星影像分析"）
- 用户无法在一个任务中同时使用新旧能力

### 方案 C：Skill 指令（中期）

为每个业务领域写一个 Skill，告诉 Agent Loop 何时调用哪个 capability：

```markdown
---
name: maritime-fire-response
description: 海域火情应急响应
whenToUse: 用户提到海域火情、火灾、燃烧等
allowedTools: [FireAnalyze, SatelliteQuery, AISQuery, Read, Bash]
---

# 海域火情响应流程

1. 用 FireAnalyze 分析火情位置和强度
2. 用 SatelliteQuery 获取卫星影像
3. 用 AISQuery 获取附近船舶位置（避让）
4. 综合生成态势报告
```

**优点**：
- 灵活性高，模型可自主组合多个 capability
- 与 SkillManager 集成

**缺点**：
- 需要为每个业务场景写 Skill
- 旧 capability 仍需包装为工具（同方案 A）

---

## 推荐路径

| 阶段 | 方案 | 目标 |
|---|---|---|
| 短期（合并前）| 方案 A：包装核心 capability | 火情/油污/海域至少能跑通 |
| 中期 | 方案 C：补充 Skill | 提升模型组合能力 |
| 长期 | 方案 A 完善 | 所有 capability 都可用 |

**不推荐方案 B**（分流）长期维护成本高，除非紧急合并且时间不够。

---

## 首批需要包装的工具

按业务优先级：

1. **FireAnalyze**（火情分析）— 最核心，前端有专门 UI
2. **OilSpillTrace**（油污溯源）— 核心 capability
3. **MaritimeSituation**（海域态势）— 高频使用
4. **SatelliteQuery**（天基查询）— 支撑其他 capability
5. **EarthquakeEvaluate**（地震评估）— 应急场景
6. **FloodEvaluate**（洪水评估）— 应急场景

---

## 验收标准

- [ ] 用户输入"分析东海火情"，Agent Loop 能正确调用 FireAnalyze 工具
- [ ] 工具执行结果包含 GIS 数据，前端地图能正确渲染
- [ ] 用户输入"排查油污"，能正确调用 OilSpillTrace 工具
- [ ] 旧 capability 的核心逻辑（外部 API 调用、数据处理）被复用，不重新实现
- [ ] 工具返回格式与前端 `formatTaskResult` 兼容（或更新 formatter）
