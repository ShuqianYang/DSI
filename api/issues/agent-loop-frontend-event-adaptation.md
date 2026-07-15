# Issue: Agent Loop 事件无法在前端回显

> **优先级**: P0（阻塞合并）  
> **关联**: [合并阻塞项汇总](agent-loop-merge-blockers.md)

---

## 问题描述

Agent Loop 执行过程中产生丰富的事件流（tool_calls、tool_progress、tool_observation 等），但前端 `useTaskChat.ts` 只理解旧 Pipeline 的事件格式，导致 Agent Loop 的执行过程**完全不可见**。

用户只能看到：
1. "正在为您规划任务..."（开始）
2. "最终回答：..."（结束）

中间的 2-10 轮工具调用、执行进度、观察结果全部空白。

---

## 事件类型对比

### 旧 Pipeline 事件（前端能处理）

| 事件类型 | 含义 | 前端展示 |
|---|---|---|
| `planning` | Planner 开始分析 | 思考面板显示 "任务规划 - 运行中" |
| `planning_done` | Planner 输出 plan | 展开 plan steps，开始动画 |
| `routing` | Router 开始决策 | 思考面板显示 "工具决策 - 运行中" |
| `routing_done` | Router 输出 actions | 显示 action 列表 |
| `step_update` | Executor 执行某 action | 更新对应 step 状态（pending/running/completed/failed）|
| `completed` | 任务完成 | 显示最终结果，关闭 SSE |
| `failed` | 任务失败 | 显示错误信息 |

### Agent Loop 事件（前端不处理）

| 事件类型 | 含义 | 当前前端行为 |
|---|---|---|
| `agent_turn` | 新一轮开始 | ❌ 忽略 |
| `model_request` | 发送请求给模型 | ❌ 不推送（内部事件）|
| `assistant_message` | 模型返回最终回答或工具调用 | ❌ 忽略 |
| `tool_calls` | 模型决策调用 N 个工具 | ❌ 忽略 |
| `tool_batch` | 开始执行一批工具（并发/串行）| ❌ 忽略 |
| `tool_call` | 单个工具开始执行 | ❌ 忽略 |
| `tool_progress` | 工具执行进度更新 | ❌ 忽略 |
| `tool_observation` | 工具执行完成，返回结果 | ❌ 忽略 |
| `tool_message` | 结果回填到 conversation | ❌ 不推送（内部事件）|
| `loop_stop` | 循环结束（final/max_turns/error/aborted）| ❌ 忽略 |

---

## 根因分析

`useTaskChat.ts` 的 `handleSseUpdate` 函数通过 `data.type` 判断事件类型：

```typescript
if (data.type === 'planning') { ... }
if (data.type === 'planning_done') { ... }
if (data.type === 'routing') { ... }
if (data.type === 'step_update') { ... }
if (data.type === 'completed' || data.type === 'failed') { ... }
```

Agent Loop 的事件类型（`tool_calls`, `tool_progress` 等）没有对应的处理分支，被直接丢弃。

---

## 修复方案

### 方案 A：后端适配层（推荐短期方案）

在 `api/src/modules/tasks/pipeline.ts` 中，把 Agent Loop 事件翻译为前端能理解的事件格式：

```typescript
// pipeline.ts 中拦截 Agent Loop 事件
const result = await runAgentLoop({
  taskId,
  query: body.query,
  onToolProgress: (event) => {
    notifyTaskUpdate(taskId, {
      type: "step_update",
      actionId: event.toolCallId,
      name: event.toolName,
      status: "running",
      detail: event.message || `正在执行 ${event.toolName}...`,
      percent: event.percent,
    });
  },
});

// agent_turn → planning
// tool_calls → routing_done（构造 actions 列表）
// tool_observation → step_update + completed
// loop_stop(final_answer) → completed
// loop_stop(model_error/aborted) → failed
```

**优点**：
- 前端不改代码，立即可用
- 旧 Pipeline 的 UI 体验基本保留

**缺点**：
- 信息丢失（Agent Loop 的 `tool_batch` 并发信息无法映射到旧格式）
- 长期维护两套事件语义

### 方案 B：前端扩展（推荐长期方案）

在 `useTaskChat.ts` 中新增对 Agent Loop 事件的处理：

```typescript
// 新增 Agent Loop 事件处理
if (data.type === 'tool_calls') {
  // 显示工具调用列表（类似 routing_done）
}
if (data.type === 'tool_progress') {
  // 显示进度条
}
if (data.type === 'tool_observation') {
  // 显示工具结果摘要
}
if (data.type === 'loop_stop') {
  // 处理最终状态
}
```

**优点**：
- 能完整展示 Agent Loop 的所有信息
- 无信息丢失，用户体验更好

**缺点**：
- 前端改动量大
- 需要重新设计思考面板的 UI

### 方案 C：混合方案（推荐）

第一阶段（立即）：后端适配层，让前端能用  
第二阶段（后续）：前端逐步原生支持 Agent Loop 事件

---

## 最小可行修复（MVP）

只改 `pipeline.ts`，实现以下映射：

| Agent Loop 事件 | 映射为 | 前端效果 |
|---|---|---|
| `agent_turn` | `planning` | 显示 "Agent 思考中..." |
| `tool_calls` | `routing_done` | 显示工具列表 |
| `tool_progress` | `step_update` + running | 显示进度 |
| `tool_observation` | `step_update` + completed | 标记完成 |
| `loop_stop` + `final_answer` | `completed` | 显示最终回答 |
| `loop_stop` + `model_error` | `failed` | 显示错误 |

---

## 验收标准

- [ ] 创建 Agent Loop 任务后，前端能看到工具调用列表
- [ ] 每个工具执行时，前端显示进度（如有 percent）
- [ ] 工具执行完成后，前端显示完成状态
- [ ] 最终回答正确展示在聊天消息中
- [ ] 如果执行失败，前端显示错误信息而非无限 loading
