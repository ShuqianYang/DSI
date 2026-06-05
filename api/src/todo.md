# Agent Loop Prompt / Context / Memory / Skills TODO


## 0. Agent loop smoke test first

先保留一个最小端到端测试，用来确认主 loop、模型调用、tool use、tool observation 回填和最终回答都能跑通。

脚本位置：

- `api/scripts/agent-loop-smoke.ts`

package script：

- `api/package.json` 里的 `agent:smoke`

### 环境要求

- 在 `api/.env` 配好模型和搜索相关环境变量：
  - `DEEPSEEK_API_KEY`
  - `DEEPSEEK_API_URL`
  - `DEEPSEEK_MODEL`
  - `TAVILY_API_KEY`
  - `TAVILY_SEARCH_URL`
  - `AGENT_WORKSPACE_ROOT`
  - `AGENT_TIMEZONE`
- 如果本机需要 conda 环境，先进入对应环境，例如 `conda activate dsi`。

### 基础运行方式

从 `api/` 目录运行：

```bash
pnpm agent:smoke -- --query "请用只读工具查看当前仓库的 api/src/modules/agent-loop 目录，概括有哪些核心文件。"
```

如果当前环境没有 `pnpm`，可以直接运行：

```bash
node_modules/.bin/tsx scripts/agent-loop-smoke.ts --query "请用只读工具查看当前仓库的 api/src/modules/agent-loop 目录，概括有哪些核心文件。"
```

### 本地 txt 文件 + Read + WebSearch 测试

测试目标：让 agent 先读取本地 txt 文件中的问题，再调用 `WebSearch` 完成任务。

准备一个文件，例如从仓库根目录创建：

```bash
mkdir -p tmp
printf "请查询北京今天的天气，并用中文给出：\n1. 当前天气和温度范围\n2. 是否需要带伞\n3. 一句简短出行建议\n" > tmp/agent-loop-question.txt
```

从 `api/` 目录运行：

```bash
node_modules/.bin/tsx scripts/agent-loop-smoke.ts \
  --query "请先读取 tmp/agent-loop-question.txt 里的问题，然后完成文件中要求的任务" \
  --max-turns 6
```

也可以把文件放在 `api/tmp/agent-loop-question.txt`，此时 query 里使用 `api/tmp/agent-loop-question.txt`，避免路径歧义。当前 `Read` / `Glob` / `Grep` 的路径解析以 `AGENT_WORKSPACE_ROOT` 为准；未配置时会从进程工作目录向上寻找 `.git` / `pnpm-workspace.yaml`。后续应在 system prompt 里明确“相对路径默认按 workspace root 解析”。

### 开放 tool 的方式

当前 smoke runner 默认开放全部 system tools：

```ts
const DEFAULT_TOOLS = [
  "Bash",
  "Glob",
  "Grep",
  "Read",
  "Write",
  "Edit",
  "TodoWrite",
  "Sleep",
  "WebSearch",
  "WebFetch",
];
```

默认全开放不代表裸执行；所有 tool call 都会经过 `ToolGateway` / `ToolPolicy`：

- `allow`：直接执行。
- `deny`：直接拒绝。
- `sandbox`：优先以 portable sandbox MVP 执行。
- `ask`：smoke runner 在终端询问 `[y/N]`，输入 `y` 执行，其他输入拒绝。

收窄工具集合：

```bash
node_modules/.bin/tsx scripts/agent-loop-smoke.ts --tools Read,WebSearch --query "..."
```

`--with-websearch` / `--with-webfetch` 仍保留为兼容参数；在默认全开时通常不需要。

### 权限策略位置

- 默认策略：`api/src/modules/agent-loop/toolPolicy.ts`
- 策略执行入口：`api/src/modules/agent-loop/toolGateway.ts`
- Bash cwd 校验与命令权限判断：`api/src/modules/agent-loop/systemTools.ts`
- ask y/n handler：`api/scripts/agent-loop-smoke.ts`

### 在哪里改开放工具

