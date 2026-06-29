# ADR-0005: Agent Harness 能力差距与演进路线

- **日期**: 2026-06-23
- **状态**: Proposed
- **作者**: Codex
- **前序**:
  - [ADR-0003: Agent Loop 运行时架构评审](./0003-agent-loop-architecture.md)
  - [Agent Loop Migration Roadmap](../../api/plan/agent-loop-migration-roadmap.md)
- **参考材料**:
  - `S:\Projects\claude-code-analysis\analysis\04-agent-memory.md`
  - `S:\Projects\claude-code-analysis\analysis\04b-tool-call-implementation.md`
  - `S:\Projects\claude-code-analysis\analysis\04c-skills-implementation.md`
  - `S:\Projects\claude-code-analysis\analysis\04d-mcp-implementation.md`
  - `S:\Projects\claude-code-analysis\analysis\04e-sandbox-implementation.md`
  - `S:\Projects\claude-code-analysis\analysis\04f-context-management.md`
  - `S:\Projects\claude-code-analysis\analysis\04g-prompt-management.md`
  - `S:\Projects\claude-code-analysis\analysis\04h-multi-agent.md`
  - `S:\Projects\claude-code-analysis\analysis\04i-session-storage-resume.md`

---

## 背景

本项目已经从旧的 Planner / Router / Executor / Capability 栈，迁移到以 `api/src/modules/agent-loop/` 为核心的原生 Agent Loop 运行时。当前已经具备：

- 原生 Agent Loop SSE 事件；
- 前端 ChatPanel / RightPanel 对 native event 和 GIS output 的支持；
- JSONL 文件日志；
- DB transcript persistence；
- prompt versioning；
- task-scoped resume context；
- read-only session summary memory；
- `memory.recall_decision` prompt section；
- GIS / OpenSky / Weather / Disaster / Satellite / SQL / DailyReport / BorderDefenseQA 等工具纵切；
- 多个 fake / real smoke 与脚本测试。

因此，当前问题已经不是“Agent Loop 能不能跑”，而是：

> 这个工程距离一个优秀的 Agent Harness 还差哪些平台能力？后续应该以什么顺序补齐，才能支撑真实业务、专家评审、长期演进和故障复盘？

这里的 **Agent Harness** 指围绕模型调用和工具执行建立的一整套可控运行框架，不只是一个 prompt 或一个 tool registry。一个优秀 harness 应同时覆盖：

- prompt / context / memory 的构造与治理；
- tool call 的权限、安全、并发、回流；
- transcript / log / replay / resume；
- smoke / eval / regression；
- skill / MCP / domain tool extension；
- UI 可观测性与专家可解释性。

---

## 决策

本项目不应以“完整复刻 Claude Code”为目标，而应建设一个 **数智融合场景优先的 Agent Harness**。

短期目标：

1. 让每次前端真实 Agent Loop 都可审计、可复盘、可对比。
2. 让工具调用顺序、prompt 输入、memory 命中、GIS 输出、最终回答之间能建立可追踪关系。
3. 让真实数据纵切能力通过固定 smoke / eval 保持稳定。

中期目标：

1. 从“能记住最近任务”升级到“分作用域、可治理、可验证的 memory”。
2. 从“截断上下文”升级到“可压缩、可恢复、可重放的 context/session runtime”。
3. 从“工具函数集合”升级到“具备权限、沙箱、hook、UI、MCP 适配的 tool runtime”。

长期目标：

1. 支持多 agent / worker / verifier 的协同 harness。
2. 支持专家使用统一 trace 查看一次任务的 intent、context、tools、observations、GIS effects、final answer 和评分。
3. 支持领域能力包以 skill / tool / eval bundle 的形式持续扩展。

---

## 当前能力基线

### 1. Runtime

已具备：

- `runAgentLoopEvents()` 作为 AsyncGenerator 主循环；
- 每轮 `PromptManager -> ContextWindowManager -> ModelClient -> ToolGateway`；
- 工具调用批处理与 `isConcurrencySafe` 并发分组；
- `TodoWrite` 状态、skill listing、memory prefetch；
- `model_request` / `assistant_message` / `tool_message` / `loop_stop` transcript entries。

核心文件：

- `api/src/modules/agent-loop/runAgentLoop.ts`
- `api/src/modules/agent-loop/modelClient.ts`
- `api/src/modules/agent-loop/promptManager.ts`
- `api/src/modules/agent-loop/contextWindowManager.ts`

