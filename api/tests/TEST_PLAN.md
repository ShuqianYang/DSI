# Agent 编排系统 — 实际测试清单

## 一、测试框架选型

| 项目 | 选型 | 理由 |
|------|------|------|
| 测试框架 | **Vitest** | ESM 原生支持、与 tsx 兼容、Watch 模式快、内置 mocking |
| 断言库 | Vitest 内置 | `expect`, `toBe`, `toEqual`, `toThrow`, `toHaveBeenCalledWith` |
| HTTP 测试 | **supertest** | 测试 Express 路由的标准方案 |
| DB 测试 | **pgtest** / 独立 test DB | 每次测试后 truncate 表，保证隔离性 |
| Mock 外部 HTTP | **msw** (或 vitest 内置 `vi.fn` + `fetch` mock) | 拦截 fetch 请求，模拟 Dify API 返回 |
| 运行命令 | `vitest run` / `vitest watch` | 集成到 `package.json` scripts |

### 新增 devDependencies
```bash
pnpm add -D vitest supertest @types/supertest
```

### package.json scripts 新增
```json
"test": "vitest run",
"test:watch": "vitest",
"test:e2e": "vitest run --config vitest.e2e.config.ts"
```

---

## 二、测试分层总览

```
L4 混沌/边界测试  →  超时、并发、网络中断、Dify 500、DB 断开
L3 端到端测试      →  POST /tasks → Planner → Router → Executor → GET /tasks/:id
L2 集成测试        →  Service + DB + Redis（真实或 testcontainers）
L1 单元测试        →  Service / Capability 纯逻辑（mock 所有外部）
L0 工具函数测试    →  parsePlanFromText, callDifyChat, computeNextExecuteTime
```

---

## 三、L0 — 纯函数/工具函数测试

### 3.1 `src/lib/dify.ts` — `callDifyChat`

| # | 测试用例 | 预期结果 |
|---|---------|---------|
| L0-1 | 正常 SSE 流：`event: message` + `answer: "hello"` + `event: message_end` | 返回 `{ answer: "hello", ... }` |
| L0-2 | SSE 流包含多个 `message` 事件 | answer 被正确拼接（`"hel" + "lo"` → `"hello"`） |
| L0-3 | SSE 流包含 `agent_message` 事件 | answer 同样被拼接 |
| L0-4 | `agent_thought` 事件被忽略，不影响结果 | answer 只含 `message`/`agent_message` 内容 |
| L0-5 | URL 自动拼接：`apiUrl = "https://api.dify.ai/v1"` | 请求发到 `/v1/chat-messages` |
| L0-6 | URL 已以 `/chat-messages` 结尾 | 不再重复拼接 |
| L0-7 | API key 为空字符串 | 抛出 `Dify API key not configured` |
| L0-8 | Dify 返回 HTTP 404 | 抛出包含 status 和 response body 的错误 |
| L0-9 | Dify 返回 HTTP 200 但 body 为空 | 抛出 `Dify API returned empty body` |
| L0-10 | SSE 流中出现 `event: error` | 抛出 `Dify stream error` |
| L0-11 | SSE chunk 跨行分割（JSON 被切分到两个 chunk） | 仍能正确解析（stream: true 模式） |

### 3.2 `src/modules/planner/service.ts` — `parsePlanFromText`

| # | 测试用例 | 预期结果 |
|---|---------|---------|
| L0-12 | 标准 JSON：`{"goal": "x", "steps": [...]}` | 正确解析，goal 和 steps 匹配 |
| L0-13 | Markdown 代码块包裹：` ```json\n{"goal": ...}\n``` ` | 去除代码块后正确解析 |
| L0-14 | 缺少外层花括号：`"goal": "x", "steps": [...]` | 自动补 `{` 后正确解析 |
| L0-15 | 包含 BOM 字符（`\uFEFF`） | 去除 BOM 后正常解析 |
| L0-16 | 无效 JSON + 包含 `1. 步骤描述` 行 | 走启发式解析，提取 steps |
| L0-17 | 完全无步骤格式的文本 | 走兜底逻辑：整个文本作为 step-1 |
| L0-18 | `steps` 字段不是数组 | 走启发式解析（JSON.parse 通过但校验失败） |
| L0-19 | `goal` 字段缺失 | 走启发式解析（回退到 query 参数） |