- 修改 smoke 测试默认工具：`api/scripts/agent-loop-smoke.ts` 的 `DEFAULT_TOOLS`。
- 修改 smoke 测试命令行开关：`api/scripts/agent-loop-smoke.ts` 的 `parseArgs()`。
- 修改真实可注册工具集合：`api/src/modules/agent-loop/systemTools.ts` 的 `buildClaudeCodeBaseSystemTools()`。
- 修改工具注册/选择策略：`api/src/modules/agent-loop/toolRegistry.ts` 和调用 `runAgentLoopEvents()` 时传入的 `registry`。
- 修改工具权限策略：各 tool definition 的 `isReadOnly` / `validateInput` / `checkPermissions`，以及 `api/src/modules/agent-loop/toolGateway.ts` 的执行入口。

### 下一步要补的测试项

- [x] 把 txt 文件测试写成固定 smoke case，避免手工准备文件。
- [x] 明确 `Read` 相对路径基准，并让 smoke runner 与 `ContextProvider.systemContext.workspaceRoot` 保持一致。
- [x] 增加 `Read + WebSearch` 的断言：至少出现一次 `Read`、一次 `WebSearch`，并以 `final_answer` 停止。
- [x] 增加 `WebSearch` 结果源质量测试，检查来源数量、URL、摘要和日期字段是否进入 observation。
- [x] 增加工具策略测试，确保默认全工具注册时 `allow/deny/sandbox/ask` 行为正确。

已完成的测试套件：

- `agent:smoke` — 端到端冒烟测试（需真实模型）
- `agent:edge` — 19 个边界 case（mock model）
- `agent:extra` — 8 个额外 case：AbortSignal、Bash sandbox、Sleep 取消、Write 边界、Edit 恢复、无效参数、并发 batch 拆分、Read offset 边界

## 1. Tool safety boundary

目标：做到“受控可执行”，不实现 Claude Code 完整 sandbox / approval 系统。

当前已实现：

- `ToolPolicy` MVP：`allow` 直接执行，`deny` 直接拒绝，`sandbox` 优先执行，`ask` 交给 `permissionHandler`。
- 文件类工具统一以 `AGENT_WORKSPACE_ROOT` 为根做路径解析。
- `Read` / `Glob` / `Grep` / `Write` / `Edit` 会拒绝逃逸 workspace 的路径。
- 已补真实路径检查：symlink 指向 workspace 外时会拒绝，不只做字符串路径判断。
- `Write` / `Edit` 拒绝写入 `.git`，且覆盖已有 symlink 文件时会检查真实目标仍在 workspace 内。
- `Bash.cwd` 必须在 workspace 内。
- `Bash.validateInput` 只校验 `cwd` 是否在 workspace 内；命令安全由 `Bash.checkPermissions` 判断。
- `Bash.checkPermissions` 对明显危险命令返回 `deny`，由 `ToolGateway` 转成 `permission_denied`：
  - `rm` / `rmdir` / `mv` / `cp` / `chmod` / `chown` / `sudo` / `kill` / `dd` 等。
  - `git push/reset/checkout/clean/commit/merge/rebase/pull/...` 等 git mutation。
  - `npm/pnpm/yarn/bun install/add/remove/update/...` 等包管理 mutation。
  - `pip install/uninstall` 等 Python 包 mutation。
  - shell 输出重定向、heredoc、`curl|sh` / `wget|bash` 这类下载即执行。
  - Bash 命令参数中的 workspace 外绝对路径，例如 `/etc/passwd`。
- `Bash.isReadOnly(input)` 保守识别 `pwd/ls/cat/head/tail/wc/grep/rg/find/git/diff/test/echo/sed` 等读命令，仅用于 read-only 判断；未知命令不会被标记为 read-only。
- `Bash` 默认走 portable sandbox MVP：
  - 强制 workspace cwd。
  - 使用受限 env 白名单，避免把 API key / DB URL 直接暴露给 shell。
  - 保留 timeout、输出预算、危险命令拦截。
  - 该 MVP 可在 macOS / Linux / Windows 上运行，但不是 OS 级隔离。
