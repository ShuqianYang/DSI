# ADR-0003: Agent Loop 运行时架构评审

- **日期**: 2026-06-05
- **状态**: Accepted
- **作者**: Claude Code (Opus 4.8)
- **前序**: [ADR-0002: 项目架构演进评审](./0002-architecture-review.md)

---

## 背景

自 ADR-0002（2026-05-23）以来，项目引入了完整的 **Agent Loop 运行时**（`api/src/modules/agent-loop/`），这是自项目启动以来最重大的架构变更。

旧架构采用 **Pipeline 模式**：Planner → Router → Executor → Actions，每步都是独立的 LLM 调用或服务模块，通过数据库和队列串联。该模式在简单任务上工作良好，但存在以下问题：

1. **延迟高**：Planner、Router、Insight 各调一次 LLM，至少 3 次网络往返
2. **上下文断裂**：每步的 prompt 独立构造，历史上下文无法自然传递
3. **工具调用不灵活**：Executor 按预定义 plan 执行，不支持模型中途决策
4. **无法处理多轮交互**：单轮 pipeline 无法应对需要多次工具调用的复杂任务

新架构采用 **逐 turn Agent Loop 模式**（受 Claude Code 启发），模型每轮决策 → 执行工具 → 回填结果 → 下一轮，直到得出最终答案或达到最大轮数。

---

## 决策

引入 `api/src/modules/agent-loop/` 作为项目的核心 Agent 运行时，逐步替代旧 Pipeline 的部分职能。旧 Pipeline 的模块（Planner、Router、Executor、Actions）继续服务现有 capability，但新增 capability 优先接入 Agent Loop。

---

## 架构设计

### 三层分离

Agent Loop 的核心设计是 **Context → Prompt → Window 三层分离**，每层职责单一：

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ ContextProvider │ → │ PromptManager   │ → │ ContextWindow   │
│                 │    │                 │    │ Manager         │
│ 加载运行时上下文 │    │ 渲染 prompt     │    │ 治理窗口预算     │
│                 │    │                 │    │                 │
│ - AGENTS.md     │    │ - system prompt │    │ - 字符预算       │
│ - CLAUDE.md     │    │ - 工具目录       │    │ - tool 截断      │
│ - git status    │    │ - context       │    │ - 邻接保护       │
│ - task status   │    │   sections      │    │ - 优先级删除     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

**设计原则**：
- **ContextProvider** 只负责"加载"，不渲染、不截断、不调用模型
- **PromptManager** 只负责"渲染"，不加载上下文、不治理窗口、不调用模型
- **ContextWindowManager** 只负责"治理"，不加载上下文、不渲染 prompt、不调用模型

### Agent Loop 运行时

```
runAgentLoopEvents (AsyncGenerator)
│
├─ 初始化: contextProvider.load() + memoryPrefetch.start()
│
├─ for turn = 1..maxTurns:
│   ├─ promptManager.buildMessages()     → rawMessages
│   ├─ contextWindowManager.prepareMessages(rawMessages) → messages
│   ├─ modelClient.decide(messages)      → decision
│   │
│   ├─ if final_answer:
│   │   └─ 返回最终回答
│   │
│   ├─ if tool_calls:
│   │   ├─ toolRegistry.lookup(toolName)
│   │   ├─ toolGateway.execute()         → 权限检查 → schema 校验 → 执行
│   │   ├─ 并发/串行调度 (isConcurrencySafe)
│   │   ├─ readOnly 去重 (usedToolSignatures)
│   │   └─ 回填 conversationMessages + observations
│   │
│   └─ consume memory/skill prefetch
│
└─ max turns reached → 模型总结最终回答
```

### 工具注册与执行体系

```
ToolRegistry ──→ ToolGateway ──→ ToolObservation
     │              │
     │         ┌────┴────┐
     │         │         │
     │    schema    checkPermissions
     │    validate   (allow/deny/ask)
     │         │         │
     │         └────┬────┘
     │              │
     │         execute()
     │              │
     │         结果截断 (maxResultSizeChars)
     │              │
     └───────── ToolObservation
```

