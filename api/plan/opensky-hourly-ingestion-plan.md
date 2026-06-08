# OpenSky 每小时数据落库实施计划

> 由 grill-me 讨论锁定设计决策后输出。分步实施，每步独立可验证。

---

## 设计决策（已确认）

| 决策点 | 选择 |
|--------|------|
| 数据粒度 | 逐行展开（每架飞机一行） |
| 历史保留 | 纯当前状态（表只保留最新快照） |
| 替换策略 | **事务包裹 DELETE + INSERT**（原子替换，查询无中间态） |
| 调度 | **BullMQ repeatable job**（`0 * * * *` 每小时） |
| 定时触发 | **API 启动时注册**（幂等：已存在则跳过） |
| 执行 | **独立 Worker 进程**消费队列 |
| 区域过滤 | 拉取全球数据（`states/all`），数据库层面按区域查询 |
| region / status | **先留空 / 默认值**（skill 查询不依赖） |
| Token | **每次重新获取**（不缓存） |
| 失败处理 | **不重试**，失败即丢弃，等下一小时调度 |

---

## 文件结构

```
api/src/
├── db/schema.ts                          # 新增 aircraft_current_states 表
├── db/migrations/                        # 由 drizzle-kit generate 生成
├── modules/opensky/
│   ├── client.ts                         # OpenSky API 客户端（OAuth + states/all）
│   ├── repository.ts                     # Drizzle 事务替换操作
│   ├── queue.ts                          # BullMQ Queue + repeatable job 注册
│   └── worker.ts                         # Worker 处理器（消费 → 获取 → 事务入库）
├── index.ts                              # 启动时调用 queue.register()
└── worker.ts                             # Worker 进程入口（独立容器运行）
```

---

## Step 1：Schema — 新增 `aircraft_current_states` 表

**目标**：在 `api/src/db/schema.ts` 中添加表定义，匹配 skill 期望的查询字段。

**表结构**：

```ts
export const aircraftCurrentStates = pgTable(
  "aircraft_current_states",
  {
    icao24: text("icao24").primaryKey(),           // OpenSky 返回的 icao24
    callsign: text("callsign"),
    originCountry: text("origin_country"),
    longitude: doublePrecision("longitude"),
    latitude: doublePrecision("latitude"),
    baroAltitude: doublePrecision("baro_altitude"),
    velocity: doublePrecision("velocity"),
    trueTrack: doublePrecision("true_track"),
    verticalRate: doublePrecision("vertical_rate"),
    onGround: boolean("on_ground").notNull().default(false),
    squawk: text("squawk"),
    spi: boolean("spi").notNull().default(false),
    positionSource: integer("position_source"),
    category: integer("category"),
    sourceTime: timestamp("source_time", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    region: text("region").default(""),            // 先留空
    status: text("status").default(""),            // 先留空
  },
  (table) => [
    index("acs_lat_idx").on(table.latitude),
    index("acs_lon_idx").on(table.longitude),
    index("acs_updated_at_idx").on(table.updatedAt),
  ]
);

export type AircraftCurrentState = typeof aircraftCurrentStates.$inferSelect;
export type NewAircraftCurrentState = typeof aircraftCurrentStates.$inferInsert;
```

**注意**：
- `icao24` 为主键（纯当前状态下每架飞机唯一一行）
- 需要 `doublePrecision` 导入
- 索引：`latitude`、`longitude`、`updated_at`（skill 按 bbox 查询 + 排序）

**验证**：
```powershell
# api/
pnpm tsc
```

---

## Step 2：Migration — 生成数据库迁移文件

**目标**：用 drizzle-kit 生成迁移。

```powershell
# api/
pnpm db:generate
```

**验证**：检查 `api/src/db/migrations/` 下是否生成了新的迁移文件，包含 `CREATE TABLE aircraft_current_states`。

**应用迁移**（开发环境可直接 push）：
```powershell
# api/
pnpm db:push
```

---

## Step 3：OpenSky Client — 提取可复用的 API 客户端

**目标**：把 `test-opensky.ts` 的获取逻辑提取为模块化的客户端。

**文件**：`api/src/modules/opensky/client.ts`

**职责**：
- `getToken()`：OAuth client_credentials 获取 access_token
- `fetchStates(token)`：调用 `states/all`，返回 `{ time: number; states: unknown[] }`
- 环境变量：`OPENSKY_CLIENT_ID`、`OPENSKY_CLIENT_SECRET`

