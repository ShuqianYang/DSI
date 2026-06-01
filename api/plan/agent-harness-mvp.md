# Agent Harness 最小验证计划

## 背景

当前架构 Planner → Router → Executor 存在信息断层，工具注册分散在四处（Planner prompt、Router prompt、validateActionParams、validateActionCase）。目标是用 Template-first Agent Harness 替代，实现：

- Template / Skill 内零 LLM 执行
- 工具注册统一从 CapabilityContract 驱动
- 新旧数据格式兼容
- 边界/失败/开放 query 走 Observation-driven Agent Loop

## 决策共识

| # | 决策项 | 结论 |
|---|---|---|
| 1 | 痛点根因 | Planner/Router 信息断层 + 工具注册分散 |
| 2 | 架构方向 | Template-first + Skill-matcher + Observation-driven Agent Harness |
| 3 | 硬编码场景 | 保留为 template，验证后逐步 workflowTemplate 化 |
| 4 | LLM 调用 | Template / Skill 内零 LLM，未命中时进入 Agent Loop |
| 5 | 数据层 | taskSteps = 执行日志 + checkpoint，Redis = 运行时 state |
| 6 | 工具 Schema | Zod runtime schema + CapabilityContract |
| 7 | 工具检索 | Observation-driven top-k retrieval，不全量暴露 |
| 8 | 最小验证工具 | news.search + weather.fetch + requirement.evaluate_mock + final_answer |

## 命名规范

**Canonical tool name 统一用点分命名**：

| 旧名 | 新 canonical name |
|---|---|
| weather-fetch | `weather.fetch` |
| news | `news.search` |
| requirement | `requirement.evaluate` |
| oil-drift | `oil_drift.traceback` |
| ais-fetch | `ais.fetch` |
| ais-match-suspects | `ais.match_suspects` |
| ais-suspect-ranking | `ais.rank_suspects` |
| satellite | `satellite.query` |
| fire-detector | `fire.detect` |
| region-mark | `gis.mark_region` |

文件名保持现有风格（如 `weather-fetch.ts`），但 registry、contract、tool_call、taskSteps、SSE、日志全部使用点分命名。

## Template vs Skill

| 类型 | 定义 | 例子 |
|---|---|---|
| **Template** | 多步确定性流程，步骤间有固定依赖关系 | `fire.investigation`（4 步）、`oil_spill.traceback`（7 步）、`flood.assessment`（5 步） |
| **Skill** | 单步确定性能力处理器，命中后直接执行 | `weather.simple_query`、`region.resolve`、`news.quick_search` |

两者都走 `templateMatcher.ts`，命中后代码执行，内部零 LLM。没命中才进入 Agent Loop。

## 总体架构

```
用户请求
→ templateMatcher / skillMatcher
→ 高置信度命中：直接执行（template 或 skill），内部零 LLM
→ 没命中：进入 Open Agent Loop
  → retrieveCandidateTools：根据 query + observations 检索 top-k 候选工具
  → agentDecision：输出 tool_call / final_answer / create_requirement / legacy_fallback
  → toolGateway：执行 tool
  → observation 回写到 runtime state
  → Agent 再判断下一步
→ loop 结束：final_answer / create_requirement / legacy_fallback / maxSteps / 重复调用 / 不可恢复错误
```

## Phase 0: Single-step Tool Loop（已完成）

已验证：一个 capability 能被 contract 定义、被 toolValidator 校验、被 Executor 执行、结果回写。

## Phase 0.5: Observation-driven Agent Loop

**目标**：验证 Agent 能根据 observation 决定下一步 tool，而不是一次性看到全部工具后乱选。

**范围**：
- 不碰复杂 template
- 不迁移 fire/flood/earthquake
- 只验证 Agent 能根据 observation 继续决策
- 只接入 `news.search`、`weather.fetch`、`requirement.evaluate_mock`、`final_answer`

**跑一个例子**：