### 2. Tool Runtime

已具备：

- `ToolDefinition` 统一描述工具的 name、description、schema、risk、permission、并发、安全属性；
- `ToolRegistry` 统一注册 system/domain tools；
- `ToolGateway` 负责 schema 校验、validateInput、permission decision、execute、result budget；
- domain tools 已覆盖 GIS、weather、disaster、satellite、SQL、OpenSky 查询路径、日报、边防问答、油污 mock。

核心文件：

- `api/src/modules/agent-loop/tools/_shared/types.ts`
- `api/src/modules/agent-loop/tools/_shared/toolRegistry.ts`
- `api/src/modules/agent-loop/tools/_shared/toolGateway.ts`
- `api/src/modules/agent-loop/tools/domain/index.ts`

### 3. Prompt / Context / Memory

已具备：

- `ContextProvider` 加载 task / project / transcript resume context；
- `PromptManager` 统一渲染 system prompt、tool catalog、prompt sections；
- prompt component versioning；
- `ContextWindowManager` 做字符预算、tool message 截断、tool adjacency 保护；
- read-only session summary memory；
- `memory.diagnostics` 和 `memory.recall_decision`。

核心文件：

- `api/src/modules/agent-loop/contextProvider.ts`
- `api/src/modules/agent-loop/promptManager.ts`
- `api/src/modules/agent-loop/promptVersioning.ts`
- `api/src/modules/agent-loop/sessionSummaryMemoryManager.ts`
- `api/src/modules/agent-loop/memoryRecallDecision.ts`

### 4. Observability

已具备：

- `projects_new/logs/agent-loop-*.jsonl`；
- `agent_transcript_entries` DB 表；
- 前端 in-memory trace 与 Copy Trace；
- RightPanel native GIS output 联动地图；
- prompt metadata 进入 transcript；
- smoke 脚本可打印 raw event 和部分 scenario validation。

核心文件：

- `api/src/modules/agent-loop/fileLogger.ts`
- `api/src/modules/agent-loop/transcriptStore.ts`
- `src/lib/agentLoopEvents.ts`
- `src/components/info-center/TaskTrace.tsx`
- `api/scripts/agent-loop/agent-loop-smoke.ts`

---

## 与优秀 Harness 的主要差距

### 差距 1: Context Window 仍是“裁剪器”，不是完整 compact runtime

现状：

- `ContextWindowManager` 已能做预算、分组、截断和 compaction candidates；
- 但 `PreparedModelMessages.contextSections` 当前在 `runAgentLoop` 中仍是 reserved/future data；
- 没有 LLM compact、compact 失败熔断、post-compact state reinjection；
- 没有将已读文件、已加载 skill、memory、tool state 在 compact 后重建。

Claude Code 参考：

- `04f-context-management.md` 中的 Auto-Compact 会预留 summary budget；
- compact 有 Prompt Too Long fallback 和 failure circuit breaker；
- compact 后会重新注入文件、skills、memory 等状态。

影响：

- 长任务仍依赖“删除旧消息”而不是“压缩并保持连续性”；
- 模型可能丢失早期工具观察、区域解析结果、用户偏好或任务约束；
- 对复杂任务的稳定性上限较低。

建议：

1. 将 `context_window.diagnostics` 和 `context_window.compaction_candidates` 进入 transcript / JSONL；
2. 增加 `ContextCompactor` seam，先用 deterministic summarizer，后接 LLM compact；
3. compact 后重新注入 `task.progress`、`memory.recall_decision`、关键 GIS refs、recent observations；
4. 增加 compact smoke：构造长 tool result，验证 compact 后仍能正确回答。

### 差距 2: Transcript 已可持久化，但还不能完整 resume / replay

现状：

- DB transcript store 已经保存模型请求、assistant、tool、loop_stop；
- `transcript.resume_context` 只服务当前 task 的上下文摘要；
- JSONL log 适合人工排查；
- 但没有真正的 `/resume` 恢复流水线，也没有 deterministic replay harness。

Claude Code 参考：

- `04i-session-storage-resume.md` 采用 append-only JSONL；
- 写入层简单，恢复层负责修复 compact / snip / progress / parallel tool result；
- subagent sidechain transcript 与主链分离；
- resume 会恢复 metadata、mode、worktree、agent state、file history。

影响：