### 3.3 `src/modules/router/service.ts` — 解析函数

| # | 测试用例 | 预期结果 |
|---|---------|---------|
| L0-20 | `parseActionsFromText` 收到合法 JSON 数组 | 返回对应 Action[] |
| L0-21 | `parseActionsFromText` 收到非 JSON 文本 + 包含"海域""态势" | 走启发式，返回 `maritime` action |
| L0-22 | `inferSubscriptionType("周报")` | 返回 `{ type: "weekly", schedule: "0 9 * * 1" }` |
| L0-23 | `inferSubscriptionType("实时监测")` | 返回 `{ type: "realtime", schedule: "*/30 * * * *" }` |
| L0-24 | `inferSubscriptionType("普通查询")` | 返回默认 `daily` |
| L0-25 | `inferSubscribedToolType("卫星影像")` | 返回 `satellite` |
| L0-26 | `inferSubscribedToolParams("设备日报", "daily_report")` | 返回 `{ report_type: "buckle" }` |

### 3.4 `src/modules/scheduler/service.ts` — `computeNextExecuteTime`

| # | 测试用例 | 预期结果 |
|---|---------|---------|
| L0-27 | `computeNextExecuteTime("0 9 * * *", "daily")` | 返回 24 小时后 |
| L0-28 | `computeNextExecuteTime("0 9 * * 1", "weekly")` | 返回 7 天后 |
| L0-29 | `computeNextExecuteTime("*/30 * * * *", "realtime")` | 返回 30 分钟后 |
| L0-30 | `computeNextExecuteTime("*/5 * * * *", "realtime")` | 返回 5 分钟后 |

---

## 四、L1 — 单元测试（Mock 外部依赖）

### 4.1 `planner/service.ts`

| # | 测试用例 | Mock 策略 |
|---|---------|----------|
| L1-1 | `MOCK_PLANNER=true` | 不调用 Dify，直接返回 mock plan |
| L1-2 | `MOCK_PLANNER=false` + `DIFY_API_KEY=set` | mock `callDifyChat`，验证传入参数 |
| L1-3 | `MOCK_PLANNER=false` + `DIFY_API_KEY=""` | 自动 fallback 到 mock |
| L1-4 | Dify 返回超时（`callDifyChat` 抛错） | `plannerService.generatePlan` 向上抛错 |

### 4.2 `router/service.ts`

| # | 测试用例 | Mock 策略 |
|---|---------|----------|
| L1-5 | `MOCK_ROUTER=true` | 不调用 Dify，走 `mockDecideActions` |
| L1-6 | `MOCK_ROUTER=false` + 正常 Dify 返回 | mock `callDifyChat`，返回 JSON actions |
| L1-7 | Mock 模式下 query 含"订阅" | 返回 `subscription` action |
| L1-8 | Mock 模式下 query 含"查询 有多少" | 返回 `intelligent_qa` action |
| L1-9 | Mock 模式下 query 含"卫星" | 返回 `satellite` action |
| L1-10 | Mock 模式下 query 完全不匹配任何关键词 | 返回兜底 `intelligence` 或 `requirement` action |
| L1-11 | Mock 模式下 query 长度 <= 6（问候语） | 返回 `intelligence` 通用分析 |
| L1-12 | Mock 模式下 query 长度 >= 8 且无匹配 | 返回 `requirement` 记录需求 |

### 4.3 `actions/registry.ts`

| # | 测试用例 | 预期结果 |
|---|---------|---------|
| L1-13 | `getCapability("maritime")` | 返回 `maritimeCapability` |
| L1-14 | `getCapability("nonexistent")` | 返回 `undefined` |
| L1-15 | `listCapabilities()` | 返回 8 条记录（maritime, intelligence, gis, ...） |
| L1-16 | 重复注册同名 capability | 后注册的覆盖先注册的 |

### 4.4 `actions/service.ts`

| # | 测试用例 | Mock 策略 |
|---|---------|----------|
| L1-17 | 执行已注册 capability（maritime） | mock `maritimeCapability.execute`，验证参数传递 |
| L1-18 | 执行未知 capability 类型 | 返回 `{ success: false, error: "Unknown action type" }` |
| L1-19 | capability execute 抛异常 | `actionsService.execute` 应捕获并返回失败结果（待确认当前行为） |