- `Write` / `Edit` 默认走 `ask`；smoke runner 会在 CLI 中询问 `[y/N]`。
- 主 loop 对并发 tool batch 有默认上限 `5`，避免一轮内同时打出过多 `Read` / `Grep` / `Glob`。
- 同一 concurrent batch 内的重复只读 tool call 会提前去重，只执行第一个，其余返回 duplicate observation。
- `task_steps` 已作为第一版审计日志，记录 tool 参数、执行状态、结果和错误。

已覆盖 edge-case：

- `bash-policy-readonly`
- `bash-policy-deny-outside-path`
- `bash-policy-deny-dangerous`
- `bash-policy-deny-command-substitution`
- `bash-exit-code`
- `ask-policy-deny-write`
- `permission-handler-error`
- `dedup-read-only-concurrent`
- `circular-reference-output`
- `concurrent-batch-limit`
- `grep-large-output`
- `abort-signal` — AbortSignal 触发后主 loop 干净停止
- `bash-sandbox-env` — sandbox 下敏感 env 变量不泄漏
- `sleep-signal-cancel` — Sleep 中被取消正常退出
- `write-boundary` — Write 拒绝 workspace 外路径
- `edit-mismatch` — old_string 不匹配时模型可恢复
- `invalid-tool-args` — 模型返回异常/无效参数被 Zod 拒绝
- `concurrent-batch-split` — 超过并发上限时正确拆 batch
- `read-offset-boundary` — offset 超出文件长度返回空内容

后续暂不做 / 待做：

- [ ] 不做完整 shell AST 解析；当前只做轻量 token/regex 分类，复杂 shell 语义后续再补。
- [ ] 服务端/前端审批流未接入；当前只有 smoke runner CLI y/n handler。
- [ ] 不做系统级 sandbox；如后续需要再接 Docker / bwrap / sandbox-exec。
- [ ] DB 访问不要通过 Bash 暴露连接串，应实现独立业务 tool，例如 `QueryDatabase` / `RunSqlReadOnly` / `ExecuteBusinessAction`。
- [ ] Skills 只提供能力说明和参数建议，不能绕过 `ToolGateway` 直接执行。
- [ ] `WebFetch` 的 404 用例依赖外部网络，后续改成本地 mock HTTP server，避免环境波动。
- [ ] `WebFetch` 需要补 SSRF/内网地址限制：拒绝 `localhost`、private IP、metadata IP、非 http/https 等。

## 2. Prompt / runtime state policy

目标：保持 Claude Code 风格的隐式 ReAct，不要求模型输出显式 `Thought -> Action -> Observation` 文本格式。

当前已实现：

- `PromptManager` 负责最终 system prompt 拼装，不负责拉取 context/memory/skills。
- system prompt 明确工具循环规则：
  - 需要外部信息、工作区检查、web 查询或执行动作时使用工具。
  - 工具返回 observation 后，根据 observation 决定继续、换工具、承认限制或 final answer。
  - observation 已足够回答时必须停止继续工具调用。
  - 不为了“更全面”重复调用工具，不重复同参数 tool call。
  - 不暴露完整 chain-of-thought，只简短说明意图或进展。
- `TodoWrite` 是复杂任务的 checklist 工具，不是每轮必用，也不是默认 plan 前置步骤。
- `PromptManagerInput.runtimeSections` 用于注入 loop 当前状态，不混入 ContextProvider：
  - 当前 `TodoWrite` 状态会以 `tool_state.todos` 注入。
  - 后续 plan mode 状态可通过 `tool_state.plan_mode` 注入。

后续待做：

- [ ] 为 `TodoWrite -> tool_state.todos` 补固定 edge case，而不是只靠手工 fake model 验证。
- [ ] 实现真正的 `EnterPlanMode` / `ExitPlanMode` 后，再把 plan approval 状态接入 `planModeState`。
- [ ] ContextWindowManager 压缩历史 tool_result 时，必须保留 runtimeSections 中的当前 todo/plan 状态。


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