- 当前可以“看日志”，但不能“从日志恢复现场继续跑”；
- smoke 失败后不能一键 replay 同一 prompt/tool observation；
- 专家难以证明模型偏差来自 prompt、tool、memory 还是外部数据。

建议：

1. 定义 `AgentRunTrace` 规范，统一 DB transcript、JSONL、frontend trace 的语义字段；
2. 增加 `agent-loop replay` 脚本：从某个 JSONL/DB task 重建 model requests 和 observations；
3. 增加 `modelClient=recorded/replay` adapter，用 golden trace 做回归；
4. 后续再做真正 task resume：恢复 conversation messages、tool state、memory sections、skill sections。

### 差距 3: Memory 仍是 read-only recent-task recall，不是分层记忆系统

现状：

- `AGENT_MEMORY_SESSION_SUMMARY=1` 后，可召回同 user 最近完成任务；
- 召回内容是 transcript summary；
- `memory.recall_decision` 可提示模型是否优先从 memory 回答；
- 没有长期 memory 写入、typed memory、scope、索引、去重、过期治理。

Claude Code 参考：

- `04-agent-memory.md` 把 memory 分成 Auto Memory、Session Memory、Agent Memory、Team Memory；
- `MEMORY.md` 是索引，不是正文；
- relevant recall 先看 manifest/header，再选择最多 5 个 memory；
- `alreadySurfaced` 防止每轮重复注入；
- memory extraction 是后台受限 subagent，只能改指定 memory 文件。

影响：

- 当前 memory 更像“最近任务摘要”，不能沉淀用户偏好、项目经验、区域常识、工具 gotcha；
- 没有 memory review / forget / stale verification；
- 容易在长期使用后混淆“上次任务结果”和“可长期信任知识”。

建议：

1. 保留当前 session summary memory，不要混入长期 memory；
2. 增加 typed memory store：
   - `user_preference`
   - `project_knowledge`
   - `domain_region_knowledge`
   - `tool_gotcha`
   - `feedback`
3. 增加 memory manifest / index section，只把摘要和选择结果注入 prompt；
4. 增加 `alreadySurfacedMemoryIds`；
5. 增加 memory write gate：只在用户明确要求记住、或任务结束后符合抽取阈值时写；
6. 增加 Memory UI/trace：显示本轮召回了什么、为什么召回、是否用于回答。

### 差距 4: Tool runtime 有统一协议，但权限、sandbox、hook 仍偏 MVP

现状：

- `ToolDefinition` 已有 `isReadOnly`、`isDestructive`、`riskLevel`、`requiresUserInteraction`、`checkPermissions`；
- `Bash` 有命令 deny list、workspace cwd、timeout、restricted env；
- `ToolGateway` 有统一 permission decision 和 result budget；
- 但没有系统级 sandbox runtime，没有规则 UI，没有 pre/post tool hooks，没有工具级显示协议。

Claude Code 参考：

- `04b-tool-call-implementation.md` 中 Tool 是完整运行时协议对象：输入输出、权限、UI、并发、中断、render；
- `04e-sandbox-implementation.md` 中 sandbox 是 Bash 执行链路的一部分，不是标记字段；
- permission system 与 sandbox runtime 相互配合，含 ask/deny/allow/session rules。

影响：

- 现在适合服务端受控工具，不适合开放给大量外部工具或高风险写操作；
- Bash 的“portable sandbox”主要是应用层限制，不是 OS 隔离；
- 缺少 tool hook 后，难以统一做审计、脱敏、数据血缘、速率限制、成本统计。

建议：

1. 增加 `ToolRuntimePolicy` module，集中管理 allow/ask/deny/sandbox；
2. 增加 pre-tool / post-tool hook seam：
   - audit
   - redact
   - rate limit
   - provenance
   - eval capture
3. 将 Bash sandbox 明确分为：
   - `portable-policy`
   - `os-sandbox`
   - `disabled`
4. 写入型工具统一要求 permission handler 或服务端白名单；
5. 为 tool observation 增加标准 metadata：durationMs、inputHash、outputHash、source、cost、dataFreshness。

### 差距 5: Prompt 可版本化，但还缺 prompt inspection / dump / diff 工作台

现状：

- `model_request.metadata.prompt` 已记录 prompt version、component version、tool/context/memory/skill section hash；
- JSONL 和 transcript 可以回看请求；
- 但缺少一键导出“本轮模型到底看到了什么”的工作台；
- prompt diff 仍要人工从日志里拼。

