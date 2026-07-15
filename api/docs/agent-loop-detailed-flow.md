# Agent Loop 详细流程与真实示例

> 文档路径：`api/docs/agent-loop-detailed-flow.md`  
> 对应代码：`api/src/modules/agent-loop/`、`api/src/modules/tasks/pipeline.ts`

本文给出 Agent Loop 的完整数据流图，逐项解释图中每个模块的职责，并通过一个真实可运行的示例演示从用户输入到最终答案的完整 turn 流转。

---

## 1. 完整架构图

```text
                              用户请求
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         初始化阶段（只执行一次）                               │
│                                                                              │
│  1. runAgentLoopEvents(options)                                              │
│     ├── 构建 ToolRegistry（system + domain tools）                            │
│     ├── 注册 Skill 工具：registerSkillTool(registry, skillManager)            │
│     ├── 创建 ModelClient / PromptManager / ContextProvider /                   │
│     │   ContextWindowManager / MemoryManager / FileLogger                     │
│     └── 初始化 toolUseContext（taskId/query/messages/observations/tools）       │
└─────────────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         第 0 轮：上下文加载（只执行一次）                       │
│                                                                              │
│  ContextProvider                                                             │
│  ├── getUserContext()     → projectInstructions / currentDate                │
│  ├── getSystemContext()   → gitStatus / workspaceRoot / taskStatus           │
│  └── getContextSections() → project.domain / project.adr_index /              │
│                             task.requirements / task.progress /               │
│                             transcript.resume_context                        │
│                                                                              │
│  SkillManager                                                                │
│  └── getSkillListingSections() → skill.listing（所有 skill 名称+描述）        │
│                                                                              │
│  MemoryManager                                                               │
│  └── startRelevantMemoryPrefetch() → 异步召回近期同用户任务摘要               │
│                                    （在工具执行完成后再消费）                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            第 N 轮循环（1..maxTurns）                          │
│                                                                              │
│  A. 消费上一轮异步结果                                                        │
│     ├── skillManager.collectSkillDiscoveryPrefetch()                         │
│     │   → skill.discovery.* 段落                                             │
│     └── consumeMemoryPrefetchIfReady()                                       │
│         → memory.session_summary.* 段落                                      │
│                                                                              │
│  B. PromptManager.buildMessages()                                            │
│     按固定顺序拼接 system prompt：                                            │
│     ┌──────────────────────────────────────┐                                │
│     │ 1. baseSystem（角色、工具使用规则）   │                                │
│     │ 2. userContext（AGENTS.md/CLAUDE.md） │                                │
│     │ 3. systemContext（git/task 状态）     │                                │
│     │ 4. contextSections（项目/task 领域）  │                                │
│     │ 5. memorySections（历史任务摘要）     │                                │
│     │ 6. runtimeSections（TodoWrite 状态）  │                                │
│     │ 7. skillSections（skill 列表/发现）   │                                │
│     │ 8. toolCatalog（当前可用工具元数据）  │                                │
│     │ 9. observations（历史工具结果）       │                                │
│     │ 10. user query                        │                                │
│     └──────────────────────────────────────┘                                │
│                                                                              │
│  C. ContextWindowManager.prepareMessages()                                   │
│     ├── 估算总字符数                                                          │
│     ├── 按优先级删除低优先级 section                                          │
│     ├── per-tool 截断超长 observation                                        │
│     ├── orphan 清理（保留 tool 消息则保留对应 user/assistant）                │
│     └── 输出 preparedMessages                                                │
│                                                                              │
│  D. TranscriptStore.append(model_request)                                     │
│     → 写入 agent_transcript_entries（sequence++, turn, messages, prompt）      │
│                                                                              │
│  E. ModelClient.decide()  → DeepSeek API                                      │
│     ├── POST /chat/completions                                               │
│     ├── tools + tool_choice="auto"                                           │
│     └── 返回 assistant_message（可能含 tool_calls）                          │
│                                                                              │
│  F. DecisionAdapter / 解析模型返回                                            │
│     ├── final_answer → 结束循环，返回结果                                     │
│     └── tool_calls   → 继续执行工具                                           │
│                                                                              │
│  G. ToolGateway 执行工具                                                      │
│     对每一个 tool_call：                                                       │
│     ├── ToolRegistry.get(toolName) 解析真实工具                               │
│     ├── inputSchema.safeParse() 校验输入                                      │
│     ├── checkPermissions() / decideDefaultToolPolicy() 权限决策               │
│     │   ├── allow  → execute()                                               │
│     │   ├── deny   → 返回错误 observation                                     │
│     │   ├── ask    → 调用 permissionHandler                                   │
│     │   └── sandbox→ 在沙箱上下文中执行                                       │
│     ├── execute() 产生 ToolObservation                                        │
│     └── 结果截断到 maxResultSizeChars                                         │
│                                                                              │
│     调度策略：                                                                 │
│     ├── readOnly + isConcurrencySafe → 并发批处理 + 同输入去重                │
│     └── destructive → 串行执行                                               │
│                                                                              │
│  H. 回填与日志                                                                │
│     ├── observations.push(observation)                                       │
│     ├── conversationMessages.push(assistant_message, tool_messages...)       │
│     ├── TranscriptStore.append(assistant_message / tool_message / loop_stop) │
│     ├── FileLogger.logEvent(agent_turn/assistant_message/tool_call/loop_stop)│
│     └── 触发 skillManager.startSkillDiscoveryPrefetch()                       │
│         （根据本轮触及的文件/路径发现相关 skill）                              │
│                                                                              │
│  I. 循环回到 B                                                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           结束阶段                                            │
│                                                                              │
│  ├── MemoryManager.remember()  可选：持久化会话摘要/用户偏好                  │
│  ├── FileLogger.finish(result) 关闭 JSONL 日志                               │
│  └── 返回 AgentLoopResult { finalAnswer, turns, observations, stoppedBy }    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 组件逐项解释

### 2.1 `runAgentLoopEvents`

- **位置**：`api/src/modules/agent-loop/runAgentLoop.ts`
- **职责**：整个 Agent Loop 的入口生成器函数。负责初始化所有依赖、维护循环状态、产生 `AgentLoopEvent` 事件流，并在结束时返回 `AgentLoopResult`。
- **关键状态**：`observations`、`conversationMessages`、`toolUseContext`、`memorySections`、`skillDiscoverySections`。

### 2.2 `ToolRegistry`

- **位置**：`api/src/modules/agent-loop/tools/_shared/toolRegistry.ts`
- **职责**：管理所有可用工具的名称、别名和可见性。
- **默认注册**：`buildDefaultToolRegistry()` 注册 system tools（`Read/Grep/Bash...`）和 domain tools（`SqlQuery/RegionResolve/DailyReport...`），然后 `registerSkillTool()` 额外注册一个 `Skill` 工具。

### 2.3 `SkillManager`

- **位置**：`api/src/modules/agent-loop/skillManager.ts`
- **职责**：
  - `getSkillListingSections()`：每轮把 `skills/` 目录下所有 skill 的 frontmatter 渲染成 `skill.listing` section。
  - `startSkillDiscoveryPrefetch()` / `collectSkillDiscoveryPrefetch()`：根据本轮工具读写的文件路径，异步发现可能相关的 skill（如写入 `*.csv` 时激活 `csv-profile`）。
  - `getSkill()`：被 `Skill` 工具调用时加载完整 `SKILL.md` 内容并注入 prompt。

### 2.4 `ContextProvider`

- **位置**：`api/src/modules/agent-loop/contextProvider.ts`
- **职责**：确定性加载任务级上下文，不调用模型、不调用工具。
- **输出**：
  - `userContext`：`currentDate`、可选的 `AGENTS.md/CLAUDE.md`。
  - `systemContext`：`gitStatus`、`workspaceRoot`、`taskStatus`。
  - `contextSections`：`project.domain`、`project.database_description`、`project.adr_index`、`task.requirements`、`task.progress`、`transcript.resume_context`。

### 2.5 `MemoryManager`

- **位置**：`api/src/modules/agent-loop/memoryManager.ts`、`sessionSummaryMemoryManager.ts`
- **职责**：
  - 启动时 `startRelevantMemoryPrefetch()` 异步查询数据库中当前用户近期已完成任务的 transcript 摘要。
  - 工具执行完毕后 `consumeMemoryPrefetchIfReady()` 把摘要注入为 `memory.session_summary.*` section。
  - `pipeline.ts` 默认使用 `createPipelineMemoryManager()` 启用该能力。

### 2.6 `TranscriptStore`

- **位置**：`api/src/modules/agent-loop/transcriptStore.ts`
- **职责**：
  - `append()`：把 `model_request`、`assistant_message`、`tool_message`、`loop_stop` 写入 `agent_transcript_entries`。
  - `load()`：恢复当前任务历史，用于生成 `transcript.resume_context`。
  - `pipeline.ts` 默认使用 `createDbTranscriptStore(db)` 启用持久化。

### 2.7 `PromptManager`

- **位置**：`api/src/modules/agent-loop/promptManager.ts`
- **职责**：把 `userContext/systemContext/contextSections/memorySections/runtimeSections/skillSections/observations` 按固定顺序拼接成最终 `AgentMessage[]`。
- **特点**：
  - 包含大量路由规则（GIS、Disaster Satellite、Oil Spill Mock、Fire Investigation 等）。
  - 维护 prompt 版本元数据，便于追踪不同规则版本。

### 2.8 `ContextWindowManager`

- **位置**：`api/src/modules/agent-loop/contextWindowManager.ts`
- **职责**：治理超长上下文。
- **策略**：
  - 字符预算（默认 120000）。
  - section 优先级分组删除。
  - per-tool 结果截断（`AGENT_TOOL_*_MAX_CHARS`）。
  - orphan 保护：若保留 tool 结果，必须同时保留对应的 assistant/user 消息。

### 2.9 `ModelClient`

- **位置**：`api/src/modules/agent-loop/modelClient.ts`
- **职责**：作为 Agent Loop 的稳定兼容门面，委托 `model/` 下的统一模型适配层完成配置、协议调用和响应归一化。
- **输入**：`messages`、`tools`、`callId`。
- **输出**：`NormalizedAgentDecision`（`final_answer` 或 `tool_calls`）。
- **配置**：优先读取 `AGENT_MODEL_*`，未配置字段回退 `MODEL_*`；迁移期兼容 `QWEN_*` 和 `DEEPSEEK_*`。
- **协议**：一期支持 OpenAI-compatible，可直接接入网络 API、SGLang 和 vLLM。
- **归一化**：分离 `content` 与 `reasoning`/`<think>`，统一 native/JSON tool calls、usage 和 finish reason。

### 2.10 `DecisionAdapter`

- **位置**：`api/src/modules/agent-loop/decisionAdapter.ts`
- **职责**：把模型返回的 JSON/文本解析成统一的 `NormalizedAgentDecision`。
- **支持格式**：
  - `{"type":"final_answer","content":"..."}`
  - `{"type":"tool_calls","toolCalls":[{"tool":"SqlQuery","input":{}}]}`

### 2.11 `ToolGateway` / `callTool`

- **位置**：`api/src/modules/agent-loop/tools/_shared/toolGateway.ts`
- **职责**：执行单个工具调用。
- **步骤**：解析工具 → schema 校验 → 自定义 `validateInput` → 权限决策 → `execute()` → 结果截断 → 返回 `ToolObservation`。

### 2.12 调度与并发

- **位置**：`runAgentLoop.ts` 中的 `executeToolCalls` 逻辑。
- **策略**：
  - readOnly 工具：同输入去重，可并行执行。
  - destructive 工具：串行执行，避免竞态。

### 2.13 `FileLogger`

- **位置**：`api/src/modules/agent-loop/fileLogger.ts`
- **职责**：把每个 `AgentLoopEvent` 写成 `logs/agent-loop-<taskId>-<timestamp>.jsonl`，用于审计和 smoke 测试回放。

---

## 3. 真实示例："查询南海的船舶情况"

下面演示用户请求触发 `skills/ais-region-query/SKILL.md` 后的完整 turn 流转。所有工具名、输入输出格式均来自实际代码。

### 3.1 初始化

```ts
// api/src/modules/tasks/pipeline.ts 调用入口
const loopResult = await runAgentLoop({
  taskId: "task_01J8X...",
  query: "查询南海的船舶情况",
  scenarioId: undefined,
  transcriptStore: createBestEffortTranscriptStore(createDbTranscriptStore(db), console),
  memoryManager: createPipelineMemoryManager({ ... }),
});
```

### 3.2 第 0 轮：上下文加载

```text
ContextProvider.getUserContext()    → { currentDate: "2026-06-30", projectInstructions: undefined }
ContextProvider.getSystemContext()  → { gitStatus: "M README.md\n?? api/docs/...", workspaceRoot: "..." }
ContextProvider.getContextSections()→ [
  { id: "project.database_description", content: "..." },
  { id: "transcript.resume_context",    content: "(empty)" }
]
SkillManager.getSkillListingSections() → [
  { id: "skill.listing", content: "ais-region-query: 区域船舶/AIS 查询..." }
]
MemoryManager.startRelevantMemoryPrefetch() → Promise<memory sections>
```

### 3.3 Turn 1：模型决定调用 RegionResolve

**Prompt 关键片段**：

```markdown
## skill.listing
- ais-region-query: 区域船舶/AIS 查询（结合 RegionResolve/RegionMark/SqlQuery）