### 4.5 `actions/capabilities/*.ts` — 各能力 Mock 测试

| # | 测试用例 | 校验点 |
|---|---------|--------|
| L1-20 | `maritimeCapability.execute` | 返回 data.vessels 数组、summary、gisLayers |
| L1-21 | `intelligenceCapability.execute` | 返回 data.findings 数组、summary、keyEntities |
| L1-22 | `gisCapability.execute` | 返回 data.layers 数组 |
| L1-23 | `dailyReportCapability.execute` | 返回 data.report_content 非空 |
| L1-24 | `satelliteCapability.execute` | 返回 data 含 type/message |
| L1-25 | `subscriptionCapability.execute` | 返回 data 含 id/type/schedule |
| L1-26 | `requirementCapability.execute` | 返回 data 含 description/status/requirementId |
| L1-27 | `intelligentQaCapability.execute` | 返回 data 含 report_content/stats |

### 4.6 `executor/service.ts` — 关键路径（mock DB）

| # | 测试用例 | Mock 策略 |
|---|---------|----------|
| L1-28 | 正常执行单个 action（maritime） | mock `db.select/insert/update`, mock `actionsService.execute`, 验证 `writeDisplayData` 被调用 |
| L1-29 | action 有 dependsOn 且依赖已完成 | context 中应包含依赖结果 |
| L1-30 | action 有 dependsOn 但依赖未完成 | 跳过该 step，保持 pending |
| L1-31 | action execute 返回 `success: false` | step 状态更新为 failed，task 最终状态为 failed |
| L1-32 | action execute 抛异常 | step 状态更新为 failed，错误消息记录 |
| L1-33 | 无 steps 的任务 | task 直接标记为 completed，result = `{ message: "No actions" }` |
| L1-34 | `inferJobType` 判断 | 含 daily_report → daily；含 subscription → 根据 schedule 推断；其他 → realtime |
| L1-35 | `writeDisplayData` maritime → 写入 events 表 | 验证 gisData 结构正确（entities 含 coordinates） |
| L1-36 | `writeDisplayData` intelligence → 写入 events + insights | 验证 insights 条数 = findings.length + keyEntities.length（relevance > 0.7） |
| L1-37 | `publishStepUpdate` | mock `redisPublisher.publish`，验证消息格式含 taskId/status/name |

### 4.7 `tasks/controller.ts`

| # | 测试用例 | Mock 策略 |
|---|---------|----------|
| L1-38 | `createTask` 正常流程 | mock `taskService.createTask`, `plannerService.generatePlan`, `routerService.decideActions`, `taskQueue.add`，验证 201 响应 |
| L1-39 | `createTask` 返回纯 subscription actions | 不投递队列，直接 completed，验证 `createSubscription` 被调用 |
| L1-40 | `createTask` 返回纯 requirement actions | 不投递队列，直接 completed，验证 `createRequirement` 被调用 |
| L1-41 | `getTask` 存在的 task | 返回 200 + 完整数据 |
| L1-42 | `getTask` 不存在的 task | 返回 404 |

### 4.8 `sse/sseManager.ts`

| # | 测试用例 | Mock 策略 |
|---|---------|----------|
| L1-43 | `addSseClient` + `notifyTaskUpdate` | mock Express `Response`，验证 `res.write` 被调用 |
| L1-44 | 客户端断开（write 抛错） | 自动从 clients Map 中移除 |
| L1-45 | `removeSseClient` 后通知 | 无响应被写入 |

---

## 五、L2 — 集成测试（真实 DB + Redis）

**环境要求**：单独的 test 数据库（如 `datasource_test`），每次 `beforeAll` 执行 `drizzle-kit push`，每次 `afterEach` truncate 所有表。

### 5.1 DB Schema 集成

| # | 测试用例 | 验证 |
|---|---------|------|
| L2-1 | `tasks` 表 insert + select | UUID 自动生成、status 默认 pending、timestamp 自动填充 |
| L2-2 | `taskSteps` 表 insert + 关联 tasks.id（cascade delete） | 删除 task 后 steps 自动级联删除 |
| L2-3 | `tasks` 的 JSONB 字段（plan/actions/result）| 插入/读取保持类型一致 |
| L2-4 | 索引有效性 | `tasks.status` / `taskSteps.taskId` 查询走索引（可用 `EXPLAIN`） |