Claude Code 参考：

- `04g-prompt-management.md` 提到 prompt 是动态层叠系统；
- `dump-prompts` / `/context` 能观察 system sections token 与实际请求。

影响：

- 专家沟通时难以快速定位“模型是不是看到了 memory / tool / rule”；
- prompt 变更后的行为差异缺乏一键对比；
- smoke 失败时还要人工翻 JSONL。

建议：

1. 增加 `agent-loop inspect-prompt --task <id> --turn <n>`；
2. 输出：
   - system prompt sections；
   - tool catalog；
   - memory / skill / runtime sections；
   - raw vs prepared messages；
   - prompt metadata hash；
3. 增加 prompt diff：比较两个 task/turn 的 prompt surface；
4. 前端 TaskTrace 增加“查看模型输入摘要”入口，不直接展示敏感全文，默认展示 section ids / hashes / previews。

### 差距 6: Smoke 已不少，但还不是系统化 eval harness

现状：

- `api/scripts/agent-loop/agent-loop-smoke.ts` 支持多个 scenario；
- fake model 可验证 GIS、日报、边防问答、油污 mock；
- real model 可跑真实工具；
- 单测覆盖 prompt、memory、transcript、projection、stream router；
- 但缺少统一 eval registry、golden trace、评分维度和 CI 分层。

优秀 harness 应具备：

- deterministic unit tests；
- fake-model smoke；
- real-tool fake-model smoke；
- real-model real-tool smoke；
- replay regression；
- semantic evaluator；
- prompt/tool/memory ablation；
- failure triage report。

影响：

- 目前能证明“这次跑通了”，但难以长期证明“关键语义没退化”；
- 外部数据变化会让 real smoke 难以解释；
- 对模型行为偏差缺少固定评分面。

建议：

1. 建立 `api/evals/agent-loop/`：
   - `cases/*.json`
   - `expectations/*.ts`
   - `fixtures/*.jsonl`
2. 每个 case 定义：
   - query；
   - tools allowed；
   - expected tool order；
   - required observations；
   - forbidden behavior；
   - answer rubric；
3. 将现有 smoke scenario 收编为 eval cases；
4. 增加 `--record` / `--replay`；
5. 将日志分析脚本标准化，输出 markdown report。

### 差距 7: Skills 已接入，但还不是完整扩展生态

现状：

- `LocalSkillManager` 支持 `SKILL.md`、frontmatter、allowedTools、paths、inline/fork 字段、嵌入 shell、条件激活；
- `Skill` tool 能加载 skill 内容；
- 油污 mock 等能力已经通过 skill 可见性测试；
- 但当前 skill 来源单一，缺少 trust/source 分层、版本治理、UI 管理、安装/禁用策略。

Claude Code 参考：

- `04c-skills-implementation.md` 中 skills 来源包括 user / managed / project / bundled / MCP；
- skill discovery 有 realpath 去重、memoize、bare mode；
- embedded shell 只对受信任来源执行；
- skills 与 agent memory / tool permissions 联动。

影响：

- 领域专家很难以“能力包”的方式贡献工具、prompt、eval；
- skill 的安全模型还不够明确；
- 缺少 skill version 与 smoke/eval 绑定关系。

建议：

1. 定义 Domain Skill Bundle：
   - `SKILL.md`
   - tool registrations
   - prompt rules
   - eval cases
   - data requirements
2. 增加 skill source：
   - project
   - user
   - managed
   - bundled
3. 对 embedded shell 增加 trust gate；
4. skill listing 中加入 version/source/trust/allowedTools；
5. 专家沟通时按 bundle 讨论能力，而不是散落讨论 prompt 和 tool。

### 差距 8: 缺少 MCP / 外部工具协议层

现状：

- 当前工具主要是内建 system/domain tools；
- 没有 MCP client、server registry、外部工具命名规范、认证状态、连接健康检查；
- SQL / Web / PostGIS 等是手写工具，不是协议插件。

Claude Code 参考：

- `04d-mcp-implementation.md` 中 MCP 工具统一命名为 `mcp__server__tool`；
- 支持 stdio / SSE / ws / HTTP；
- 有连接 memoize、超时、认证缓存、描述截断、并发连接控制。

影响：

- 后续接入遥感、海事、企业数据库、知识库、Browser、文档等外部工具时，会继续手写 adapter；
- 工具权限、命名冲突、认证失败、描述过长会分散处理。