- 当前 `defaultPromptManager` 只提供最小 system prompt，并把工具列表、context、memory、skills 渲染进 system message。
- PromptManager 负责最终提示词模板：base system prompt、工具说明排布、section 顺序、section 渲染格式、最终 `AgentMessage[]` 输出。
- PromptManager 不负责 context/memory/skill 的召回和生命周期；这些材料由对应 provider/manager 先提供。
- PromptManager 不负责长上下文 compact；发送前的窗口治理交给 `ContextWindowManager`。
- 当前 loop 通过 `RunAgentLoopOptions.promptManager` 注入，默认使用 `defaultPromptManager`。

Implemented:

- Phase 1: `defaultPromptManager.buildMessages()` renders a structured system prompt with agent role, operating rules, tool-use rules, context priority, available tools, and additional context.
- Phase 1: tool metadata is rendered deterministically without executing tool callbacks.
- Phase 1: prompt sections are rendered in a stable order: user context, system context, project/domain context, runtime state, memory, then skills.

Deferred:

- provider/model-specific prompt variants.
- prompt personalization beyond answering in the user's language.
- rendering observations into summary sections; current loop keeps observations as conversation tool messages.
- prompt section token budgeting beyond `ContextWindowManager`.

## Context Provider

接口位置：

- `api/src/modules/agent-loop/contextProvider.ts`

核心接口：

```ts
export interface ContextProvider {
  getUserContext(input: ContextProviderInput): Promise<Record<string, string>>;
  getSystemContext(input: ContextProviderInput): Promise<Record<string, string>>;
  getContextSections(input: ContextProviderInput): Promise<PromptSection[]>;
}
```

说明：

- `noopContextProvider` 仍保留为测试/显式覆盖用；默认实现已接入 `defaultContextProvider`。
- 当前 loop 通过 `RunAgentLoopOptions.contextProvider` 注入。
- ContextProvider 只负责“提供上下文材料”，不负责 memory、skills、prompt 组装或窗口治理。
- 接口仿照 Claude Code 的 `getUserContext()` / `getSystemContext()` 语义：
  1. `getUserContext`：用户/项目显式上下文，例如 AGENTS.md、CLAUDE.md、当前日期、用户设置。
  2. `getSystemContext`：系统/工作区运行态上下文，例如 Git 状态、任务状态、cache breaker。
  3. `getContextSections`：不适合 key/value 的项目、任务、业务域上下文。

Implemented:

- Phase 1: `defaultContextProvider.getUserContext()` injects current date and bounded project instruction files when explicitly enabled.
- Phase 1: `defaultContextProvider.getSystemContext()` injects workspace root, bounded git status, and task status when available.
- Phase 1: `defaultContextProvider.getContextSections()` injects bounded `CONTEXT.md` as `project.domain`.
- Phase 2: project instruction files are disabled by default and can be enabled with `AGENT_CONTEXT_PROJECT_INSTRUCTIONS=1`.
- Phase 2: `docs/adr` is exposed as bounded `project.adr_index`.
- Phase 2: task records and task steps can be rendered as `task.requirements` and `task.progress`.
- Phase 2: `context_provider.diagnostics` reports loaded sections and skipped sources.

Deferred:

- user preference/config loading beyond project instruction files.
- bounded include expansion for project instruction files.
- full database-backed context-provider integration tests.
- durable transcript-based resume context.

已实现函数说明（供参考，非待实现项）：

### `getUserContext(input)`

参数说明：

- `input.taskId`：当前任务 ID，用于加载任务级上下文和日志关联。
- `input.query`：本次 agent run 的原始用户请求。
- `input.tools`：当前暴露给模型的工具列表，可用于根据工具能力生成上下文。
- `input.toolUseContext`：主 loop 运行时上下文，包含消息、observations、工具状态、缓存集合等。
- `input.signal`：取消信号，长耗时上下文加载应支持中断。

大体实现方式：

- 读取 AGENTS.md / CLAUDE.md / 用户配置 / 当前日期等用户侧上下文。
- 返回 `Record<string, string>`，key 要稳定，例如 `projectInstructions`、`currentDate`。
- 不读取 memory，不发现 skills，不做 prompt 排布。

### `getSystemContext(input)`

参数说明：

