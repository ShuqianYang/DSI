# 四、Harness 现状

## 4.1 什么是 Harness

Harness 是项目设计文档中描述的 **Agent 请求处理框架**，目标是在进入 LLM 驱动的 Agent Loop 之前，先通过关键词匹配等方式进行快速路由：

- 高置信度查询 → 直接执行 Skill/Template（零 LLM）
- 中置信度查询 → Agent Loop + 候选提示
- 低置信度查询 → Open Agent Loop（自由探索）
- 失败时 → 回退旧 Pipeline（Planner → Router → Executor）

## 4.2 Harness 设计文档

设计文档位于：`api/docs/harness-flow.md`

文档中描述的架构：

```
用户 Query
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  Harness Pipeline (runHarnessPipeline)                      │
├─────────────────────────────────────────────────────────────┤
│  1. templateMatcher 关键词匹配                              │
│     └─ 高置信度 (≥0.75)  → 直接执行 Skill/Template (零 LLM) │
│     └─ 中置信度 (0.45~0.75) → Agent Loop + 候选提示        │
│     └─ 低置信度 (<0.45)    → Open Agent Loop (自由探索)    │
│                                                             │
│  2. 如果 Agent Loop 返回 legacy_fallback                   │
│     └─ 回退旧 Pipeline (Planner → Router → Executor)       │
└─────────────────────────────────────────────────────────────┘
```

## 4.3 设计中的环境开关

```bash
# api/.env
AGENT_HARNESS_ENABLED=true    # 启用 harness 路径
AGENT_HARNESS_ENABLED=false   # 直接走旧 Pipeline（默认）

DEEPSEEK_API_KEY=sk-xxx       # 启用 LLM 驱动
```

| 配置组合 | Skill/Template 执行 | 最终回复生成 |
|---------|:------------------:|:-----------:|
| `HARNESS=true` + 无 `DEEPSEEK` | 零 LLM 直接执行 | `buildFinalAnswer` 硬编码拼接 |
| `HARNESS=true` + 有 `DEEPSEEK` | 零 LLM 直接执行 | `generateLlmFinalAnswer` LLM 生成 |
| `HARNESS=false` | 不适用 | 旧 Pipeline Planner/Router/Executor |

## 4.4 设计中的三层路由

### 第一层：Template Matcher

- 遍历所有已注册 routable（skill + template）
- 对每个 routable 的 keywords 做子串匹配
- 计算置信度 = 匹配率×0.5 + 数量奖励 + priority 加成 - avoidWhen 惩罚
- 按置信度分三档：high / medium / low

### 第二层：Direct Execution（高置信度）

- 将 skill/template 转换为 runnable
- 确定性执行每一步：
  - `buildParams(state)`
  - `validateToolCall()`
  - `executeTool()`
  - `pushObservation(state)`
- 最后由 LLM 生成最终回复（或硬编码拼接）

### 第三层：Open Agent Loop（中/低置信度）

- 根据 query + observations 检索候选工具
- 调用 `makeAgentDecision()` 让 LLM 判断下一步
- 支持 `tool_call` / `final_answer` / `legacy_fallback` / `create_requirement`
- 默认最多 3 步

## 4.5 当前实现状态：仅停留在文档阶段

**关键结论：Harness 代码未实现。**

文档中引用的以下文件全部不存在：

| 文档引用文件 | 实际存在 |
|-------------|---------|
| `src/modules/harness/runAgentPipeline.ts` | ❌ 不存在 |
| `src/modules/harness/templateMatcher.ts` | ❌ 不存在 |
| `src/modules/harness/runnableRunner.ts` | ❌ 不存在 |
| `src/modules/harness/runOpenAgentLoop.ts` | ❌ 不存在 |
| `src/modules/harness/agentDecision.ts` | ❌ 不存在 |
| `src/modules/harness/llmClient.ts` | ❌ 不存在 |
| `src/modules/harness/toolGateway.ts` | ❌ 不存在 |
| `src/modules/harness/runtimeState.ts` | ❌ 不存在 |
| `src/modules/harness/retrieveCandidateTools.ts` | ❌ 不存在 |

当前真实的任务 Pipeline 直接调用 `runAgentLoop`：

```ts
// api/src/modules/tasks/pipeline.ts
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

## 4.6 如果未来要实现 Harness

建议从以下模块开始：

1. `api/src/modules/harness/runAgentPipeline.ts` — Harness 总入口，三档路由
2. `api/src/modules/harness/templateMatcher.ts` — 关键词匹配与置信度计算
3. `api/src/modules/harness/runnableRunner.ts` — Skill/Template 确定性执行
4. `api/src/modules/harness/runOpenAgentLoop.ts` — Open Agent Loop
5. `api/src/modules/harness/agentDecision.ts` — LLM 决策 + rule-based fallback
6. `api/src/modules/harness/runtimeState.ts` — 运行时状态管理
7. `api/src/modules/harness/retrieveCandidateTools.ts` — 候选工具检索

然后在 `api/src/modules/tasks/pipeline.ts` 中根据 `AGENT_HARNESS_ENABLED` 开关选择路由：

```ts
if (process.env.AGENT_HARNESS_ENABLED === "true") {
  return runHarnessPipeline(taskId, body);
}
return runAgentPipelineDirect(taskId, body);
```