建议：

1. 暂不急于完整 MCP；
2. 先抽象 `ExternalToolProvider` seam；
3. 约定外部工具命名、description budget、schema budget、auth diagnostics；
4. 第二阶段再接 MCP client；
5. 把外部工具也纳入 tool catalog hash 和 eval harness。

### 差距 9: 还没有多 agent / verifier harness

现状：

- 当前主路径是单 agent loop；
- Codex 桌面环境本身支持 sub-agent，但项目内 runtime 没有 AgentTool；
- 没有 coordinator / worker / verifier 模式；
- 没有 sidechain transcript。

Claude Code 参考：

- `04h-multi-agent.md` 中存在普通 subagent、coordinator-workers、swarm teammates；
- 多 agent 不是简单后台任务，而包含 mailbox、permission bridge、task list、sidechain transcript。

影响：

- 对复杂 GIS/灾害/海事分析，主 agent 需要同时做检索、工具调用、校验和总结；
- 缺少独立 verifier，最终回答偏差只能靠人工看日志；
- 长链路任务无法拆给专门 worker。

建议：

1. 不把 multi-agent 作为近期 P0；
2. 先实现 `VerifierTool` / `CriticPass`，对最终答案与 observations 做一致性检查；
3. 后续再做只读 worker：
   - Research worker
   - GIS verifier
   - Data freshness verifier
4. 每个 worker 必须有 sidechain transcript，不能混写主 transcript。

### 差距 10: 缺少统一领域词汇与 harness 文档入口

现状：

- `AGENTS.md` 提到仓库应有 `CONTEXT.md`，但当前根目录没有该文件；
- ADR 和 `api/plan` 已经很多，但缺少统一索引说明“Agent Harness 当前有哪些 module / seam / adapter”；
- 术语仍在 legacy / projection / capability / skill / tool / pipeline 之间摇摆。

影响：

- 专家沟通成本高；
- 后续智能体接手时容易重复争论旧 pipeline 与新 projection；
- 新能力不知道应该落在 tool、skill、context、memory 还是 dashboard projection。

建议：

1. 新增根目录 `CONTEXT.md`；
2. 定义项目内 harness 术语：
   - Agent Loop
   - Tool
   - Domain Tool
   - Skill
   - Memory
   - Transcript
   - Dashboard Projection
   - Eval Case
3. 新增 `docs/agents/harness.md` 作为开发入口；
4. ADR 只记录长期决策，`api/plan` 记录执行计划。

---

## 优先级路线

### Phase 1: Trace / Prompt / Eval Harness 收口

目标：

- 让每次任务都可解释、可对比、可回归。

建议任务：

1. 定义 `AgentRunTrace` 标准结构；
2. 实现 `inspect-prompt`；
3. 实现 `replay` 的最小版本；
4. 将现有 smoke 收编进 `api/evals/agent-loop`；
5. 每个 eval case 输出 markdown report；
6. 前端 TaskTrace 增加 prompt/memory/tool summary 面板。

验收标准：

- 任意一个 taskId 可以导出“模型输入摘要 + 工具轨迹 + memory 命中 + final answer”；
- fake-model smoke 可以作为 CI 快速回归；
- real-model smoke 可以生成专家可读报告。

### Phase 2: Context Compact / Resume Runtime

目标：

- 长任务不再靠简单裁剪历史维持运行。

建议任务：

1. `ContextWindowManager.contextSections` 进入 transcript/log；
2. 新增 `ContextCompactor`；
3. deterministic compact MVP；
4. LLM compact；
5. compact failure circuit breaker；
6. post-compact state reinjection；
7. task resume MVP。

验收标准：

- 构造超长工具输出后，系统能 compact 并继续正确调用后续工具；
- resume 后不会丢失关键 task / GIS / memory state。

### Phase 3: Memory V2

目标：

- 从 recent task recall 升级到可治理的长期记忆。

建议任务：

1. typed memory schema；
2. memory manifest / index；
3. relevance selector；
4. already surfaced dedupe；
5. memory write gate；
6. memory review / forget；
7. memory diagnostics UI。

验收标准：

- 用户偏好、工具经验、区域知识不会混进 task transcript；
- 每次 memory 使用都能解释“召回了什么、为什么、是否用于回答”；
- 当前/实时类问题不会错误使用 stale memory。