- `input.taskId`：当前任务 ID，用于读取任务状态和日志关联。
- `input.query`：本次 agent run 的原始用户请求。
- `input.tools`：当前暴露给模型的工具列表。
- `input.toolUseContext`：主 loop 运行时上下文。
- `input.signal`：取消信号。

大体实现方式：

- 读取 Git 状态、任务元数据、工作区状态、业务域配置等系统侧上下文。
- 返回 `Record<string, string>`，key 要稳定，例如 `gitStatus`、`taskStatus`。
- 不做最终 prompt section 排序；排序交给 PromptManager。

### `getContextSections(input)`

参数说明：

- `input.taskId`：当前任务 ID。
- `input.query`：本次 agent run 的原始用户请求。
- `input.tools`：当前暴露给模型的工具列表。
- `input.toolUseContext`：主 loop 运行时上下文。
- `input.signal`：取消信号。

大体实现方式：

- 读取不适合放进 `userContext/systemContext` 的业务域上下文、任务上下文、项目上下文。
- 返回 `PromptSection[]`，section id 使用稳定命名空间，例如 `project.domain`、`task.requirements`。
- 不包含 memory/skills；这些由对应 manager 单独产出。

## Context Window

接口位置：

- `api/src/modules/agent-loop/contextWindowManager.ts`

核心接口：

```ts
export interface ContextWindowManager {
  prepareMessages(input: PrepareMessagesInput): Promise<PreparedModelMessages>;
}
```

说明：

- `noopContextWindowManager` 仍保留为测试/显式覆盖用；默认实现已接入 `defaultContextWindowManager`。
- 当前 loop 通过 `RunAgentLoopOptions.contextWindowManager` 注入。
- ContextWindowManager 只负责“发送给模型前的窗口治理”，不负责取 context 材料，也不负责 prompt 模板。

Implemented:

- Phase 1: `defaultContextWindowManager.prepareMessages()` enforces a character budget, truncates large tool messages, and preserves assistant/tool adjacency.
- Phase 2: context-window diagnostics include `json-chars` and approximate token estimates.
- Phase 2: message groups are priority-aware and preserve system/latest-user invariants.
- Phase 2: truncated tool results include model-visible truncation metadata.
- Phase 2: `context_window.compaction_candidates` exposes deterministic candidates for a future LLM compactor.

Deferred:

- LLM summary compaction.
- post-compact reinjection of file state and skill/tool declarations.
- durable transcript-based resume.
- persistent storage/reference handles for oversized tool results.

已实现函数说明（供参考，非待实现项）：

### `prepareMessages(input)`

参数说明：

- `input.messages`：PromptManager 组装后的完整候选 messages。
- `input.toolUseContext`：当前轮运行时上下文，含工具列表、readFileState、memory/skill 触发状态等。

大体实现方式：

- 对即将发送给模型的 messages 做最终治理。
- 先实现简单 token/字符预算：限制超大 tool result、超长历史、重复 attachment。
- 后续接入 compact / summarize / post-compact reinjection。
- 保证 assistant tool call 与 tool result 的配对关系不被破坏。

## Memory

接口位置：

- `api/src/modules/agent-loop/memoryManager.ts`

核心接口：

```ts
export interface MemoryManager {
  startRelevantMemoryPrefetch(
    messages: readonly AgentMessage[],
    toolUseContext: AgentLoopToolUseContext
  ): AgentLoopPrefetch | undefined;
  filterDuplicateMemorySections?(
    sections: PromptSection[],
    toolUseContext: AgentLoopToolUseContext
  ): PromptSection[];
  remember?(input: RememberInput): Promise<void>;
}
```

说明：

- 当前 `noopMemoryManager` 不启动召回，也不做写入。
- 当前 loop 在 run 开始时调用一次 `startRelevantMemoryPrefetch`，工具执行后若 prefetch 已完成则消费并注入下一轮。
- 当前 loop 在最终回答后调用可选 `remember`。
- 当前 loop 通过 `RunAgentLoopOptions.memoryManager` 注入。
- 接口仿照 Claude Code 区分：
  1. relevant memory：每个用户 turn 启动一次 prefetch。
  2. session/durable memory：run 结束后通过 `remember` 维护。

