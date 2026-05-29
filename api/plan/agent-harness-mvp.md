# Agent Harness 最小验证计划

## 背景

当前架构 Planner → Router → Executor 存在信息断层，工具注册分散在四处（Planner prompt、Router prompt、validateActionParams、validateActionCase）。目标是用 Template-first Agent Harness 替代，实现：

- Template 内零 LLM 执行
- 工具注册统一从 CapabilityContract 驱动
- 新旧数据格式兼容
- 边界/失败/开放 query 才调 Agent

## 决策共识

| # | 决策项 | 结论 |
|---|---|---|
| 1 | 痛点根因 | Planner/Router 信息断层 + 工具注册分散 |
| 2 | 架构方向 | Template-first Agent Harness |
| 3 | 硬编码场景 | 保留为 template，验证后逐步 workflowTemplate 化 |
| 4 | LLM 调用 | Template 内零 LLM，边界/失败/开放 query 才调 Agent |
| 5 | 数据层 | taskSteps = 执行日志 + checkpoint，Redis = 运行时 state |
| 6 | 工具 Schema | Zod runtime schema + CapabilityContract |
| 7 | 最小验证工具 | weather-fetch（低风险、返回稳定） |

## Phase 1: MVP（单步 weather template + contract 系统）

### 新增文件

```
api/src/modules/actions/contracts/types.ts           # CapabilityContract 类型定义
api/src/modules/actions/contracts/buildToolCatalog.ts # 从 registry 生成 Agent catalog
api/src/modules/actions/contracts/toolValidator.ts    # 参数/依赖/输出校验
api/src/modules/actions/capabilities/weather-fetch.contract.ts  # weather-fetch 的 contract
api/src/modules/harness/runAgentPipeline.ts           # 新 pipeline 入口
api/src/modules/harness/templateMatcher.ts            # 确定性 matcher
api/src/modules/harness/templates/weatherSimpleTemplate.ts      # 单步 template
api/src/modules/harness/taskStepSnapshot.ts           # taskStep snapshot 生成
api/src/modules/executor/resolveActionConfig.ts       # 兼容层
```

### 验收标准

1. 新增一个工具时，不再修改 Planner prompt
2. 新增一个工具时，不再修改 Router prompt
3. 新增一个工具时，不再修改 validateActionParams
4. 新增一个工具时，不再修改 validateActionCase
5. template 命中后，执行过程中不调用 LLM
6. template 未命中后，可以进入 Agent fallback
7. 新旧 actionConfig 都能被 Executor 正常读取
8. taskSteps 历史查询还能看到每一步状态和结果
9. 前端 SSE 不需要大改，仍能收到 step_update

### 单步 Template 示例

```
用户问：查询东京今天的天气
matcher 命中：weather.simple_query
harness 生成 step：weather-fetch
ToolValidator 校验 params
Executor 执行 weather-fetch
写入 taskSteps snapshot
SSE 推送 running / success
finalizer 返回结构化结果
```

### Agent Fallback（mock）

```json
{
  "decision": "tool_call",
  "tool": "news.search",
  "params": {
    "query": "用户原始问题"
  }
}
```

先不用追求 Agent 真聪明。只要能证明"未命中 template 的 query 可以动态生成 step，step 可以落库，executor 可以跑，结果可以回写 state"，fallback 链路就通了。

## Phase 2: 两步 Template

验证多 step context 传递。

示例：news.search → requirement.evaluate

## Phase 3: 迁移硬编码场景

按顺序迁移：
1. fire（火情研判）
2. flood（洪涝评估）
3. earthquake（地震评估）

## Phase 4: 油污溯源（压力测试）

7 步完整链条：region-mark → satellite → weather → oil-drift → ais-fetch → ais-match → ais-ranking

适合作为架构压力测试，不适合第一轮验证。

## 数据兼容策略

### actionConfig 新格式

```json
{
  "source": "template",
  "kind": "tool_call",
  "templateId": "weather.simple_query",
  "templateStepKey": "fetch_weather",
  "action": {
    "type": "weather",
    "name": "weather-fetch",
    "params": {
      "location": "Tokyo",
      "date": "2026-05-29"
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