```
用户问：最近日本有没有灾害事件，会不会影响出行？

Step 1 (Agent):
  retrieveCandidateTools(query="最近日本有没有灾害事件")
  → top-k: [news.search, weather.fetch]
  agentDecision → tool_call: news.search({ query: "日本 灾害" })

Step 2 (Gateway 执行):
  news.search 返回 observation:
    "日本某地遭遇暴雨，部分道路中断，新干线延误"

Step 3 (Agent):
  retrieveCandidateTools(query + observation="暴雨...道路中断")
  → top-k: [weather.fetch, final_answer, requirement.evaluate_mock]
  agentDecision → tool_call: weather.fetch({ region: "日本", event: "暴雨" })

Step 4 (Gateway 执行):
  weather.fetch 返回 observation:
    "降雨持续，未来 24h 预计..."

Step 5 (Agent):
  retrieveCandidateTools(query + observations)
  → top-k: [final_answer, requirement.evaluate_mock]
  agentDecision → final_answer({
    finalText: "日本 XX 地区遭遇暴雨，道路中断，建议推迟出行..."
  })
```

**候选工具检索逻辑**：

每轮 Agent 看到的不是全部工具，而是通过 `retrieveCandidateTools` 根据当前上下文动态筛选的 top-k：

```typescript
function retrieveCandidateTools(
  query: string,
  observations: Observation[],
  missingData: string[],
  registry: CapabilityRegistry
): CapabilityContract[] {
  // 基于 CapabilityContract 的以下字段做语义匹配：
  // - description
  // - llm.whenToUse
  // - llm.avoidWhen
  // - inputSchema（检查 missingData 中的字段是否被该工具产出）
  // - execution.costLevel（优先低成本）
  // - execution.sideEffect（write 工具需要额外策略）
  // 返回 top-k（默认 k=5）
}
```

### AgentDecision Schema

```typescript
type AgentDecision =
  | {
      decision: "tool_call";
      reason: string;
      tool: string;
      params: Record<string, unknown>;
    }
  | {
      decision: "final_answer";
      reason: string;
      finalText: string;
    }
  | {
      decision: "create_requirement";
      reason: string;
      requirementDraft: {
        title: string;
        missingCapability: string;
        userNeed: string;
      };
    }
  | {
      decision: "legacy_fallback";
      reason: string;
    };
```

### Loop 硬限制

| 限制 | 规则 |
|---|---|
| `maxSteps` | 默认 3，复杂任务最多 5 |
| 重复调用拦截 | 同一个 `tool + 同一组 params` 不能重复调用 |
| `unknown_tool` | 直接拦截，不能透传给 Executor |
| `tool_not_allowed` | 进入 `final_answer` 或 `create_requirement` |
| `sideEffect = write` | Phase 0.5 先 mock，不真写入 |
| taskSteps 记录 | 每一步都写 snapshot，`source = "agent"` |

### 验收标准

1. Agent 能根据 query 选择第一个 tool（news.search）
2. Agent 能根据 observation 选择第二个 tool（weather.fetch 或 final_answer）
3. 每轮 Agent 只收到 top-k 候选工具，不是全量工具列表
4. retrieveCandidateTools 能根据 observation 动态调整候选集
5. toolGateway 执行后 observation 回写到 runtime state
6. 重复调用同一 tool+params 被拦截
7. maxSteps 达到上限时 loop 强制结束并返回 final_answer
8. 每一步都写入 taskSteps snapshot（source="agent"）
9. SSE 正常推送每步状态

## Phase 1: Template + Skill + Agent Loop 集成

### 新增文件

```
api/src/modules/actions/contracts/types.ts              # CapabilityContract 类型定义
api/src/modules/actions/contracts/buildToolCatalog.ts   # 从 registry 生成 Agent catalog
api/src/modules/actions/contracts/toolValidator.ts      # 参数/依赖/输出校验
api/src/modules/actions/contracts/jsonSchema.ts         # Zod → JSON Schema 转换

api/src/modules/actions/capabilities/weather-fetch.contract.ts  # weather.fetch contract
api/src/modules/actions/capabilities/news.contract.ts           # news.search contract

api/src/modules/harness/runAgentPipeline.ts             # 总入口
api/src/modules/harness/templateMatcher.ts              # 判断 template / skill 命中
api/src/modules/harness/runOpenAgentLoop.ts             # 未命中后的多轮 Agent 决策
api/src/modules/harness/retrieveCandidateTools.ts       # 每轮 top-k 工具检索
api/src/modules/harness/agentDecision.ts                # 结构化 decision 输出
api/src/modules/harness/toolGateway.ts                  # 统一执行工具
api/src/modules/harness/runtimeState.ts                 # Harness 运行时状态定义
api/src/modules/harness/taskStepSnapshot.ts             # taskStep snapshot 生成

api/src/modules/harness/templates/weatherSimpleTemplate.ts      # 单步 template

api/src/modules/executor/resolveActionConfig.ts         # 兼容层
```

