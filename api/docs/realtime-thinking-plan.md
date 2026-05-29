# 实时 Planner + Router 思考过程 — 实现规划

## 现状问题

```
用户Query
   │
   ▼
POST /tasks (同步阻塞 2-5s)
   ├── Planner.generatePlan()     ← 前端看不到
   ├── Router.decideActions()     ← 前端看不到
   └── 返回 {taskId, plan, actions, status}
        │
        ▼
   前端自己构造 thinking/thinkingSteps
   然后连接 SSE（此时Planner/Router早已结束）
```

## 目标架构

```
用户Query
   │
   ▼
POST /tasks (立即返回 {taskId, status: "pending"})
   │
   ▼ 前端立刻建立 SSE
EventSource /tasks/{taskId}/stream
   │
   ├──← planning         : {type: "planning", stage: "planner", message: "正在分析用户意图..."}
   ├──← planning_done    : {type: "planning_done", plan: {...}}
   ├──← routing          : {type: "routing", stage: "router", message: "正在决策执行工具..."}
   ├──← routing_done     : {type: "routing_done", actions: [...]}
   ├──← step_update      : {type: "step_update", ...}  ← 已有
   └──← completed/failed : {type: "completed", ...}     ← 已有
```

## 改动文件清单

### 后端 (api/)

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/modules/tasks/controller.ts` | 重构 createTask | 拆分为"立即返回"+"异步pipeline" |
| `src/modules/tasks/controller.ts` | 新增私有函数 `runAgentPipeline` | 异步执行Planner→Router→分流 |
| `src/modules/tasks/service.ts` | 可选：新增 updateTaskThinking | 把plan/reasoning写入task字段 |

### 前端 (src/)

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/components/ChatPanel.tsx` | 重构 handleSend | 先渲染"等待规划"占位消息 |
| `src/components/ChatPanel.tsx` | 扩展 handleSseUpdate | 处理 planning/routing 事件 |
| `src/types/prd.ts` | 扩展 SSE 事件类型 | 定义 planning/planning_done/routing/routing_done |

## SSE 事件协议扩展

```ts
// 新增事件类型
type SseEvent =
  | { type: "planning"; stage: "planner"; message: string }       // Planner 开始
  | { type: "planning_done"; plan: Plan }                         // Planner 完成
  | { type: "routing"; stage: "router"; message: string }         // Router 开始
  | { type: "routing_done"; actions: Action[] }                   // Router 完成
  | { type: "step_update"; stepIndex; actionId; status; name }    // 已有
  | { type: "completed" | "failed"; taskId; status }              // 已有
```

## 实现步骤（建议分块）

### Step 1：后端 — 重构 createTask 为异步 Pipeline
- `createTask` 创建 task 记录后立即 `res.status(201).json({taskId, status: "pending"})`
- 新增 `runAgentPipeline(taskId, body)` 异步函数
- 在 Pipeline 关键节点调用 `notifyTaskUpdate(taskId, event)` 推送 SSE
- 保留原有逻辑（subscription/requirement 分流、BullMq 投递）

### Step 2：后端 — 测试 SSE 事件推送
- 用 curl / 脚本验证：创建任务后，SSE 流中能否按顺序收到
  planning → planning_done → routing → routing_done → step_update → completed

### Step 3：前端 — ChatPanel 支持实时 thinkingSteps
- handleSend 时先插入一条"正在规划..."的 AI 消息
- thinkingSteps 初始为 `[{id:"planner", name:"任务规划", status:"running"}, ...]`
- 收到 SSE 事件后，逐步填充/更新 thinkingSteps
- 收到 planning_done 时，把 plan.steps 转为 thinkingSteps
- 收到 routing_done 时，把 actions 追加为 thinkingSteps

### Step 4：联调测试
- 端到端测试订阅类/即时类 query
- 验证 thinkingSteps 的渲染顺序和状态流转

## 风险点

1. **前端连接时机**：createTask 立即返回后，前端建立 SSE 需要几十毫秒。如果 Planner/Router 执行很快（<100ms），前端可能错过 planning 事件。
   - 缓解：thinkingSteps 的初始状态从 API 响应中带回来（createTask 可以返回 plan 和 actions，前端用它们初始化 thinkingSteps，SSE 只负责更新状态）

2. **Express res.send 后继续执行**：Node.js 不会关闭连接，异步代码可以安全继续。

3. **纯订阅/需求任务**：status 直接为 completed，SSE 推送 completed 后立即关闭。
