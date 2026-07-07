# 新疆智能体项目前后端接口与流式输出格式说明

> 文档范围：当前项目（`D:/0 ysq文件/DSI-agent-loop`）Agent Loop 相关的前后端接口、SSE 流式事件格式、以及前端消费方式。
> 更新时间：2026-07-06

---

## 1. 整体架构

当前系统采用 **Express 后端（默认端口 3001）+ Next.js 前端** 的混合架构：

- **Express 后端**：承载 Agent Loop 核心 API、`/tasks`、`/sse/global`、日报下载、卫星回调等。
- **Next.js 前端**：主页面 `src/app/page.tsx` 通过 `fetch` 和 `EventSource` 直接调用 Express 后端。

```text
┌─────────────────┐      POST /tasks            ┌─────────────────┐
│   Next.js 前端   │ ──────────────────────────▶ │  Express 后端    │
│                 │      GET  /tasks/:id/stream │  (Agent Loop)   │
│                 │ ◀────────────────────────── │                 │
└─────────────────┘        SSE 事件流           └─────────────────┘
```

---

## 2. 后端 API 接口

### 2.1 Express 入口

**文件**：`api/src/index.ts`

```ts
app.use("/tasks", taskRoutes);
app.use("/", satelliteCallbackRoutes);
app.use("/", dashboardRoutes);
app.get("/sse/global", ...);
```

| 接口 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 创建任务 | POST | `/tasks` | 创建 Agent Loop 任务，返回 `taskId` |
| 任务详情 | GET | `/tasks/:taskId` | 获取任务完整结果 |
| 任务流式 | GET | `/tasks/:taskId/stream` | SSE 推送 Agent Loop 执行过程 |
| 日报下载 | GET | `/tasks/:taskId/daily-report/download` | 下载 Word 格式日报 |
| 全局 SSE | GET | `/sse/global` | 订阅全局事件（如定时任务触发） |
| 右侧面板数据 | GET | `/jobs` `/events` `/subscriptions` `/requirements` `/insights` | 信息服务列表数据 |

### 2.2 创建任务 `POST /tasks`

**路由**：`api/src/modules/tasks/routes.ts`

```ts
router.post("/", validateBody(createTaskSchema), asyncHandler(createTask));
```

**请求体**（`packages/shared/src/types/agent-loop.ts`）：

```ts
interface CreateTaskRequest {
  query: string;        // 用户输入
  userId?: string;      // 用户标识
  context?: Record<string, unknown>; // 额外上下文
}
```

**Controller**：`api/src/modules/tasks/controller.ts`

```ts
export async function createTask(req: Request, res: Response) {
  const body = req.body as CreateTaskRequest;
  const task = await taskService.createTask(body);

  res.status(201).json({
    taskId: task.id,
    status: "pending",
  });

  // 异步执行，不阻塞响应
  runAgentPipeline(task.id, body).catch((err) => {
    console.error(`[createTask] Pipeline error for task ${task.id}:`, err);
  });
}
```

**响应示例**：

```json
{
  "taskId": "01906b7a-...",
  "status": "pending"
}
```

任务创建后立即返回 `pending` 状态，实际执行在后台通过 `runAgentPipeline` 异步进行。

### 2.3 任务详情 `GET /tasks/:taskId`

返回任务的完整信息，包括最终结果、状态、错误等。

**任务状态**：`pending` / `running` / `completed` / `failed`

**任务结果结构**（`api/src/modules/tasks/agentLoopResultProjection.ts`）：

```ts
{
  "message": "## 分析结果\n...",
  "mode": "agent_loop",
  "turns": 2,
  "stoppedBy": "final_answer",
  "observations": [...],
  // 各观察结果还会被投影为 action result
}
```

### 2.4 日报下载 `GET /tasks/:taskId/daily-report/download`

**路由**：`api/src/modules/tasks/routes.ts:63`

前置条件：

- 任务必须存在
- 任务状态必须为 `completed`
- 任务结果中必须包含 `DailyReport` 工具的观察结果

流程：

```text
1. 从 tasks.result 中查找 DailyReport 观察结果
2. 如有缓存的 .docx 文件，直接返回
3. 否则调用 generateDailyReportDocx() 生成 Word
4. 将 Markdown 中的 chart://<chart_id> 替换为 PNG 图片
5. 返回 application/vnd.openxmlformats-officedocument.wordprocessingml.document
```

---

## 3. SSE 流式输出

### 3.1 SSE 连接建立

**路由**：`GET /tasks/:taskId/stream`

