# Issue: 订阅意图与即时执行重复触发

## 问题描述

用户输入：**"帮我订阅每天15:40的日报"**

系统同时生成了：
1. 一条 **订阅记录**（subscriptions 表）
2. 一条 **日报事件**（events 表）
3. 一个 **执行任务**（tasks + task_steps + BullMq）

用户期望仅创建订阅，不应立即额外执行一次日报。

## 根因分析

### Router 同时匹配两个意图

`api/src/modules/router/service.ts` 中的 `mockDecideActions`（或 Dify Router）对同一 query 做了两组独立的关键词匹配：

| 意图检测 | 触发关键词 | 生成的 Action |
|---------|-----------|-------------|
| `hasSubscription` | "订阅" + "每天" + "15:40" | `subscription` (toolType=daily_report) |
| `needsReport` | "日报" | `daily_report` (即时执行) |

### Controller 分流后同时执行

`api/src/modules/tasks/controller.ts` 中 `runAgentPipeline` 的 Stage 3：

```
actions = [daily_report, subscription]

subscriptionActions  → createSubscription()     → 写入 subscriptions 表
daily_report (normal) → createTaskSteps() + taskQueue.add() → Worker 立即执行
```

### 订阅本身已包含执行逻辑

`api/src/modules/scheduler/service.ts` 中，订阅到期时会自动构造 Action 并执行：

```typescript
const action: Action = {
  type: sub.toolType,      // "daily_report"
  params: { ...queryParams, query: sub.name },
};
await actionsService.execute(action);  // 定时执行日报
```

**结论：subscription action 的 `toolType` 已隐含了要执行的工具类型，立即再执行一次 daily_report 是完全重复的。**

## 影响范围

- 用户体验：用户说"订阅"却被额外触发了一次即时执行，感知混乱
- 数据冗余：events 表中多了一条本不该存在的日报事件
- 资源浪费：BullMq 多执行了一次日报生成

## 修复方案

### 方案 A：Router 层解决（推荐）

修改意图优先级规则：**当用户明确表达订阅/定时/自动推送意图时，不再额外生成即时执行的 action。**

subscription action 的 params 中已携带 `toolType` 和 `toolParams`，调度器会在到期时自动执行对应工具，无需在创建时立即跑一次。

需要修改：
- `api/src/modules/router/service.ts` — `mockDecideActions` 的优先级逻辑
- Dify Router Agent Prompt — 增加规则："订阅意图优先，不重复生成即时 action"

### 方案 B：Controller 层兜底

在 `runAgentPipeline` 的分流逻辑中，检查 subscription action 的 `toolType`，如果与某个 normal action 类型一致，则跳过该 normal action 的即时执行。

```typescript
const subToolTypes = new Set(subscriptionActions.map(a => a.params?.toolType).filter(Boolean));
const dedupedNormal = normalActions.filter(a => !subToolTypes.has(a.type));
```

**建议优先采用方案 A**，在源头（Router）解决问题，Controller 只做分流不应承担去重职责。

## 相关代码

- `api/src/modules/router/service.ts` — Router 意图检测与 Action 生成
- `api/src/modules/tasks/controller.ts` — Stage 3 分流逻辑
- `api/src/modules/scheduler/service.ts` — 订阅定时执行逻辑

## 状态

- [ ] 待修复
- [ ] 已验证（修复后测试："帮我订阅每天15:40的日报"应仅生成 subscription，不生成即时 daily_report）

  以后如果修改了代码但行为不变，先执行：
  taskkill //F //IM esbuild.exe
  taskkill //F //IM node.exe
  再重启即可。