**关键设计**：
- **别名解析**：ToolRegistry 支持 `aliases`（如 `Read` 别名 `View`）
- **权限分层**：`isReadOnly` → `isDestructive` → `riskLevel` → `checkPermissions`
- **并发调度**：`isConcurrencySafe` 为 true 的工具可并行执行
- **去重优化**：readOnly 工具相同输入自动复用已有结果，减少重复调用

---

## 已实现的 Phase

### Phase 0.5: Agent Loop 基础框架

- `runAgentLoop.ts` — 主循环、事件流、工具批处理
- `toolRegistry.ts` / `toolGateway.ts` / `toolPolicy.ts` — 工具注册、执行、权限
- `systemTools.ts` — 内置系统工具（Read、Grep、Glob、Bash、Edit、WebSearch、WebFetch）
- `modelClient.ts` — DeepSeek API 调用
- `skillManager.ts` — Skill 管理（见下方）
- `types.ts` — 核心类型定义

### SkillManager（已实现）

`LocalSkillManager` 是完整的 skill 管理实现，被 `runAgentLoop.ts` 默认使用：

- **Skill 加载**：从 `<workspace>/skills/` 目录扫描 `SKILL.md` 文件，解析 frontmatter
- **Frontmatter 支持**：`name`、`description`、`whenToUse`、`allowedTools`、`paths`、`model`、`effort`、`context`、`shell`
- **条件 Skill 激活**：`paths` glob 匹配被触碰的文件路径时自动从 conditional 移入 active
- **Skill 发现预取**：`startSkillDiscoveryPrefetch` + `collectSkillDiscoveryPrefetch`
- **Skill 工具**：`Skill` tool（`registerSkillTool`）让模型按需加载 skill 内容
  - 参数替换：`$ARGUMENTS`、`$1`、`$ARGUMENTS[0]`、具名参数
  - 嵌入式 shell：`!command` 和 ` ```! ` 语法自动执行
  - Allowed Tools 限制：skill 可限制模型只能使用指定工具集（`skillAllowedToolNames`）
- **Prompt 注入**：加载的 skill 内容以 `skill.invoked.<name>` section 注入 system prompt

### Phase 1: Context Provider + Prompt Manager + Window Manager

- **ContextProvider**：加载 AGENTS.md / CLAUDE.md / CONTEXT.md、git status、task status
- **PromptManager**：结构化 system prompt（6 个 block）+ 工具元数据渲染
- **ContextWindowManager**：字符预算、per-tool 截断（16K 默认）、邻接保护

### Phase 2: Window Manager 增强

- 近似 token 估算（latin/4 + cjk*1.8）
- 优先级感知的 message grouping（system/latest_user 最高，orphan 最低）
- per-tool 差异化预算（Read/WebFetch 18K、Bash 12K、Glob 10K）
- metadata-bearing truncation（截断后保留 toolName/originalChars/keptChars/omittedChars）
- orphan tool 自动清理
- compaction candidates（为 Phase 3 LLM compact 预留接口）

---

## 新旧架构对比

| 维度 | 旧 Pipeline | 新 Agent Loop |
|------|------------|--------------|
| 执行模式 | 单轮 pipeline，每步独立 | 多轮 turn，模型中途决策 |
| LLM 调用次数 | 3+ 次（Planner+Router+Insight） | 1+ 次（每轮 1 次，通常 2-5 轮） |
| 上下文传递 | 通过数据库/队列，断裂 | 通过 conversation messages，连续 |
| 工具调用 | Executor 按 plan 执行 | 模型每轮决策调用哪些工具 |
| 错误恢复 | Blockage-Analyzer 分析后报错 | 模型根据 observation 自主决策重试/换工具 |
| 灵活性 | 低（plan 一旦生成不可变） | 高（每轮可调整策略） |
| 适用场景 | 简单、确定性任务 | 复杂、探索性任务 |

**共存策略**：旧 Pipeline 继续服务现有 capability（maritime、satellite、news 等），新增 capability（基于文件/代码的操作）优先接入 Agent Loop。未来逐步将旧 capability 迁移到 Agent Loop。

---

## 设计决策记录

### 决策 1: 为什么采用 Claude Code 风格的逐 turn 模式而非 LangChain 的 chain 模式？

**理由**：
- 项目需要处理复杂的代码/文件操作任务，需要模型根据中间结果动态调整策略
- Chain 模式适合预定义工作流，但不适合探索性任务
- Claude Code 的 turn-by-turn 模式在代码编辑、文件操作、搜索等场景已被验证有效

**权衡**：
- 每轮都有网络往返延迟，复杂任务可能需要 5-10 轮
- 需要 maxTurns 限制（默认 10）防止无限循环
- 需要 context window 治理防止历史消息膨胀

### 决策 2: 为什么 ContextProvider / PromptManager / ContextWindowManager 三层分离？

**理由**：
- 每层可独立测试、独立替换
- ContextProvider 未来可扩展（memory、skill discovery 等）
- PromptManager 未来可添加 provider-specific 适配（DeepSeek/OpenAI 格式差异）
- ContextWindowManager 未来可添加 LLM compact（Phase 3）

**权衡**：
- 增加了接口复杂度
- 数据在三层间传递有轻微性能开销（可忽略）

### 决策 3: 为什么工具 schema 由 model client 转换而非 prompt manager 渲染？

**理由**：
- DeepSeek/OpenAI 的 function calling 格式不同（JSON schema 细节差异）
- modelClient 直接持有 `ToolDefinition.inputSchema`（Zod type），转换更精确
- PromptManager 只渲染描述性元数据（name、description、readOnly、riskLevel），不渲染 schema 细节

---

## 已解决的债务（ADR-0002 → 当前）

| 债务 | ADR-0002 状态 | 当前状态 | 解决方式 |
|------|--------------|---------|---------|
| Planner/Router/Executor 职责混杂 | 存在 | **已重构** | 新 Agent Loop 统一在 `runAgentLoop.ts` 中调度 |
| Mock 与真实逻辑混编 | P2 | **已改善** | Agent Loop 直接调用 DeepSeek API，无 Mock 中间层 |
| Capability 手动注册 | P2 | **部分改善** | Agent Loop 的 ToolRegistry 支持动态注册，但业务 capability 仍需手动注册 |
| 缺乏 Agent 运行时抽象 | 无 | **已解决** | 完整的 Agent Loop 运行时框架 |

---

## 新增架构债务

| 优先级 | 债务 | 位置 | 说明 |
|--------|------|------|------|
| **P1** | MemoryManager 未实现 | `memoryManager.ts` | `noopMemoryManager`，无记忆召回/持久化 |
| **P1** | Transcript 未持久化 | `transcriptStore.ts` | `disabledTranscriptStore`，无数据库表 |
| **P2** | SkillManager 未配置 skill 目录 | `skills/` | 工作区根目录下无 `skills/` 目录，skill 功能无法实际触发 |
| **P2** | SkillManager 条件激活未与文件工具挂钩 | `skillManager.ts` | `discoverSkillDirsForPaths` / `activateConditionalSkillsForPaths` 未在 Read/Write/Edit 工具后调用 |
| **P2** | 旧 Pipeline 与 Agent Loop 共存 | `api/src/modules/planner/` `router/` `executor/` | 两套架构并行，维护成本增加 |
| **P2** | Agent Loop 测试覆盖不足 | `api/tests/` | 只有 context-provider 和 context-window-manager 测试，缺少端到端 smoke test |
| **P2** | ContextProvider Phase 2 未执行 | `contextProvider.ts` | 尚未实现 CONTEXT.md 递归加载、多路径合并等高级功能 |
| **P3** | Agent Loop 无版本控制 | `promptManager.ts` | system prompt 无版本号，无法 A/B 测试 |

---

## 可扩展性评估

### Agent Loop 横向扩展

| 组件 | 是否支持水平扩展 | 说明 |
|------|-----------------|------|
| `runAgentLoop` | 是 | 无状态，每个任务独立运行 |
| `ToolGateway` | 是 | 工具执行在任务上下文内，无副作用 |
| `ContextProvider` | 是 | 只读加载，无副作用 |
| `ContextWindowManager` | 是 | 纯计算，无副作用 |
| `ModelClient` | 是 | 外部 API 调用，天然可扩展 |

### 新增 Agent Loop Capability

当前接入 Agent Loop 的新 capability 需要：
1. 在 `api/src/modules/agent-loop/systemTools.ts` 中实现 `ToolDefinition`
2. 在 `buildDefaultToolRegistry()` 中注册
3. 前端无需改动（结果通过 SSE 推送）

**建议**：支持目录扫描自动注册（类似 `capabilities/` 目录扫描），减少 boilerplate。

---

## 总体评价

**合理性：7.5/10**（ADR-0002 为 6.5/10）

**优势**：
- Agent Loop 运行时框架设计正确，与 Claude Code 的成熟模式对齐
- 三层分离（Context/Prompt/Window）职责清晰，未来扩展点明确
- 工具注册/执行体系完善（权限、并发、去重、截断）
- 从单轮 pipeline 进化到多轮 agent，灵活性大幅提升
- Context Window Manager 的 Phase 2 增强（token 估算、优先级、per-tool 预算）设计细致

**劣势**：
- Memory/Transcript 两大组件仍是 noop，Agent Loop 的完整能力尚未释放；SkillManager 已实现但缺少实际 skill 目录配置
- 新旧架构并行，存在维护负担
- 端到端测试覆盖不足，缺乏 Agent Loop 的集成测试
- system prompt 无版本控制，难以追踪 prompt 变更对模型行为的影响

**MVP 阶段**：Agent Loop 框架已可运行基本任务（文件读取、搜索、编辑）。
**生产阶段**：必须实现 MemoryManager（跨任务记忆）、Transcript 持久化（故障恢复），配置 skill 目录使 SkillManager 生效，并逐步迁移旧 capability。

---

## 建议行动项

| 优先级 | 行动 | 参考文档 |
|--------|------|---------|
| P1 | 实现 MemoryManager（relevant memory prefetch + durable remember）| `api/src/todo.md` |
| P1 | 添加 agent_transcript_entries 数据库表 | `api/src/todo.md` |
| P2 | 配置 skill 目录并在工作区添加示例 skill | — |
| P2 | 将 skill 目录发现/条件激活挂钩到 Read/Write/Edit 工具 | — |
| P2 | 编写 Agent Loop 端到端 smoke test | `api/scripts/agent-loop-smoke.ts` |
| P2 | 评估旧 capability 向 Agent Loop 迁移的可行性 | - |
| P3 | 添加 system prompt 版本控制 | - |

---

## 相关文档

- [ADR-0001: 项目架构现状评审](./0001-architecture-review.md)
- [ADR-0002: 项目架构演进评审](./0002-architecture-review.md)
- [Context Provider & Window Manager Phase 1 Plan](../../api/plan/context-provider-window-manager-plan.md)
- [Context Window Phase 2 Plan](../../api/plan/context-window-phase2-plan.md)
- [Prompt / System Prompt Phase 1 Plan](../../api/plan/prompt-system-prompt-phase1-plan.md)
- [项目 README](../../README.md)
- [api/src/todo.md](../../api/src/todo.md)

---

## 未知项

1. **Agent Loop 的最大任务并发数** — 未测试多任务并行时的资源竞争（数据库连接、模型 API 限流）
2. **Context Window Manager 的字符预算是否适配实际模型** — 120K 字符预算是经验值，实际 token 限制需根据模型调整
3. **工具权限策略 `ask` 行为的交互路径** — 当前 `ask` 返回 `permission_required` observation，但前端尚无交互审批 UI
4. **MemoryManager 的存储后端选择** — 是否复用现有 PostgreSQL，还是引入专用向量数据库