### MVP-A：weather.simple_query Skill 命中

验证 skill 内零 LLM + taskSteps snapshot + Executor 兼容。

```
用户问：查询东京今天的天气
matcher 命中：weather.simple_query（skill）
harness 生成 step：weather.fetch
ToolValidator 校验 params（走 contract schema）
Executor 执行 weather.fetch（通过 resolveActionConfig 读取新格式）
result 经过 normalizeOutput → outputSchema 校验
写入 taskSteps snapshot（含 runId / sequence / stepKey / attempt）
SSE 推送 running / success
finalizer 返回结构化结果
```

### MVP-B：news.search Agent Loop（多轮）

验证 Observation-driven Agent Loop。

```
用户问：最近日本有没有灾害事件，会不会影响出行？
matcher 未命中任何 template / skill
harness 进入 runOpenAgentLoop

Step 1:
  retrieveCandidateTools → [news.search, weather.fetch]
  agentDecision → tool_call: news.search({ query: "日本 灾害" })
  toolGateway 执行
  observation 回写 runtime state
  taskSteps snapshot（source="agent", sequence=1）

Step 2:
  retrieveCandidateTools（含 observation）→ [weather.fetch, final_answer]
  agentDecision → tool_call: weather.fetch({ region: "日本" })
  toolGateway 执行
  observation 回写
  taskSteps snapshot（source="agent", sequence=2）

Step 3:
  retrieveCandidateTools（含 observations）→ [final_answer]
  agentDecision → final_answer({ finalText: "..." })
  loop 结束
```

### MVP-C：旧 pipeline fallback 保留

验证新旧路径可以并行。

```
用户问：查询东海海域态势
matcher 未命中 template / skill
Agent loop 判断为复杂查询
harness 回退到旧 runLegacyAgentPipeline
旧 Planner → Router → Executor 继续工作
Executor 通过 resolveActionConfig 兼容读取旧 actionConfig
```

### 验收标准

1. weather.fetch contract 可以生成 Agent catalog
2. weather.fetch tool_call 可以通过 ToolValidator
3. weather.simple_query 命中后不调用 LLM
4. weather.simple_query 可以写入新格式 taskSteps
5. Executor 可以通过 resolveActionConfig 读取新格式 action
6. 旧 actionConfig 仍能读取
7. weather.fetch result 可以通过 outputSchema 或 normalizeOutput
8. SSE event type 不变，前端能继续展示 running / success
9. Agent loop 能根据 observation 选择下一步 tool
10. retrieveCandidateTools 每轮只返回 top-k，不是全量工具
11. 重复调用被拦截，maxSteps 达到上限 loop 强制结束
12. 未命中时可以选择 legacy_fallback 回退旧 pipeline

## Phase 2: 两步 Template

验证多 step context 传递。

建议先做保守组合，验证 context 传递和 result 存储：

```
方案 A（推荐）：news.search → finalizer.template_summary
方案 B（验证需求单链路）：news.search → requirement.evaluate
```

**注意**：如果选择方案 B，requirement.evaluate 的 contract 必须明确 sideEffect。它如果只评估不写入，sideEffect = "read"；如果会创建数据库记录，sideEffect = "write"。这会影响 harness 的重试策略。

## Phase 3: 迁移硬编码场景

按顺序迁移：
1. fire（火情研判）
2. flood（洪涝评估）
3. earthquake（地震评估）

## Phase 4: 油污溯源（压力测试）

7 步完整链条：gis.mark_region → satellite.query → weather.fetch → oil_drift.traceback → ais.fetch → ais.match_suspects → ais.rank_suspects

适合作为架构压力测试，不适合第一轮验证。

## 数据兼容策略

### actionConfig 新格式（Template / Skill）

```json
{
  "source": "template",
  "kind": "tool_call",
  "templateId": "weather.simple_query",
  "templateStepKey": "fetch_weather",
  "runId": "run_001",
  "sequence": 1,
  "attempt": 1,
  "action": {
    "type": "weather.fetch",
    "name": "weather.fetch",
    "params": {
      "location": "Tokyo",
      "date": "2026-05-29"
    }
  }
}
```

### Agent Loop step 格式

