# 三、Agent Loop 调用链路

## 3.1 总体流程

```
用户提交任务
    │
    ▼
api/src/modules/tasks/routes.ts  ← REST / SSE 路由
    │
    ▼
api/src/modules/tasks/controller.ts
    │
    ▼
api/src/modules/tasks/pipeline.ts  ← 真实任务入口
    │
    ▼
api/src/modules/agent-loop/runAgentLoop.ts
    │
    ├── 构建 ToolRegistry（system + domain + Skill）
    ├── 加载上下文（ContextProvider）
    ├── 循环每轮：
    │     ├── PromptManager 组装 system + user + 工具目录 + skill 列表 + 上下文
    │     ├── ContextWindowManager 压缩消息
    │     ├── ModelClient.decide() 调 DeepSeek
    │     ├── 决策分支：
    │     │     ├── final_answer → 结束
    │     │     └── tool_calls → 继续
    │     ├── 分批执行工具（并发/串行）
    │     │     └── callTool() → validateInput → checkPermissions → execute
    │     ├── 结果写入 observations + conversationMessages
    │     └── Skill 发现预取
    │
    └── 达到 maxTurns 或 final_answer / error
```

## 3.2 任务 Pipeline 入口

`api/src/modules/tasks/pipeline.ts`：

```ts
export async function runAgentPipeline(taskId: string, body: CreateTaskRequest) {
  await taskService.updateTaskStatus(taskId, "running");

  const loopResult = await runAgentLoop({
    taskId,
    query: body.query,
    fileLogger,
    transcriptStore: createBestEffortTranscriptStore(createDbTranscriptStore(db), console),
  });

  const result = buildAgentLoopTaskResult(loopResult);
  await taskService.updateTaskResult(taskId, result, "completed");
}
```

## 3.3 Agent Loop 主循环

`api/src/modules/agent-loop/runAgentLoop.ts` 核心代码：

```ts
export async function* runAgentLoopEvents(options: RunAgentLoopOptions) {
  const maxTurns = options.maxTurns ?? 10;
  const registry = options.registry ?? buildDefaultToolRegistry();
  const modelClient = options.modelClient ?? createModelClient();
  const skillManager = options.skillManager ?? defaultSkillManager;

  registerSkillTool(registry, skillManager);

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    // 1. 准备消息
    const rawMessages = promptManager.buildMessages({ ... });
    const messages = contextWindowManager.prepareMessages({ messages: rawMessages }).messages;

    // 2. 调用模型
    const decision = await modelClient.decide({ messages, tools: activeTools, ... });

    // 3. 处理决策
    if (decision.type === "final_answer") {
      // 返回最终结果
      return result;
    }

    // 4. 执行工具调用
    const batches = partitionToolCalls(registry, decision.toolCalls, maxConcurrentToolCalls);
    for (const batch of batches) {
      const batchObservations = yield* executeToolBatch({ ... });
      observations.push(...batchObservations);
    }

    // 5. Skill 发现预取
    pendingSkillPrefetch = skillManager.startSkillDiscoveryPrefetch(null, postToolMessages, toolUseContext);
  }
}
```

## 3.4 工具注册表

`api/src/modules/agent-loop/tools/_shared/toolRegistry.ts`：

```ts
export function buildDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registerSystemTools(registry);   // Bash/Read/Write/Edit/Glob/Grep/WebSearch/WebFetch/TodoWrite/Sleep
  registerDomainTools(registry);   // SqlQuery/WeatherFetch/RegionResolve/RegionMark/DisasterQuery/SatelliteImageSearch/ImageAnalysis
  return registry;
}
```

### 系统工具（`tools/system/`）

| 工具 | 说明 |
|------|------|
| `Read` | 读取文件 |
| `Write` | 写入文件 |
| `Edit` | 编辑文件 |
| `Glob` | 文件 glob 查找 |
| `Grep` | 文件内容搜索 |
| `Bash` | 执行 shell 命令 |
| `WebSearch` / `WebFetch` | 网络搜索与抓取 |
| `TodoWrite` | 任务列表管理 |
| `Sleep` | 延时 |