待实现函数：

### `startRelevantMemoryPrefetch(messages, toolUseContext)`

参数说明：

- `messages`：当前对话消息。实现应从中找到最后一条真实用户输入，而不是只依赖 `query`。
- `toolUseContext`：运行时上下文，包含工具状态、`readFileState`、已 surfaced memory、取消信号等。

大体实现方式：

- 从 `messages` 中提取最后一条非 meta 用户请求。
- 根据用户请求、任务上下文、agent 类型、最近成功/失败工具选择 memory 搜索范围。
- 异步查询 memory 存储，返回 `AgentLoopPrefetch`：
  - `promise`：最终返回要注入的 `PromptSection[]`。
  - `settledAt`：完成时间；主 loop 只在完成后消费，避免阻塞当前轮。
  - `consumedOnIteration`：防止重复注入。
  - `dispose`：中断未完成查询、释放资源。

### `filterDuplicateMemorySections(sections, toolUseContext)`

参数说明：

- `sections`：prefetch 找到的 memory sections。
- `toolUseContext`：用于判断哪些 memory 已被工具读取、已注入或已存在于当前上下文。

大体实现方式：

- 用 `toolUseContext.readFileState` 或自定义缓存过滤重复 memory。
- 对保留的 memory 标记已 surfaced，避免后续轮次反复注入。
- 对超大 memory 做截断，并提示可用读取工具查看完整内容。

### `remember(input)`

参数说明：

- `input.query`：原始用户请求。
- `input.finalAnswer`：最终回答。
- `input.result`：终止原因、turn 数、observations。
- `input.messages`：run 完成时的会话消息。
- `input.observations`：工具观察结果。
- `input.toolUseContext`：运行时上下文和缓存状态。

大体实现方式：

- 实现 session memory：按阈值总结本轮或本会话状态。
- 实现 durable memory：沉淀用户偏好、项目经验、失败修正、业务知识。
- 避免存储可从代码直接重新推导的信息，优先保存跨会话有价值的外部事实。

## Skills

接口位置：

- `api/src/modules/agent-loop/skillManager.ts`

核心接口：

```ts
export interface SkillManager {
  getSkillListingSections(toolUseContext: AgentLoopToolUseContext): Promise<PromptSection[]>;
  startSkillDiscoveryPrefetch(
    input: string | null,
    messages: readonly AgentMessage[],
    toolUseContext: AgentLoopToolUseContext
  ): AgentLoopPrefetch | undefined;
  collectSkillDiscoveryPrefetch(prefetch: AgentLoopPrefetch): Promise<PromptSection[]>;
  discoverSkillDirsForPaths?(filePaths: string[], cwd: string): Promise<string[]>;
  activateConditionalSkillsForPaths?(filePaths: string[], cwd: string): string[];
}
```

说明：

- 当前 `defaultSkillManager` 为 `LocalSkillManager` 实例，已实现完整的 skill listing、discovery、条件激活和 Skill tool 执行。
- 当前 loop 通过 `RunAgentLoopOptions.skillManager` 注入，默认使用 `defaultSkillManager`。
- 接口仿照 Claude Code：主 loop 不直接每轮塞完整 skill 内容，而是提供 skill listing / discovery sections；完整 skill 通过 Skill tool 展开执行。

已实现：

- `getSkillListingSections`: 扫描 `skills/` 目录，返回轻量索引（名称/描述/when-to-use/args hint）。
- `startSkillDiscoveryPrefetch` / `collectSkillDiscoveryPrefetch`: 基于文件操作触发的动态 skill 发现。
- `discoverSkillDirsForPaths` / `activateConditionalSkillsForPaths`: 文件工具操作后触发 skill 目录发现和条件 skill 激活。
- `getSkill`: Skill tool 调用解析，支持 frontmatter、参数替换、embedded shell 命令。
- `registerSkillTool`: 将 Skill tool 注册到 `ToolRegistry`。
- 文件工具（Read/Write/Edit）通过 `triggerSkillHooksForPaths` 与 skill 发现挂接。

已实现函数说明：

### `getSkillListingSections(toolUseContext)`