**注意**：
- 每次调用都重新获取 token（不缓存）
- `states/all` 不加 bbox 参数（拉取全球数据）
- 返回类型保持和 OpenSky 原始数组一致，不做归一化（归一化在 worker 里做）

**验证**：写一个简单的测试脚本运行 `client.ts` 确认能成功获取数据。

---

## Step 4：Repository — 事务替换操作

**文件**：`api/src/modules/opensky/repository.ts`

**职责**：
- `replaceAll(states: NewAircraftCurrentState[])`：在事务内执行 `DELETE FROM aircraft_current_states` + 批量 `INSERT`

**实现要点**：
```ts
import { db } from "../../config/database.js";
import { aircraftCurrentStates } from "../../db/schema.js";

export async function replaceAll(
  states: typeof aircraftCurrentStates.$inferInsert[]
): Promise<{ deleted: number; inserted: number }> {
  return await db.transaction(async (tx) => {
    const deleted = await tx.delete(aircraftCurrentStates);
    if (states.length > 0) {
      await tx.insert(aircraftCurrentStates).values(states);
    }
    return { deleted: deleted.rowCount ?? 0, inserted: states.length };
  });
}
```

**注意**：
- 使用 Drizzle 的 `db.transaction()`
- 查询永远不会看到空表或混合状态（事务隔离）

---

## Step 5：BullMQ Queue — API 侧注册 repeatable job

**文件**：`api/src/modules/opensky/queue.ts`

**职责**：
- 创建 `Queue('opensky')`
- `registerOpenSkyJob()`：幂等地注册 repeatable job（`0 * * * *`，每小时）
- 已存在同名 repeat job 则跳过

**实现要点**：
```ts
import { Queue } from "bullmq";
import { redisConnection } from "../../config/redis.js";

const QUEUE_NAME = "opensky";
const JOB_NAME = "fetch-and-store";
const CRON_PATTERN = "0 * * * *"; // 每小时整点

export const openskyQueue = new Queue(QUEUE_NAME, { connection: redisConnection });

export async function registerOpenSkyJob(): Promise<void> {
  const repeatJobs = await openskyQueue.getRepeatableJobs();
  const exists = repeatJobs.some((job) => job.name === JOB_NAME);
  if (exists) {
    console.log("[OpenSkyQueue] Repeatable job already registered, skipping.");
    return;
  }
  await openskyQueue.add(JOB_NAME, {}, {
    repeat: { pattern: CRON_PATTERN },
    removeOnComplete: { count: 24 },   // 保留最近24条完成记录
    removeOnFail: { count: 5 },        // 保留最近5条失败记录
  });
  console.log("[OpenSkyQueue] Repeatable job registered:", CRON_PATTERN);
}
```

**注意**：
- `removeOnComplete/removeOnFail` 防止 Redis 无限增长
- 不重试：`attempts` 默认为 1

---

## Step 6：BullMQ Worker — 消费并执行入库

**文件**：`api/src/modules/opensky/worker.ts`

**职责**：
- 创建 `Worker('opensky', processor)`
- Processor 逻辑：
  1. 调用 `getToken()` 获取 access_token
  2. 调用 `fetchStates(token)` 获取数据
  3. 将 OpenSky 数组映射为 `NewAircraftCurrentState[]`
  4. 调用 `replaceAll(states)` 事务入库
  5. 记录日志

**映射逻辑**（OpenSky 数组 → 表字段）：

```ts
function mapStateVector(row: unknown[]): typeof aircraftCurrentStates.$inferInsert {
  return {
    icao24: String(row[0]).trim().toLowerCase(),
    callsign: row[1] ? String(row[1]).trim() || null : null,
    originCountry: row[2] ? String(row[2]) : null,
    longitude: typeof row[5] === "number" ? row[5] : null,
    latitude: typeof row[6] === "number" ? row[6] : null,
    baroAltitude: typeof row[7] === "number" ? row[7] : null,
    onGround: Boolean(row[8]),
    velocity: typeof row[9] === "number" ? row[9] : null,
    trueTrack: typeof row[10] === "number" ? row[10] : null,
    verticalRate: typeof row[11] === "number" ? row[11] : null,
    squawk: row[14] ? String(row[14]) : null,
    spi: Boolean(row[15]),
    positionSource: typeof row[16] === "number" ? row[16] : null,
    category: typeof row[17] === "number" ? row[17] : null,
    sourceTime: new Date(row[4] as number * 1000), // last_contact 作为 source_time
    updatedAt: new Date(),
    region: "",
    status: "",
  };
}
```