### 5.2 tasks/service.ts 集成

| # | 测试用例 | 验证 |
|---|---------|------|
| L2-5 | `createTask` → `getTaskById` | 数据完整返回 |
| L2-6 | `updateTaskPlan` + `updateTaskActions` | JSONB 字段正确更新 |
| L2-7 | `createTaskSteps` + `updateStepStatus` | steps 创建后状态可被更新为 running/completed |
| L2-8 | `updateTaskResult` | result 字段写入 + status 变为 completed |
| L2-9 | `getTaskWithSteps` | 同时返回 task 和关联 steps |

### 5.3 queue/taskQueue.ts 集成

| # | 测试用例 | 验证 |
|---|---------|------|
| L2-10 | `taskQueue.add` 投递 job | Redis 中存在对应的 BullMQ job |
| L2-11 | Worker 消费 job 并调用 `executorService.run` | 任务最终被标记为 completed（需 mock executorService 或使用真实执行） |
| L2-12 | Worker 失败重试 | 失败 job 自动重试 3 次（exponential backoff） |
| L2-13 | Redis Pub/Sub SSE 消息 | `redisPublisher.publish` → `redisSubscriber` 能收到消息 |

### 5.4 scheduler/service.ts 集成

| # | 测试用例 | 验证 |
|---|---------|------|
| L2-14 | 插入一条 `nextExecuteTime <= now` 的 subscription | 定时器触发后执行，events 表新增记录 |
| L2-15 | subscription 执行成功后 `nextExecuteTime` 更新 | 时间正确前进（daily +1天 / weekly +7天） |
| L2-16 | subscription 执行失败 | 状态变为 failed，events 表新增失败记录 |
| L2-17 | `startScheduler` 幂等性 | 多次调用不会创建多个 cron job |

---

## 六、L3 — 端到端测试（完整 API 流程）

**运行方式**：启动真实 API server（`api/src/index.ts`）+ Worker（`api/src/worker.ts`）或使用 supertest 挂载 Express app。

| # | 场景 | 请求 | 断言 |
|---|------|------|------|
| L3-1 | 创建并执行海域态势分析 | `POST /tasks` body: `{"query": "分析东海近期态势"}` | 201；返回 taskId/plan/actions；plan.goal 非空；actions 含 maritime |
| L3-2 | 查询任务结果 | `GET /tasks/:taskId` | 200；status = completed；steps 非空；result 含 vessels/gisLayers |
| L3-3 | 创建订阅任务 | `POST /tasks` body: `{"query": "订阅每日东海日报"}` | 201；status = completed；验证 subscriptions 表新增记录 |
| L3-4 | 创建需求记录 | `POST /tasks` body: `{"query": "帮我预测未来一周的天气"}` | 201；status = completed；验证 requirements 表新增记录 |
| L3-5 | 查询不存在的任务 | `GET /tasks/00000000-0000-0000-0000-000000000000` | 404 |
| L3-6 | 创建任务后 SSE 推送 | `GET /tasks/:taskId/stream` | 收到 task/status 更新事件 |
| L3-7 | 多 action 依赖链 | `POST /tasks` 构造含 dependsOn 的 plan | steps 按依赖顺序执行，context 传递正确 |
| L3-8 | 创建任务后 job 进入队列 | `POST /tasks` | BullMQ dashboard（或 Redis）中能看到对应 job |

---

## 七、L4 — 边界/混沌测试