## toolCatalog
- RegionResolve: 解析命名区域为 bbox
- RegionMark: 在地图上标记区域
- SqlQuerySchema: 查询 PostgreSQL schema
- SqlQuery: 执行 SQL

## user
查询南海的船舶情况
```

**ModelClient 请求**：

```json
{
  "model": "deepseek-v4-flash",
  "messages": [ /* 上述 prompt */ ],
  "tools": [ /* RegionResolve, RegionMark, SqlQuerySchema, SqlQuery, ... */ ],
  "tool_choice": "auto"
}
```

**模型返回**（经 DecisionAdapter 解析）：

```json
{
  "type": "tool_calls",
  "toolCalls": [
    {
      "id": "call-1",
      "toolName": "RegionResolve",
      "input": { "regionName": "南海" }
    }
  ]
}
```

**ToolGateway 执行 RegionResolve**：

```ts
// api/src/modules/agent-loop/tools/domain/gis/regionResolve.ts
execute({ regionName: "南海" }, context)
// → 查询 PostGIS region_geom 表
// → 返回
{
  ok: true,
  resolved: true,
  selected: {
    name: "南海",
    bbox: { north: 23.5, south: 3.5, east: 121.0, west: 105.0 },
    geometryRef: "region_geom/international/..."
  }
}
```

**事件流**：

```json
{ "type": "agent_turn", "taskId": "task_01J8X...", "turn": 1, "maxTurns": 10 }
{ "type": "assistant_message", "taskId": "task_01J8X...", "turn": 1, "content": "I'll resolve the South China Sea region first." }
{ "type": "tool_call", "taskId": "task_01J8X...", "turn": 1, "toolCall": { "id": "call-1", "toolName": "RegionResolve", "input": { "regionName": "南海" } } }
```

**状态更新**：

```ts
observations.push(regionResolveObservation);
conversationMessages.push(assistantMsg, toolMsg);
skillManager.startSkillDiscoveryPrefetch(toolUseContext); // 可能发现 ais-region-query
```

### 3.4 Turn 2：模型决定调用 RegionMark

**Prompt 变化**：observations 中多了 RegionResolve 结果，skill discovery 可能已激活 `ais-region-query`。

**模型返回**：

```json
{
  "type": "tool_calls",
  "toolCalls": [
    {
      "id": "call-2",
      "toolName": "RegionMark",
      "input": {
        "geometryRef": "region_geom/international/...",
        "fallbackGeometry": { "bbox": { "north": 23.5, "south": 3.5, "east": 121.0, "west": 105.0 } }
      }
    }
  ]
}
```

**RegionMark 执行结果**：

```json
{
  "ok": true,
  "gisData": {
    "type": "Feature",
    "geometry": { "type": "Polygon", "coordinates": [ [...] ] }
  }
}
```

### 3.5 Turn 3：模型先查 Schema 再执行 SQL

**模型返回**（一次发出两个 tool_calls）：

```json
{
  "type": "tool_calls",
  "toolCalls": [
    {
      "id": "call-3a",
      "toolName": "SqlQuerySchema",
      "input": { "tableName": "ais_current_states" }
    },
    {
      "id": "call-3b",
      "toolName": "SqlQuery",
      "input": {
        "query": "SELECT mmsi, name, longitude, latitude, sog, cog FROM public.ais_current_states WHERE latitude BETWEEN 3.5 AND 23.5 AND longitude BETWEEN 105.0 AND 121.0 LIMIT 50;"
      }
    }
  ]
}
```

**调度**：`SqlQuerySchema` 和 `SqlQuery` 都是 readOnly，会被并发执行。

**SqlQuerySchema 结果**：

```json
{
  "ok": true,
  "columns": [
    { "name": "mmsi", "type": "bigint" },
    { "name": "name", "type": "varchar" },
    { "name": "longitude", "type": "double precision" },
    { "name": "latitude", "type": "double precision" },
    { "name": "sog", "type": "double precision" },
    { "name": "cog", "type": "double precision" }
  ]
}
```

**SqlQuery 结果**：

```json
{
  "ok": true,
  "rows": [
    { "mmsi": "412123456", "name": "HAIYANG", "longitude": 112.3, "latitude": 18.5, "sog": 12.5, "cog": 45 },
    ...
  ]
}
```

### 3.6 Turn 4：模型输出最终答案

**模型返回**（经 DecisionAdapter 解析）：

```json
{
  "type": "final_answer",
  "content": "在南海区域（bbox: 3.5°N–23.5°N, 105°E–121°E）共查询到 50 艘船舶。其中包括 HAIYANG (MMSI 412123456) 位于 18.5°N, 112.3°E，航速 12.5 节，航向 45°。数据来自 AISStream 每小时注入的 `public.ais_current_states`，可能存在小时级延迟。"
}
```

**结束阶段**：

```ts
await appendTranscript({ kind: "loop_stop", turn: 4, stoppedBy: "final_answer", finalAnswer: "..." });
await memoryManager.remember?.({ ... });  // 可选：持久化会话摘要
await fileLogger.finish(result);
return {
  finalAnswer: "在南海区域...",
  turns: 4,
  observations: [...],
  stoppedBy: "final_answer"
};
```

---

## 4. 事件流总结

上述示例产生的事件序列：

```text
agent_turn(1/10)
assistant_message("I'll resolve the South China Sea region first.")
tool_call(RegionResolve)
tool_result(RegionResolve)

