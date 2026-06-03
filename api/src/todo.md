# Agent Loop Prompt / Context / Memory / Skills TODO


## 持久化 transcript

为 agent loop 增加数据库持久化 transcript。

接口文件：

- `api/src/modules/agent-loop/transcriptStore.ts`

核心接口：

```ts
export interface AgentTranscriptStore {
  append(entry: AgentTranscriptEntry): Promise<void>;
  load(taskId: string): Promise<AgentTranscriptEntry[]>;
}
```

当前默认实现：

```ts
export const disabledTranscriptStore: AgentTranscriptStore
```

该实现不做持久化，只用于在数据库实现接入前保持 loop 可运行。

### 已接入位置

主循环接入文件：

- `api/src/modules/agent-loop/runAgentLoop.ts`

已预留的写入点：

1. `model_request`：每轮调用模型前，记录本轮实际传给模型的 messages。
2. `assistant_message`：模型返回最终回答或工具调用时记录 assistant message。
3. `tool_message`：工具执行完成后，记录带 `toolCallId` 的 tool result message。
4. `loop_stop`：记录 loop 的终止原因，包括 `final_answer`、`max_turns`、`model_error`。

### 数据库实现建议

建议新增 append-only 表，例如：

```ts
agentTranscriptEntries {
  id
  taskId
  turn
  sequence
  kind
  messageJson
  messagesJson
  finalAnswer
  error
  stoppedBy
  createdAt
}
```

约束建议：

- `(taskId, sequence)` 唯一。
- 按 `taskId, sequence` 升序恢复 transcript。
- `messageJson` / `messagesJson` 存储 `AgentMessage` 原始 JSON，避免 schema 尚未稳定时过早拆列。
- 后续 resume 时应校验 assistant `toolCalls[].id` 与 tool message `toolCallId` 是否配对。


## Prompt / System Prompt

接口位置：

- `api/src/modules/agent-loop/promptManager.ts`

核心接口：

```ts
export interface PromptManager {
  buildMessages(input: PromptManagerInput): AgentMessage[];
}
```

说明：

- 当前 `defaultPromptManager` 只提供最小 system prompt。
- system prompt、工具说明排布、context/memory/skill section 的组织策略都应在这里演进。
- 当前 loop 通过 `RunAgentLoopOptions.promptManager` 注入，默认使用 `defaultPromptManager`。

## Context

接口位置：

- `api/src/modules/agent-loop/contextManager.ts`

核心接口：

```ts
export interface ContextManager {
  buildContextSections(query: string): Promise<PromptSection[]>;
}
```

说明：

- 当前 `noopContextManager` 返回空数组。
- 后续可接项目上下文、任务上下文、用户上下文、领域知识、检索结果等。
- 当前 loop 通过 `RunAgentLoopOptions.contextManager` 注入。

## Memory

接口位置：

- `api/src/modules/agent-loop/memoryManager.ts`

核心接口：

```ts
export interface MemoryManager {
  recall(query: string): Promise<PromptSection[]>;
  remember?(query: string, finalAnswer: string): Promise<void>;
}
```

说明：

- 当前 `noopMemoryManager` 不做召回和写入。
- 后续可实现短期记忆、长期记忆、用户偏好、项目经验沉淀等。
- 当前 loop 在每轮模型调用前执行 `recall`，在最终回答后执行可选 `remember`。
- 当前 loop 通过 `RunAgentLoopOptions.memoryManager` 注入。

## Skills

接口位置：

- `api/src/modules/agent-loop/skillManager.ts`

核心接口：

```ts
export interface SkillManager {
  getRelevantSkills(query: string): Promise<PromptSection[]>;
}
```

说明：

- 当前 `noopSkillManager` 返回空数组。
- 后续可实现 skill 检索、skill prompt 注入、skill 权限/来源管理等。
- 当前 loop 通过 `RunAgentLoopOptions.skillManager` 注入。

## 待实现问题

- [ ] 为 agent loop 增加数据库持久化 transcript。
- [ ] 为超大 tool result 增加持久化存储，并在 transcript 中保存 preview/reference。
- [ ] 设计正式 system prompt。
- [ ] 设计 prompt section 组装顺序和优先级。
- [ ] 实现 ContextManager 的业务上下文召回。
- [ ] 实现 MemoryManager 的 recall/remember 存储策略。
- [ ] 实现 SkillManager 的 skill 检索和注入策略。
- [ ] 为 prompt/context/memory/skill 输出增加 token 预算和截断策略。