响应头：

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
Access-Control-Allow-Origin: *
```

连接成功后立即发送：

```text
data: {"type":"connected","taskId":"01906b7a-..."}

```

若任务已完成或失败，会回放一个 `loop_stop` 事件。

### 3.2 SSE 数据格式

每条消息格式统一为：

```text
data: {"type":"...", ...}\n\n
```

前端通过 `EventSource.onmessage` 接收并 `JSON.parse(event.data)`。

### 3.3 事件类型总览

核心事件类型定义在 `packages/shared/src/types/agent-loop.ts`。

| 事件类型 | 触发场景 | 是否推 SSE |
|----------|----------|-----------|
| `connected` | SSE 连接建立 | 是（路由层发送） |
| `agent_turn` | 每轮循环开始 | 是 |
| `model_request` | 发给模型的消息已组装 | 否 |
| `assistant_message` | 模型返回 assistant 消息 | 是 |
| `tool_calls` | 模型决定调用工具 | 是 |
| `tool_batch` | 工具分批执行 | 是 |
| `tool_call` | 单个工具开始执行 | 是 |
| `tool_progress` | 工具执行中进度 | 是 |
| `tool_observation` | 工具执行完成/失败 | 是 |
| `tool_message` | 工具结果进入对话上下文 | 否 |
| `loop_stop` | 循环结束 | 是 |

过滤逻辑在 `api/src/modules/agent-loop/runAgentLoop.ts:733`：

```ts
function publishAgentLoopEvent(event: AgentLoopEvent): void {
  switch (event.type) {
    case "agent_turn":
    case "tool_calls":
    case "tool_batch":
    case "tool_call":
    case "tool_progress":
    case "tool_observation":
    case "assistant_message":
    case "loop_stop":
      notifyTaskUpdate(event.taskId, event);
      break;
    case "model_request":
    case "tool_message":
      break; // 不推 SSE
  }
}
```

### 3.4 事件格式示例

#### connected

```json
{
  "type": "connected",
  "taskId": "01906b7a-..."
}
```

#### agent_turn

```json
{
  "type": "agent_turn",
  "taskId": "01906b7a-...",
  "turn": 1,
  "maxTurns": 10,
  "message": "Agent loop turn 1/10"
}
```

#### assistant_message

```json
{
  "type": "assistant_message",
  "taskId": "01906b7a-...",
  "turn": 1,
  "message": {
    "role": "assistant",
    "content": "我来查询一下今日预警数据。",
    "toolCalls": [...]
  }
}
```

#### tool_calls

```json
{
  "type": "tool_calls",
  "taskId": "01906b7a-...",
  "turn": 1,
  "count": 2,
  "tools": ["MysqlQuerySchema", "MysqlQuery"]
}
```

#### tool_call

```json
{
  "type": "tool_call",
  "taskId": "01906b7a-...",
  "turn": 1,
  "toolCallId": "call-1",
  "toolName": "MysqlQuery",
  "displayName": "数据库查询",
  "reason": "查询今日预警事件数量"
}
```

#### tool_progress

```json
{
  "type": "tool_progress",
  "taskId": "01906b7a-...",
  "turn": 1,
  "toolCallId": "call-1",
  "toolName": "DailyReport",
  "displayName": "日报生成",
  "stage": "progress",
  "message": "正在调用模型生成日报内容",
  "percent": 50,
  "data": null
}
```

`stage` 由工具内部定义，常见值：`start` / `progress` / `fetching` / `complete` / `error`。

#### tool_observation

```json
{
  "type": "tool_observation",
  "taskId": "01906b7a-...",
  "turn": 1,
  "toolCallId": "call-1",
  "toolName": "MysqlQuery",
  "displayName": "数据库查询",
  "ok": true,
  "observation": {
    "toolCallId": "call-1",
    "toolName": "MysqlQuery",
    "ok": true,
    "output": {
      "result": [...],
      "summary": "查询到 5 条记录"
    }
  }
}
```

#### loop_stop

```json
{
  "type": "loop_stop",
  "taskId": "01906b7a-...",
  "turn": 2,
  "result": {
    "finalAnswer": "## 分析结果\n...",
    "turns": 2,
    "observations": [...],
    "stoppedBy": "final_answer",
    "logFilePath": "logs/agent-loop/..."
  }
}
```

`stoppedBy` 可选值：

- `final_answer`：模型给出最终答案
- `max_turns`：达到最大轮数
- `model_error`：模型调用出错
- `aborted`：被中止

---

## 4. Tool 进度上报机制

### 4.1 ToolExecutionContext

**文件**：`api/src/modules/agent-loop/tools/_shared/types.ts`

```ts
export interface ToolExecutionContext {
  taskId: string;
  query: string;
  observations: ToolObservation[];
  signal?: AbortSignal;
  onProgress?: (event: ToolProgressEvent) => void;
  toolUseContext?: AgentLoopToolUseContext;
  permissionHandler?: ToolPermissionHandler;
  sandbox?: { enabled: boolean; kind: "portable"; reason?: string };
}