agent_turn(2/10)
assistant_message("Now I'll mark the region on the map.")
tool_call(RegionMark)
tool_result(RegionMark)

agent_turn(3/10)
assistant_message("Querying AIS data for the region.")
tool_call(SqlQuerySchema)
tool_call(SqlQuery)
tool_result(SqlQuerySchema)
tool_result(SqlQuery)

agent_turn(4/10)
assistant_message(final_answer)
loop_stop(final_answer)
```

---

## 5. 与 `pipeline.ts` 的关系

```text
前端 /tasks POST
    │
    ▼
api/src/modules/tasks/controller.ts
    │
    ▼
api/src/modules/tasks/pipeline.ts
    ├── 创建 fileLogger
    ├── 创建 dbTranscriptStore
    ├── 创建 pipelineMemoryManager
    └── 调用 runAgentLoop({ transcriptStore, memoryManager, ... })
            │
            ▼
    产生 AgentLoopEvent 流
            │
            ▼
api/src/modules/tasks/agentLoopSseMode.ts
    └── 转换为前端 SSE 事件
```

`pipeline.ts` 是生产环境的唯一入口，它把 Agent Loop 的结果持久化到 `tasks` 表，并通过 SSE 推送给前端。

---

## 6. 常见问题

### Q1：Skill 在哪里被调用？

有两种路径：

1. **被动展示**：`SkillManager.getSkillListingSections()` 每轮把 skill 列表放进 prompt，模型自己决定何时调用对应工具。
2. **主动触发**：模型输出 `{"type":"tool_calls","toolCalls":[{"toolName":"Skill","input":{"skill":"ais-region-query","args":"..."}}]}`，`Skill` 工具会加载完整 `SKILL.md` 并注入后续对话。

### Q2：Memory 什么时候生效？

`MemoryManager.startRelevantMemoryPrefetch()` 在循环开始时异步启动；在 turn 3 及以后，如果 prefetch 已 settle，会被消费进 `memorySections`。因此**第 2 轮及以后**的 prompt 可能包含历史任务摘要。

### Q3：Transcript 什么时候写入？

每次模型请求前写入 `model_request`，每次模型返回后写入 `assistant_message`，每个工具结果写入 `tool_message`，循环结束时写入 `loop_stop`。

### Q4：ContextWindowManager 会删除哪些内容？

按 section 优先级从低到高删除：

1. `observations` 中较旧的工具结果。
2. 低优先级的 `contextSections`（如 `project.adr_index`）。
3. `skillSections` 和 `memorySections`。
4. 必要时会截断单个 observation 而不是直接删除。

永远不会删除：当前轮次的 user query、最近的 assistant message 及其对应的 tool 结果（orphan 保护）。
