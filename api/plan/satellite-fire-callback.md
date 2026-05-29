# Plan: Satellite 火情场景 — 请求接口 + 回调模式

## Context

当前 satellite 火情场景（`fireScenario = true`）是 mock 实现：固定返回 Kensai 坐标的数据。用户需要对接真实的天基系统：

1. 调用 `POST /satellite/query` 提报火情监测需求
2. 天基系统异步处理（影像获取 + AI 解译）
3. 天基系统通过回调推送结果（目前仅 `{taskId, imageUrl}`，未来扩展字段）
4. 收到回调后继续 Pipeline 后续步骤（fire-detector → border-push）

## Constraints

- 回调格式当前只有 `taskId`（天基需求ID）+ `imageUrl`
- 火点坐标、烧毁区域、rectangle 等数据当前继续 mock
- 不改动现有 4 步 scenario 结构（news → satellite → fire-detector → border-push）
- Executor 是同步 for 循环，无内置 callback/resume 机制

## Recommended Approach: Deferred Promise + Webhook

利用 `Capability.execute` 返回 `Promise<ActionResult>` 的特性：satellite capability 的 Promise 在 callback 到达后才 resolve，Executor 自然等待。

### Architecture

```
Executor for 循环
  step 1: news ──→ 完成
  step 2: satellite ──→ POST /satellite/query
                         ├─ type=history → 直接返回
                         └─ type=demand  → 创建 Deferred Promise
                                            注册到 CallbackRegistry
                                            写入 Redis (TTL=5min)
                                            ┌─→ 等待回调...
                                            │
  ←── callback 到达 ─────┘
  resolve Promise → Executor 继续
  step 3: fire-detector ──→ 完成
  step 4: border-push ──→ 完成
```

### Files to Modify

#### 1. `api/src/modules/actions/capabilities/satellite.ts`

改动点：
- 删除 `fireScenario` 分支的 mock 数据
- 改为真实调用 `POST http://192.168.0.204:18000/satellite/query`
- `type=history`：从 `resp.data.records` 提取影像数据构建 `gisData`
- `type=demand`：
  - 保存 `tianjian_req_id`
  - 返回 `new Promise((resolve) => { ... })`
  - 注册到全局 `CallbackRegistry`
  - 设置 5 分钟超时，超时 fallback 到 mock 数据
- `type=no_data/error`：返回失败

新增辅助函数：
- `callSatelliteQuery(params)` — 封装 HTTP 调用
- `buildGisDataFromRecords(records)` — 从 records 构建 gisData
- `buildMockFallback(regionName)` — 超时兜底

#### 2. 新增 `api/src/modules/callbacks/satelliteRegistry.ts`

```typescript
interface PendingCallback {
  resolve: (result: ActionResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  taskId: string;
  stepId: string;
  actionId: string;
  tianjianReqId: string;
}

// 内存注册表
const registry = new Map<string, PendingCallback>();

export function register(reqId: string, pending: PendingCallback): void;
export function resolve(reqId: string, imageUrl: string): ActionResult | null;
export function cleanup(reqId: string): void;
```

#### 3. 新增 `api/src/routes/callbacks.ts`（或放入现有路由）

```typescript
POST /callbacks/satellite
Body: { taskId: string, imageUrl: string }

// 1. 查 registry
// 2. clearTimeout
// 3. 构造 ActionResult（imageUrl + mock 火点/区域数据）
// 4. resolve deferred Promise
// 5. 返回 {code: 200, msg: "ok"}
```

#### 4. `api/src/index.ts`

挂载新的 callback 路由：
```typescript
app.use("/callbacks", callbackRoutes);
```

#### 5. `api/src/db/schema.ts`（可选，用于持久化）

若需要服务重启恢复，在 `taskSteps` 表新增：
```typescript
externalReqId: text("external_req_id"),     // 天基 tianjian_req_id
callbackPayload: jsonb("callback_payload"), // 回调收到的原始数据
```

但短期可先不做 schema 改动，纯内存 + Redis 即可。

### Data Flow