**Worker 进程入口**：`api/src/worker.ts`

```ts
import { openskyWorker } from "./modules/opensky/worker.js";

console.log("[Worker] Starting...");
// Worker 实例在 import 时已经创建，这里保持进程运行
process.once("SIGINT", () => { openskyWorker.close(); process.exit(0); });
process.once("SIGTERM", () => { openskyWorker.close(); process.exit(0); });
```

**注意**：
- Worker 需要独立的 DB + Redis 连接
- Worker 进程跑在 Docker Compose 的 `worker` 服务里
- 失败不重试：job 抛异常后 BullMQ 默认标记为 failed，等下一小时新 job

---

## Step 7：API 启动时注册 Job

**目标**：修改 `api/src/index.ts`，启动时调用 `registerOpenSkyJob()`。

**修改点**：
```ts
import { registerOpenSkyJob } from "./modules/opensky/queue.js";

// 在 app.listen 之前
await registerOpenSkyJob();
```

**注意**：
- `registerOpenSkyJob()` 是幂等的，多实例安全
- 不阻塞服务启动（如果 Redis 不可用，打印 warning 但继续启动）

---

## Step 8：Docker / 环境配置

**目标**：确保 worker 容器能正确启动并消费队列。

**检查点**：
1. `api/package.json` 已有 `bullmq` 依赖 ✓
2. `docker-compose.yaml` 已有 `worker` 服务定义 ✓
3. 需要确认 `docker/Dockerfile` 的 `worker` target 是否指向正确的入口

**可能需要修改**：
- `docker/Dockerfile` 的 worker stage CMD 应该运行 `node dist/worker.js`
- 环境变量：确保 worker 服务有 `DATABASE_URL` 和 `REDIS_URL`

**新增环境变量**（可选）：
```env
OPENSKY_CLIENT_ID=
OPENSKY_CLIENT_SECRET=
```

---

## Step 9：验证

### 9.1 本地验证（不启动 worker）

手动 enqueue 一个 job，验证队列能正确接收：

```ts
// 临时测试脚本
import { openskyQueue } from "./modules/opensky/queue.js";
await openskyQueue.add("fetch-and-store", {}, { jobId: "test-1" });
console.log("Job enqueued");
```

### 9.2 Worker 消费验证

启动 worker，观察是否能：
1. 成功获取 token
2. 成功获取 states
3. 事务内 DELETE + INSERT
4. 记录成功日志

### 9.3 Skill 查询验证

通过 skill 的 `QueryDatabase` 或 `RunSqlReadOnly` 查询：
```sql
SELECT COUNT(*) FROM aircraft_current_states;
```

确认数据存在且 `latitude`/`longitude` 有值。

### 9.4 定时验证

观察一小时后是否有新 job 自动生成并执行。

---

## 实施顺序

| 顺序 | 步骤 | 涉及文件 | 阻塞后续？ |
|------|------|---------|----------|
| 1 | Schema + Migration | `schema.ts`, `migrations/` | 是 |
| 2 | OpenSky Client | `modules/opensky/client.ts` | 否 |
| 3 | Repository | `modules/opensky/repository.ts` | 是 |
| 4 | Queue | `modules/opensky/queue.ts` | 否 |
| 5 | Worker | `modules/opensky/worker.ts`, `worker.ts` | 否 |
| 6 | API 注册 | `index.ts` | 否 |
| 7 | Docker | `Dockerfile` | 否 |
| 8 | 验证 | 测试 | - |

**依赖关系**：Step 1 → Step 3 → Step 5；Step 2 可并行；Step 4/6 可并行。

---

## 风险与后续

| 风险 | 说明 | 缓解 |
|------|------|------|
| OpenSky API 限流 | 每小时请求一次通常不会触发，但需监控 | 观察日志，必要时加 backoff |
| 事务锁竞争 | DELETE+INSERT 事务期间锁表，skill 查询等待 | 数据量小（~10k 行），INSERT 毫秒级，影响可忽略 |
| Worker 进程挂掉 | 无人消费 job | Docker restart policy + 监控 |
| 多 API 实例重复注册 | 每个实例都调用 `registerOpenSkyJob()` | 幂等检查已处理 |
| region / status 后续扩展 | 当前留空，后续可能需要填充 | 表结构已预留字段， ALTER TABLE 即可 |