### Phase 4: Tool Runtime Hardening

目标：

- 让工具从“可调用函数”升级为可治理执行协议。

建议任务：

1. `ToolRuntimePolicy`；
2. pre/post hook；
3. duration / cost / provenance metadata；
4. result schema / output schema；
5. Bash sandbox 分层；
6. permission UI / server-side allowlist；
7. tool error taxonomy。

验收标准：

- 新增工具必须声明风险、并发、输出预算、数据来源；
- 高风险工具必须被权限系统捕获；
- 所有 tool observation 都有可审计元数据。

### Phase 5: Skill Bundle / External Tool Provider

目标：

- 让领域能力以 bundle 形式扩展，而不是散落在 prompt 和代码里。

建议任务：

1. Domain Skill Bundle 规范；
2. skill source/trust/version；
3. skill eval binding；
4. external tool provider seam；
5. MCP client spike；
6. MCP tool catalog budget / auth diagnostics。

验收标准：

- 新增一个领域能力时，同时包含 tool、skill、prompt rule、eval case；
- 外部工具不会绕过权限、prompt versioning、trace。

### Phase 6: Verifier / Multi-Agent

目标：

- 复杂任务进入“执行 + 校验”双轨，而不是单 agent 自我确认。

建议任务：

1. final-answer verifier；
2. observation-answer consistency checker；
3. GIS output verifier；
4. sidechain transcript；
5. read-only research worker；
6. coordinator MVP。

验收标准：

- 重要任务输出前至少经过一次 observation-grounded verification；
- verifier 的结论进入 trace；
- worker 不污染主 transcript。

---

## 建议先做什么

推荐顺序：

```text
1. AgentRunTrace 标准
2. inspect-prompt + replay MVP
3. eval case registry
4. Context compact MVP
5. Memory V2
6. Tool runtime hardening
7. Skill bundle
8. External tool provider / MCP
9. Verifier / multi-agent
```

理由：

- Trace / prompt / replay 是所有后续讨论的地基；
- 没有 eval harness，memory、compact、tool hardening 的收益难以衡量；
- 没有 compact/resume，长任务和真实业务链路会持续受上下文窗口限制；
- Memory V2 要在 trace/eval 稳定后做，否则很难判断“记忆帮了忙”还是“污染了回答”；
- Multi-agent 最后做，因为它会放大前面所有治理问题。

---

## 非目标

近期不建议做：

1. 完整复刻 Claude Code 的 swarm / teammate；
2. 直接把所有外部工具迁到 MCP；
3. 默认开启长期自动记忆写入；
4. 用 UI 大改替代 trace/eval 基建；
5. 为每个 domain tool 单独写一套不可复用的日志和评测。

---

## 专家沟通问题清单

和智能体专家沟通时，建议围绕这些问题收敛：

1. 对本项目而言，Agent Harness 的最低可接受审计粒度是什么？
2. `AgentRunTrace` 应以 DB transcript 为主，还是 JSONL 为主？
3. eval 应优先覆盖工具顺序、最终答案，还是 GIS/数据联动效果？
4. Memory V2 是否需要文件化索引，还是继续用 DB 表？
5. 对实时数据问题，memory 的 stale policy 应如何表达？
6. Bash / SQL / 外部工具的 permission policy 应该在服务端、前端还是两者共同执行？
7. 是否需要引入 MCP，还是先定义项目自己的 ExternalToolProvider？
8. verifier 应作为工具、独立模型调用，还是 sidechain agent？
9. 哪些领域能力应该成为 Skill Bundle，哪些应该只是普通工具？
10. 是否需要为专家提供独立的 trace viewer，而不是复用当前 TaskTrace？

---

## 结论

本项目已经完成了从旧 pipeline 到 native Agent Loop 的关键迁移，具备真实工具、真实数据、前端联动、日志、transcript、prompt versioning 和 memory MVP。

和优秀 Agent Harness 相比，主要差距不是“缺更多工具”，而是缺少以下平台能力：

- 完整 trace / replay / eval；
- compact / resume；
- 分层 memory；
- 更强 tool governance；
- skill bundle 与外部工具协议；
- verifier / multi-agent。

下一阶段最值得投入的是 **Trace / Prompt / Eval Harness 收口**。这会让后续所有智能体能力都能被测量、讨论和复盘，是从“能跑的 agent loop”走向“可长期维护的 agent platform”的关键一步。
