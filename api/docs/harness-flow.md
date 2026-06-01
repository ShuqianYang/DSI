# Agent Harness 流程文档

> 最后更新：2026-05-29
>
> 本文档描述 Agent Harness（Phase 0.5）的完整请求处理流程，包括 Skill/Template 零 LLM 执行、Agent Loop 多步推理、以及新旧 Pipeline 回退机制。

---

## 一、总览架构

```
用户 Query
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  Harness Pipeline (runHarnessPipeline)                      │
│  文件：src/modules/harness/runAgentPipeline.ts              │
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

---

## 二、环境开关

```bash
# api/.env
AGENT_HARNESS_ENABLED=true    # 启用 harness 路径
AGENT_HARNESS_ENABLED=false   # 直接走旧 Pipeline（默认）

DEEPSEEK_API_KEY=sk-xxx       # 启用 LLM 驱动（Agent Loop + Finalizer）
```

| 配置组合 | Skill/Template 执行 | 最终回复生成 |
|---------|:------------------:|:-----------:|
| `HARNESS=true` + `无 DEEPSEEK` | 零 LLM 直接执行 | `buildFinalAnswer` 硬编码拼接 |
| `HARNESS=true` + `有 DEEPSEEK` | 零 LLM 直接执行 | `generateLlmFinalAnswer` LLM 理解生成 |
| `HARNESS=false` | 不适用 | 旧 Pipeline Planner/Router/Executor |

---

## 三、三层路由详解

### 3.1 第一层：Template Matcher（关键词匹配）

**文件**：`src/modules/harness/templateMatcher.ts`

```
用户 Query
    │
    ▼
遍历所有已注册 routable（skill + template）
    │
    ├── 对每个 routable 的 keywords 做子串匹配
    │   └── 计算置信度 = 匹配率×0.5 + 数量奖励 + priority加成 - avoidWhen惩罚
    │
    └── 按置信度排序，取最高分决定 tier
         │
         ├── high (≥0.75)   → executeDirectly()
         │
         ├── medium (0.45~0.75) → runAgentLoop(enhancedQuery)
         │
         └── low (<0.45)    → runAgentLoop(query)
```

**已注册 routable**：

| ID | 类型 | 工具 | 关键词示例 |
|----|------|------|-----------|
| `weather.simple_query` | skill | weather.fetch | 天气、气温、东京、北京、下雨 |
| `news.summary_template` | template | news.search → finalizer | 新闻、灾害、舆情、报道 |

### 3.2 第二层：Direct Execution（高置信度，零 LLM）

**文件**：`src/modules/harness/runnableRunner.ts`

```
executeDirectly()
    │
    ▼
convertToRunnable(skill/template)
    │
    ▼
runDeterministicRunnable()
    │
    ├── 创建 runtimeState
    │
    ├── 遍历 steps：
    │   ├── buildParams(state)      ← 从 state 提取参数
    │   ├── validateToolCall()      ← 校验参数
    │   ├── executeTool()           ← 调用工具
    │   │   └── System Tool 分支：time.now / calc.evaluate / web.fetch / finalizer
    │   │   └── Legacy Tool 分支：通过 actionsService.execute() 调用
    │   └── pushObservation()       ← 结果回写 state
    │
    └── 所有步骤完成后：
        ├── generateLlmFinalAnswer()  ← DEEPSEEK 配置时：LLM 理解结果生成回答
        └── buildFinalAnswer()        ← 无 DEEPSEEK 时：硬编码拼接 message
```

**关键设计**：步骤间通过 `state.artifacts` 传递数据（Step 1 的 `saveAs` → Step 2 的 `buildParams` 读取）。

### 3.3 第三层：Open Agent Loop（中/低置信度，LLM 驱动）

**文件**：`src/modules/harness/runOpenAgentLoop.ts`

```
runOpenAgentLoop()
    │
    ├── 循环开始
    │   │
    │   ├── retrieveCandidateTools()   ← 根据 query + observations 检索候选
    │   │                                打分：query 命中 whenToUse +2/词
    │   │                                排除：已使用工具、sideEffect=write
    │   │
    │   ├── filtered.length === 0 ?
    │   │   ├── 有 observations → makeAgentDecision() 让 LLM 判断是否可以 final_answer
    │   │   └── 无 observations → 返回"当前没有可用工具..."
    │   │
    │   ├── makeAgentDecision()        ← 调用 DeepSeek LLM（或 rule-based fallback）
    │   │   ├── tool_call   → 校验 → 执行 → observation 回写 → 继续循环
    │   │   ├── final_answer → 直接返回
    │   │   ├── legacy_fallback → 回退旧 Pipeline
    │   │   └── create_requirement → 结束
    │   │
    │   └── 防重复：hasUsedTool() 拦截相同工具+相同参数
    │
    └── maxSteps 限制（默认 3 步）