```json
{
  "source": "agent",
  "kind": "tool_call",
  "runId": "run_001",
  "sequence": 2,
  "attempt": 1,
  "agentDecision": {
    "decision": "tool_call",
    "reason": "news 返回暴雨报道，需补充天气实况"
  },
  "action": {
    "type": "weather.fetch",
    "name": "weather.fetch",
    "params": {
      "region": "日本"
    }
  }
}
```

### 兼容层

```typescript
function resolveAction(actionConfig: unknown): Action {
  if (
    typeof actionConfig === "object" &&
    actionConfig !== null &&
    "action" in actionConfig
  ) {
    return (actionConfig as { action: Action }).action;
  }
  return actionConfig as Action;
}
```

旧 Planner/Router 生成的 taskSteps 还能跑，新 harness 生成的 snapshot 也能跑。

## CapabilityContract 结构

```typescript
export type CapabilityContract<
  Input extends z.ZodTypeAny = z.ZodTypeAny,
  Output extends z.ZodTypeAny = z.ZodTypeAny
> = {
  name: string;
  displayName: string;
  description: string;
  inputSchema: Input;
  outputSchema: Output;
  normalizeOutput?: (raw: unknown) => z.infer<Output>;
  dependencies?: DependencyRule[];
  gates?: GateRule[];
  llm: {
    whenToUse: string;
    avoidWhen?: string;
    examples?: ToolExample[];
    exposedFields?: string[];
  };
  execution: {
    timeoutMs: number;
    retry: RetryPolicy;
    idempotent: boolean;
    sideEffect: "none" | "read" | "write" | "external_request";
    costLevel: "low" | "medium" | "high";
  };
};
```

### normalizeOutput 说明

现有工具返回值经常有真实 API / mock / Dify 三种形态。`normalizeOutput` 在 `outputSchema.safeParse` 之前执行，先把原始结果整理成稳定结构：

```typescript
export const weatherFetchContract = {
  // ...
  normalizeOutput: (raw: unknown) => {
    const data = raw as any;
    return {
      temperature: data.temperature ?? data.temp ?? data.main?.temp,
      humidity: data.humidity ?? data.main?.humidity,
      windSpeed: data.windSpeed ?? data.wind?.speed,
    };
  },
  outputSchema: z.object({
    temperature: z.number(),
    humidity: z.number().optional(),
    windSpeed: z.number().optional(),
  }),
};
```

## taskSteps 幂等字段

动态生成 step 后，Worker 重试、任务恢复、SSE 重连都可能导致重复写 step。snapshot 必须包含：

| 字段 | 说明 |
|---|---|
| `runId` | 本次 harness 运行标识 |
| `sequence` | 步骤序号 |
| `stepKey` | `weather.simple_query.fetch_weather` 或 `agent.step.001` |
| `attempt` | 重试次数 |
| `source` | `template` / `agent` / `system` / `recovery` |
| `kind` | `tool_call` / `decision` / `checkpoint` / `finalizer` |
| `toolName` | canonical 工具名 |
| `status` | pending / running / completed / failed |

数据库层保证 `taskId + runId + sequence + attempt` 唯一，或 harness 写入前先查已有 step。

## 校验器迁移策略

**MVP 阶段不删除旧校验**。策略是：

- 新 harness 路径 → `toolValidator.ts`（读 contract schema）
- 旧 Planner/Router 路径 → 继续用 `validateActionParams` + `validateActionCase`

等 weather + news + 两步 template 都验证通过后，再逐步把旧 validator 逻辑搬进 contract。

原因：现有系统还有 satellite、AIS、fire、flood、earthquake、oil-drift 等能力，README 里 capabilities 数量很多，直接替换会牵扯太大。

## 补充决策

**当用户请求未命中高置信度 template / skill 时，harness 进入 open agent loop。**

Open agent loop 每轮由 Agent 根据用户原始 query、已执行 tool observations、当前 missingData 和候选 tool catalog 决定下一步。

候选工具不全量暴露，每轮通过 CapabilityContract 做 top-k retrieval。

每次 tool execution 后写入 taskSteps snapshot，并把 observation 回写到 runtime state。

Loop 在 `final_answer`、`create_requirement`、`legacy_fallback`、`maxSteps`、重复调用或不可恢复错误时结束。

这条补充之后，架构更完整：**稳定流程走 template / skill，开放问题走 Agent loop，执行全部进 gateway，工具约束全部来自 contract。**