- 扫描 workspace 根目录 `skills/` 下的 SKILL.md，解析 frontmatter。
- 返回轻量索引：名称、描述、when-to-use、args hint、paths 条件、allowed-tools。
- 不直接注入完整 `SKILL.md` 正文，避免 prompt 膨胀。

### `startSkillDiscoveryPrefetch(input, messages, toolUseContext)`

- 在每轮模型请求开始时启动异步 discovery。
- 根据 `dynamicSkillDirTriggers` 和 `pendingActivatedSkillNames` 判断是否有新 skill 需要注入。
- 返回 `AgentLoopPrefetch`，主 loop 在工具执行后消费结果并注入下一轮。

### `collectSkillDiscoveryPrefetch(prefetch)`

- 等待 discovery 结果，将新发现或新激活的 skills 格式化为 `PromptSection[]`。
- 通过 `sentDynamicSkillNames` 去重，避免重复注入同名 skill。

### `discoverSkillDirsForPaths(filePaths, cwd)`

- 文件工具（Read/Write/Edit）执行后调用，判断文件是否在工作区内。
- 返回 workspace 根目录 `skills/` 路径供后续加载。

### `activateConditionalSkillsForPaths(filePaths, cwd)`

- 匹配 skill frontmatter 中的 `paths`/glob 条件。
- 把命中的条件 skill 移入动态 skill 集合，加入 `pendingActivatedSkillNames`。
- 返回本次新激活的 skill 名称。

### `getSkill(name, toolUseContext)`

- Skill tool 调用时解析指定 skill，加载完整 `SKILL.md` 内容。
- 支持参数替换（`$ARGUMENTS`、`$1`、`$name`）。
- 支持 embedded shell 命令（`` !`cmd` `` 和 ````!` 代码块），结果替换进 skill 内容。
- 通过 `injectSkillContent` 注入 `toolUseContext.invokedSkillSections`。
- 通过 `applySkillAllowedTools` 限制 skill 可用工具白名单。

## 待实现问题

### 高优先级（核心能力缺口）

- [ ] **Memory 系统**：`startRelevantMemoryPrefetch` / `filterDuplicateMemorySections` / `remember` 当前为 `noopMemoryManager`，需实现异步 memory 召回和 durable 写入。
- [ ] **Transcript 数据库持久化**：接口和写入点已接入 `runAgentLoop.ts`，但 `disabledTranscriptStore` 为空操作，需实现真实 DB 存储。
- [ ] **Plan Mode**：`planModeState` 类型已定义、`tool_state.plan_mode` 已渲染，但缺少 `EnterPlanMode` / `ExitPlanMode` 工具和 approval 流程。

### 中优先级（体验增强）

- [ ] **Context Window compaction**：当前只有候选列表（`compaction_candidates`），需接入 LLM summary compaction 和 post-compact reinjection。
- [ ] **Tool Safety 增强**：
  - shell AST 完整解析（当前为轻量 token/regex）。
  - WebFetch SSRF/内网地址限制（`localhost`、private IP、metadata IP）。
  - WebFetch 本地 mock HTTP server 替代外部 404 测试。
  - DB 访问独立业务 tool（`QueryDatabase` / `RunSqlReadOnly`），避免通过 Bash 暴露连接串。
- [ ] **System Prompt 升级**：当前为基础版 `BASE_SYSTEM_PROMPT`，需设计 provider/model-specific 变体、observations summary section。
- [ ] **TodoWrite 固定 edge case**：补自动化测试，当前只靠手工 fake model 验证。

### 低优先级（后续扩展）

- [ ] **ContextProvider 扩展**：user preference/config 加载、bounded include expansion、full integration tests、durable transcript resume。
- [ ] **ContextWindowManager 扩展**：durable transcript-based resume、persistent storage/reference handles for oversized tool results。
- [ ] **Tool Safety 长期**：服务端/前端审批流（当前只有 CLI y/n handler）、系统级 sandbox（Docker/bwrap）。
- [ ] **统一 token 预算**：当前为字符预算（`json-chars`），需接入真实 token 计数和 section 级 budget。