| # | 场景 | 注入方式 | 预期行为 |
|---|------|---------|---------|
| L4-1 | Dify API 超时（>30s） | mock `fetch` 返回 `AbortError` | `plannerService` 抛错，task 状态变为 failed |
| L4-2 | Dify API 返回 429 Too Many Requests | mock `fetch` status=429 | 抛错，不 infinite retry |
| L4-3 | Dify 返回畸形 SSE（无 data: 前缀） | mock response.body | `callDifyChat` 忽略无效行，最终 answer 可能为空 |
| L4-4 | Dify 返回空 answer | mock `callDifyChat` 返回 `{ answer: "" }` | `parsePlanFromText` 走兜底逻辑 |
| L4-5 | PostgreSQL 连接断开 | 运行中 kill pg container | API 抛 500，不 crash 进程 |
| L4-6 | Redis 连接断开 | 运行中 kill redis container | BullMQ job 挂起，Redis 恢复后自动恢复 |
| L4-7 | 并发创建 10 个任务 | `Promise.all(Array(10).fill(postTask()))` | 所有任务创建成功，steps 不串号 |
| L4-8 | Worker 并发执行 5 个任务 | 投递 5 个 job | Worker concurrency=5，5 个任务并行执行 |
| L4-9 | 超大 query（>10000 字符） | `POST /tasks` body 超大 | 正常创建（PostgreSQL text 无限制），Dify 可能截断但系统不崩 |
| L4-10 | XSS/SQL 注入 query | `query: "<script>alert(1)</script>; DROP TABLE tasks;--"` | 原样存入 DB（PostgreSQL 参数化查询防注入），返回结果不执行脚本 |
| L4-11 | 特殊字符 query | `query: "海域\n\t态势\r\"'"` | 正常处理，JSON 序列化无异常 |
| L4-12 | Worker 执行中进程重启 | kill worker 后重启 | BullMQ 的 `attempts: 3` 保证任务最终执行 |
| L4-13 | 内存泄漏检测（长时运行） | 连续执行 1000 次任务 | 进程内存不持续增长（SSE clients Map 及时清理） |

---

## 八、前端联动测试（可选，需要 Next.js 前端配合）

| # | 场景 | 验证 |
|---|------|------|
| FE-1 | 前端发起任务创建 | 调用 `POST /tasks`，正确解析返回的 taskId |
| FE-2 | 前端轮询任务状态 | `GET /tasks/:id` 间隔查询，状态变化时更新 UI |
| FE-3 | 前端 SSE 实时更新 | `EventSource` 连接 `/tasks/:id/stream`，收到 step_update 事件 |
| FE-4 | 前端展示 events | 任务完成后 events 表数据正确渲染到 RightPanel |
| FE-5 | 前端展示 GIS 数据 | maritime/gis 任务的 gisData 正确渲染到地球引擎 |

---

## 九、测试数据管理

### Test DB 隔离策略

```typescript
// tests/setup.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

const TEST_DB_URL = "postgresql://postgres:postgres@localhost:5432/datasource_test";

export async function setupTestDb() {
  const client = new Client({ connectionString: TEST_DB_URL });
  await client.connect();
  const db = drizzle(client);
  // 清表（顺序很重要：先删子表）
  await db.execute(`
    TRUNCATE TABLE events, insights, requirements, subscriptions,
    job_tasks, task_steps, tasks RESTART IDENTITY CASCADE;
  `);
  return { db, client };
}
```

### Dify API Mock 数据

```typescript
// tests/mocks/dify.ts
export const mockDifyPlanResponse = {
  answer: JSON.stringify({
    goal: "分析东海近期海域态势",
    steps: [
      { id: "step-1", description: "解析范围", purpose: "确定区域", expectedOutput: "区域：东海" },
      { id: "step-2", description: "检索数据", purpose: "获取船舶数据", expectedOutput: "船舶列表" },
    ],
    reasoning: "用户请求海域态势分析",
  }),
};

export const mockDifyRouterResponse = {
  answer: JSON.stringify([
    { id: "action-1", type: "maritime", name: "海域态势分析", description: "", params: { region: "东海" } },
  ]),
};
```

---

## 十、CI/CD 集成建议

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: datasource_test
        ports: ["5432:5432"]
      redis:
        image: redis:7
        ports: ["6379:6379"]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm db:push  # 推 schema 到 test DB
      - run: pnpm test     # L0 + L1 + L2
      - run: pnpm test:e2e # L3（需启动 API server）
```

---

## 十一、当前已验证 vs 待补充

| 状态 | 项目 |
|------|------|
| 已验证 | Planner Dify 集成（JSON 解析修复后通过） |
| 已验证 | Router Dify 集成（maritime 决策正确） |
| 已验证 | 完整 E2E：POST /tasks → Executor → completed |
| 未验证 | 其余 7 种 capability 的独立执行 |
| 未验证 | dependsOn 依赖链执行 |
| 未验证 | 纯 subscription / 纯 requirement 任务流程 |
| 未验证 | Scheduler 定时触发订阅 |
| 未验证 | SSE 实时推送 |
| 未验证 | Worker 失败重试 |
| 未验证 | 并发场景 |
| 未验证 | 错误注入（Dify 超时、DB 断开等） |