**T0: 提报需求**
```
POST 192.168.0.204:18000/satellite/query
Body: { query: "新疆-哈萨克斯坦接壤段 火情遥感影像" }

Response:
{
  success: true,
  data: {
    type: "demand",
    tianjian_req_id: "2038510963360542721",
    ...
  }
}
```

**T1: 注册等待**
```
Registry: "2038510963360542721" → {
  resolve, reject, timeout,
  taskId: "我们的taskId",
  stepId: "step-xxx",
  actionId: "action-2"
}

Redis: SETEX satellite:pending:2038510963360542721 300 {taskId, stepId}

SSE: {type: "step_update", status: "running", name: "天基遥感影像获取与火情解译",
      detail: "需求已提报，等待影像回传... (reqId: 20385...)"}
```

**T2: 回调到达**
```
POST /callbacks/satellite
Body: {
  taskId: "2038510963360542721",
  imageUrl: "http://192.168.0.123:82/fire-xxx.jpg"
}

→ Registry 查找 → resolve Promise
→ ActionResult:
{
  success: true,
  data: {
    message: "天基影像获取完成...",
    data: {
      type: "fire_imaging",
      responseType: "fire_imaging",
      gisData: {
        type: "region",
        imageOverlays: [{id, url, rectangle, alpha, tileWidth, tileHeight}],
        // rectangle 从 mock 或 image 元数据获取
      }
    }
  }
}
```

**T3: Executor 继续**
```
Promise resolved → Executor for 循环继续
→ step 3 (fire-detector) 执行
→ step 4 (border-push) 执行
→ 任务完成
```

### Error Handling

| 场景 | 处理 |
|------|------|
| 回调超时（5min） | resolve 为 mock fallback 数据，metadata 标记 timeout |
| 服务重启 + 回调到达 | Registry 无记录，直接更新 DB + SSE，但不触发后续步骤 |
| 重复回调 | Registry 已删除，直接返回 200（幂等） |
| satellite/query 接口失败 | 直接返回 mock fallback |

### 与现有系统的集成点

1. **Executor**: 无改动。Deferred Promise 对 Executor 透明。
2. **SSE**: callback handler  resolve Promise 后，Executor 自然的 `publishStepUpdate` 会推送 SSE。
3. **Events**: Executor 的 `writeDisplayData` 会在 step 完成后写入 events 表。
4. **FireOverlay**: 前端 `useTaskChat` 检测到 `fireDetected=true` 后触发 showFireOverlay，逻辑不变。

### 短期 Fallback

如果天基 callback 还没 ready（还在开发中），satellite capability 可以先走**内部短轮询**兜底：

```typescript
// 在 demand 分支中
if (process.env.MOCK_SATELLITE_CALLBACK === 'true') {
  // 模拟等待 10 秒后返回 mock 数据
  await sleep(10000);
  return { success: true, data: mockData };
}
// 否则走真实 deferred Promise + webhook
```

## Verification

1. 本地启动 API 服务
2. 触发火情研判 scenario（点击"火情研判"按钮）
3. 观察 step 2 (satellite) 的 SSE：`status: running`，`detail: 等待影像回传...`
4. 模拟回调：`curl -X POST http://localhost:3001/callbacks/satellite -d '{"taskId":"xxx","imageUrl":"yyy"}'`
5. 观察 SSE：step 2 `status: completed`，step 3/4 继续执行
6. 右侧面板出现 satellite 事件 + fire-detector 事件
7. 地图显示火灾 overlay

## Alternative Considered

| 方案 | 描述 | 为什么不选 |
|------|------|-----------|
| 长轮询（capability 内部轮询） | 每隔5秒查询天基状态，最大2分钟 | 不符合用户"回调"的语义要求；阻塞 executor 线程 |
| 新增 `waiting` status + 重构 Executor | 让 Executor 支持 pause/resume | 改动面太大，涉及 schema、executor、BullMQ worker |
| 合并 satellite + fire-detector | 把两个 step 合成一个 | 破坏了现有 scenario 结构，Router/Planner 都要改 |

Deferred Promise 方案是唯一不需要改 Executor、schema、路由（仅新增 callback 路由）的方案。