```

**makeAgentDecision 逻辑**：

```
makeAgentDecision(query, observations, candidates)
    │
    ├── 复杂查询拦截（checkComplexQuery）
    │   └── "东海海域态势" → legacy_fallback（节省 token）
    │
    ├── !DEEPSEEK_API_KEY ?
    │   └── ruleBasedDecision() 规则决策
    │       ├── 无 observation + 天气关键词 → weather.fetch
    │       ├── 无 observation + 新闻关键词 → news.search
    │       ├── 有 news + 有 weather → final_answer（综合）
    │       └── 默认 → news.search
    │
    └── 有 DEEPSEEK_API_KEY → callDeepSeek()
        ├── buildAgentMessages() 构建 system + user prompt
        ├── JSON 模式解析 LLM 返回的决策
        └── validateDecision() 校验工具合法性
```

---

## 四、新旧 Pipeline 边界

### 4.1 Harness 成功路径

```
runHarnessPipeline(taskId, body)
    │
    ├── 返回 skill_executed / template_executed / agent_completed
    │
    └── pipeline.ts 保存结果：
        ├── task.status = "completed"
        ├── task.result.finalText = LLM 回复
        └── task.result.observations = 工具执行记录
```

### 4.2 Harness 回退路径

```
runHarnessPipeline(taskId, body)
    │
    ├── 返回 legacy_fallback
    │
    └── pipeline.ts 调用旧 Pipeline：
        ├── plannerService.generatePlan()      ← Dify Planner
        ├── routerService.decideActions()      ← Dify Router
        ├── executorService.run()              ← 执行工具
        │   └── 每步 5-10s demo 延迟
        └── 写入 events 表（供前端展示）
```

**回退触发条件**：
- `checkComplexQuery()` 拦截：东海海域态势、火情研判、洪涝评估等
- Agent Loop 3 步内无法完成
- LLM 主动返回 `legacy_fallback` 决策

---

## 五、数据流与状态传递

### 5.1 Skill 单步执行

```
weatherSimpleSkill (weather.simple_query)
    │
    ├── buildParams(query) → { location: "东京", date: "today" }
    │
    ├── executeTool("weather.fetch", params)
    │   └── actionsService.execute() → weather-fetch capability
    │       └── 返回 { windSpeed, windDirection, description, ... }
    │
    ├── observation 回写 state
    │
    └── generateLlmFinalAnswer(query, observations)
        └── DeepSeek 生成："抱歉，我目前无法获取到东京今天的具体天气信息..."
```

### 5.2 Template 多步执行

```
newsSummaryTemplate (news.summary_template)
    │
    ├── Step 1: news.search
    │   ├── buildParams(state) → { query: state.userQuery, timeRange: "7d" }
    │   ├── executeTool("news.search")
    │   └── saveAs: "news.search.results" → state.artifacts
    │
    └── Step 2: finalizer.template_summary
        ├── buildParams(state) → { items: state.artifacts["news.search.results"] }
        ├── executeTool("finalizer.template_summary")
        │   └── generateTemplateSummary() → 本地零 LLM 生成摘要
        └── generateLlmFinalAnswer() → DeepSeek 生成完整回答
```

### 5.3 Agent Loop 多步执行

```
用户："最近日本有没有灾害事件，会不会影响出行？"
    │
    ├── 第一轮：retrieveCandidateTools → news.search (高分)
    │   ├── makeAgentDecision → tool_call (news.search)
    │   └── 执行 news.search → observation 写入 state
    │
    ├── 第二轮：retrieveCandidateTools → news.search 已使用，filtered = []
    │   ├── 有 observations → makeAgentDecision → final_answer
    │   └── LLM 生成："最近日本确实发生了多起自然灾害事件...建议你密切关注最新动态"
    │
    └── 返回 finalText
```

---

## 六、关键文件索引

| 文件 | 职责 |
|------|------|
| `src/modules/harness/runAgentPipeline.ts` | Harness 总入口，三档路由 |
| `src/modules/harness/templateMatcher.ts` | 关键词匹配，置信度计算 |
| `src/modules/harness/runnableRunner.ts` | Skill/Template 确定性执行 + LLM Finalizer |
| `src/modules/harness/runOpenAgentLoop.ts` | Open Agent Loop，多轮推理 |
| `src/modules/harness/agentDecision.ts` | LLM 决策（DeepSeek）+ rule-based fallback |
| `src/modules/harness/llmClient.ts` | DeepSeek API 客户端 |
| `src/modules/harness/toolGateway.ts` | 工具执行网关（System Tool + Legacy Tool） |
| `src/modules/harness/runtimeState.ts` | 运行时状态（observations、usedTools、artifacts） |
| `src/modules/harness/retrieveCandidateTools.ts` | 候选工具检索（关键词打分） |
| `src/modules/tasks/pipeline.ts` | 新旧 Pipeline 切换（AGENT_HARNESS_ENABLED） |

---

## 七、已知边界问题

1. **web.fetch 与旧 Executor 冲突**：harness 执行 web.fetch 成功，但 taskSteps 写入的 actionType 是 `web.fetch`，旧 Executor 不认识该 type（只认识 `weather-fetch`、`news` 等 legacy type），导致步骤标记为 failed。

2. **weather.fetch 数据不完整**：normalizeOutput 中 message 字段 fallback 到"气象数据获取完成"，实际 windSpeed/windDirection 等数据存在但未被 LLM finalizer 充分利用。

3. **Template 高置信度拦截 Agent Loop**："最近日本有没有灾害事件"同时命中 news.summary_template（高置信度），直接走 Template 路径而非 Agent Loop 的多步推理路径。