export interface ToolProgressEvent {
  toolCallId?: string;
  toolName?: string;
  displayName?: string;
  stage?: string;
  message?: string;
  percent?: number;
  data?: unknown;
}
```

### 4.2 工具内部上报示例

**DailyReport**：

```ts
context.onProgress?.({
  stage: "progress",
  message: "正在调用模型生成日报内容",
});
```

**WeatherFetch**：

```ts
context.onProgress?.({
  stage: "fetching",
  message: `正在获取 ${region} 天气数据`,
});
```

### 4.3 网关包装与事件转换

`ToolGateway` 包装 `onProgress`，补充 `toolCallId` / `toolName` / `displayName`：

```ts
onProgress: (event) =>
  context.onProgress?.({
    ...event,
    toolCallId: event.toolCallId || toolCall.id,
    toolName: event.toolName || toolCall.toolName,
    displayName: event.displayName || displayName,
  }),
```

`runAgentLoop` 将其转换为 `tool_progress` SSE 事件，通过 `notifyTaskUpdate` 广播。

---

## 5. 前端消费方式

### 5.1 API 客户端

**文件**：`src/lib/api.ts`

```ts
const API_BASE = "http://localhost:3001";

export async function createAgentTask(query: string) {
  return fetchJson("/tasks", {
    method: "POST",
    body: JSON.stringify({ query, userId: AGENT_LOOP_FIXED_USER_ID }),
  });
}

export async function getTask(taskId: string) {
  return fetchJson(`/tasks/${taskId}`);
}
```

### 5.2 创建任务流程

**文件**：`src/components/ChatPanel.tsx`

```ts
const { messages, inputValue, isLoading, setInputValue, sendMessage } =
  useTaskChat({ onGisDataRequest, onGisOperation, onTaskCreate, onTaskFinished });