### 领域工具（`tools/domain/`）

| 工具 | 说明 |
|------|------|
| `SqlQuery` | 执行 SQL 查询 |
| `SqlQuerySchema` | 查询数据库 schema |
| `WeatherFetch` | 获取天气数据 |
| `RegionResolve` | 区域解析 |
| `RegionMark` | 区域标记 |
| `DisasterQuery` | 灾害查询 |
| `SatelliteImageSearch` | 卫星影像搜索 |
| `ImageAnalysis` | 影像分析 |

## 3.5 工具执行网关

`api/src/modules/agent-loop/tools/_shared/toolGateway.ts` 执行顺序：

```
lookup by name/alias
  → schema validation
  → validateInput
  → abort check
  → checkPermissions
  → execute
  → result budget normalization
  → ToolObservation
```

## 3.6 工具分批执行

```ts
function partitionToolCalls(registry, toolCalls, maxConcurrentToolCalls): ToolCallBatch[] {
  // 并发安全的工具一起执行
  // 非并发安全的工具串行执行
}
```

同时支持**只读工具去重**：相同参数的同一只读工具只会执行一次，后续调用直接返回缓存结果。

## 3.7 上下文管理

| 模块 | 文件 | 职责 |
|------|------|------|
| ContextProvider | `contextProvider.ts` | 加载 git/task/adr/CONTEXT.md/transcript 上下文 |
| ContextWindowManager | `contextWindowManager.ts` | 上下文窗口压缩与预算管理 |
| MemoryManager | `memoryManager.ts` | 记忆管理（当前为 noop） |
| TranscriptStore | `transcriptStore.ts` | 每轮请求/回复/工具结果持久化到数据库 |
| FileLogger | `fileLogger.ts` | 写入 `logs/agent-loop-*.jsonl` |

## 3.8 Agent Loop 事件类型

事件类型定义在 `packages/shared/src/types/agent-loop.ts`。

| 事件类型 | 说明 |
|----------|------|
| `agent_turn` | 新一轮开始 |
| `model_request` | 发送给模型的请求 |
| `assistant_message` | 模型返回的消息 |
| `tool_calls` | 模型请求调用工具 |
| `tool_batch` | 一批工具开始执行 |
| `tool_call` | 单个工具调用 |
| `tool_progress` | 工具执行进度 |
| `tool_observation` | 工具执行结果 |
| `tool_message` | 工具结果消息 |
| `loop_stop` | 循环结束，返回结果 |

事件通过 SSE 推送给前端：

```ts
function publishAgentLoopEvent(event: AgentLoopEvent) {
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
    // model_request / tool_message 不推送
  }
}
```

## 3.9 关键文件索引

| 文件 | 职责 |
|------|------|
| `api/src/modules/agent-loop/runAgentLoop.ts` | Agent Loop 主循环 |
| `api/src/modules/agent-loop/skillManager.ts` | Skill 发现、加载、`Skill` 工具注册 |
| `api/src/modules/agent-loop/modelClient.ts` | DeepSeek LLM 客户端 |
| `api/src/modules/agent-loop/promptManager.ts` | Prompt 组装 |
| `api/src/modules/agent-loop/contextProvider.ts` | 上下文加载 |
| `api/src/modules/agent-loop/contextWindowManager.ts` | 上下文窗口压缩 |
| `api/src/modules/agent-loop/transcriptStore.ts` | Transcript 持久化 |
| `api/src/modules/agent-loop/fileLogger.ts` | JSONL 日志 |
| `api/src/modules/agent-loop/tools/_shared/toolRegistry.ts` | 工具注册表 |
| `api/src/modules/agent-loop/tools/_shared/toolGateway.ts` | 工具调用网关 |
| `api/src/modules/agent-loop/tools/_shared/types.ts` | 核心类型定义 |
| `api/src/modules/tasks/pipeline.ts` | 任务 Pipeline 入口 |
| `api/src/modules/tasks/routes.ts` | 任务 REST + SSE 路由 |