```

用户发送消息时调用 `sendMessage(content)`，内部调用 `createAgentTask(query)`，然后立即建立 SSE 连接监听该 `taskId`。

### 5.3 SSE 消费 Hook

**文件**：`src/hooks/useTaskChat.ts`

```ts
const startTaskSse = (taskId: string) => {
  if (sseConnections.current.has(taskId)) return;

  const evtSource = new EventSource(`http://localhost:3001/tasks/${taskId}/stream`);
  sseConnections.current.set(taskId, evtSource);

  evtSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    const routed = routeTaskStreamEvent({ taskId, event: data, tracker: ... });

    if (routed.kind === 'agent-loop') {
      handleAgentLoopUpdate(taskId, routed.event);
    }
  };
};
```

### 5.4 事件路由

**文件**：`src/lib/taskStreamRouter.ts` / `src/lib/agentLoopEvents.ts`

前端识别的事件类型集合：

```ts
const agentLoopEventTypes = new Set([
  'agent_turn', 'model_request', 'assistant_message',
  'tool_calls', 'tool_batch', 'tool_call', 'tool_progress',
  'tool_observation', 'tool_message', 'loop_stop',
]);
```

### 5.5 UI 更新链路

`handleAgentLoopUpdate` 在 `useTaskChat.ts` 中执行：

1. 将事件转为 `ThinkingStep`（`src/lib/agentLoopStepFormatter.ts`）
2. 更新消息思考步骤 `upsertThinkingStep`
3. 提取 GIS 数据 `extractGisPushesFromAgentLoopEvent` → `pushGisPushes`
4. 提取图表 `extractChartsFromAgentLoopEvent` → 追加到 `msg.charts`
5. `loop_stop` 时调用 `finishTaskFromStream`，关闭 SSE，拉取完整结果 `GET /tasks/:taskId`

### 5.6 全局 SSE 订阅

**文件**：`src/app/page.tsx` / `src/hooks/useTaskChat.ts`

```ts
const es = new EventSource('http://localhost:3001/sse/global');
es.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'subscription_triggered_task' && data.taskId) {
    startTaskSse(data.taskId);
  }
};
```

用于接收定时任务触发等全局事件。

### 5.7 右侧面板刷新

**文件**：`src/app/page.tsx:420`

```ts
window.addEventListener('agent:task-created', (e) => {
  const taskId = e.detail;
  refresh(); // 刷新右侧面板任务列表
  const evtSource = new EventSource(`http://localhost:3001/tasks/${taskId}/stream`);
  evtSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    const routed = routeTaskStreamEvent({ taskId, event: data, tracker: ... });
    if (isNativeAgentLoopProgressEvent(routed.event)) {
      refresh();
    }
    if (getTaskFinishFromStreamEvent(routed.event)) {
      refresh();
      evtSource.close();
    }
  };
});
```

---

## 6. 关键文件索引

| 用途 | 文件路径 |
|------|----------|
| Express 入口 | `api/src/index.ts` |
| 任务路由 | `api/src/modules/tasks/routes.ts` |
| 任务 Controller | `api/src/modules/tasks/controller.ts` |
| 任务 Service | `api/src/modules/tasks/service.ts` |
| 任务 Pipeline | `api/src/modules/tasks/pipeline.ts` |
| 任务结果投影 | `api/src/modules/tasks/agentLoopResultProjection.ts` |
| loop_stop 回放 | `api/src/modules/tasks/agentLoopSseMode.ts` |
| Agent Loop 核心 | `api/src/modules/agent-loop/runAgentLoop.ts` |
| 工具网关 | `api/src/modules/agent-loop/tools/_shared/toolGateway.ts` |
| 共享类型 | `packages/shared/src/types/agent-loop.ts` |
| SSE 管理器 | `api/src/sse/sseManager.ts` |
| 日报工具 | `api/src/modules/agent-loop/tools/domain/dailyReport/dailyReport.ts` |
| 日报下载器 | `api/src/modules/agent-loop/tools/domain/dailyReport/dailyReportDownloader.ts` |
| 前端 API | `src/lib/api.ts` |
| 前端 SSE Hook | `src/hooks/useTaskChat.ts` |
| 事件路由 | `src/lib/taskStreamRouter.ts` |
| 事件解析 | `src/lib/agentLoopEvents.ts` |
| 思考步骤格式化 | `src/lib/agentLoopStepFormatter.ts` |
| GIS 数据桥接 | `src/lib/agentLoopGisBridge.ts` |
| 主页面 | `src/app/page.tsx` |
| 聊天面板 | `src/components/ChatPanel.tsx` |
| 右侧面板 | `src/components/right-panel/TaskSection.tsx` |
| 右侧面板数据 | `src/hooks/useRightPanelData.ts` |

---

## 7. 接口调用时序示例

### 7.1 普通 QA 查询

```text
前端                          后端
 │   POST /tasks              │
 │  {query:"今天有多少预警"}   │
 │───────────────────────────▶│
 │   {taskId, status:"pending"}│
 │◀───────────────────────────│
 │   GET /tasks/:taskId/stream│
 │───────────────────────────▶│
 │   SSE: connected           │
 │◀───────────────────────────│
 │   SSE: agent_turn          │
 │◀───────────────────────────│
 │   SSE: tool_calls          │
 │◀───────────────────────────│
 │   SSE: tool_call           │
 │◀───────────────────────────│
 │   SSE: tool_progress       │
 │◀───────────────────────────│
 │   SSE: tool_observation    │
 │◀───────────────────────────│
 │   SSE: assistant_message   │
 │◀───────────────────────────│
 │   SSE: loop_stop           │
 │◀───────────────────────────│
 │   GET /tasks/:taskId       │
 │───────────────────────────▶│
 │   完整结果                  │
 │◀───────────────────────────│
```

### 7.2 日报生成并下载

```text
前端                          后端
 │   POST /tasks              │
 │  {query:"今天总体日报"}     │
 │───────────────────────────▶│
 │   {taskId, status:"pending"}│
 │◀───────────────────────────│
 │   SSE 流式输出...           │
 │◀───────────────────────────│
 │   loop_stop 完成            │
 │   GET /tasks/:taskId       │
 │   确认 completed            │
 │   GET /tasks/:taskId/daily-report/download
 │───────────────────────────▶│
 │   .docx 文件                │
 │◀───────────────────────────│
```

---

## 8. 注意事项

1. **后端地址**：前端默认调用 `http://localhost:3001`，可通过环境变量或配置修改。
2. **SSE 重连**：当前实现未自动重连，断开后需重新创建任务或手动重连。
3. **日报下载前端未调用**：后端接口已实现，但 `TaskSection.tsx` 中的下载按钮当前被注释掉，如需使用需前端放开。
4. **model_request / tool_message 不推 SSE**：这两个事件仅用于内部 transcript 记录，前端不会收到。
5. **跨域**：SSE 响应头已设置 `Access-Control-Allow-Origin: *`。
