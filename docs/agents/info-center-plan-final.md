# 信息中心（Info Center）最终方案

> 基于用户确认的 5 项决策编制：
> 1. 不需要未读字段；
> 2. 任务不作为表格行，仅作为事件/洞察的关联展示；
> 3. 复用现有接口（列表聚合接口新建，详情及任务链路复用已有接口）；
> 4. 实时推送新数据；
> 5. 支持导出功能。

---

## 一、数据流与链路

```
用户提问 → POST /tasks → Dify Planner 生成 Plan → Executor 执行 task_steps
                                                          │
                                    ┌─────────────────────┼─────────────────────┐
                                    ▼                     ▼                     ▼
                               每步完成写入          全部完成后生成         订阅任务触发
                               events 表            insights 表           同样链路
                                    │                     │
                                    └──────────┬──────────┘
                                               ▼
                                    信息中心 (Info Center)
                                    - 表格聚合展示
                                    - 详情关联任务链路
                                    - 实时推送 + 导出
```

**核心表关系**：
- `events`：`agentTaskId` → `tasks.id`，`taskId` → `job_tasks.id`
- `insights`：`agentTaskId` → `tasks.id`
- `tasks`：含 `query`（原始需求）、`plan`、`steps`
- `job_tasks`：前端任务卡片，含 `name`（任务名）

---

## 二、表格数据模型

### 2.1 统一返回模型 `InfoItem`

后端 `GET /info-center` 聚合 `events` + `insights` 两表，返回统一结构：

```typescript
interface InfoItem {
  id: string;
  itemType: 'event' | 'insight';
  title: string;
  summary: string;           // 截断摘要
  status: string;            // 见统一状态映射
  category?: string;         // insight 专用（geopolitics/military/industry）
  sourceTaskId?: string;     // 关联 job_task ID
  sourceTaskName?: string;   // 关联任务名称（来自 job_tasks.name）
  agentTaskId?: string;      // 关联 agent task ID
  timestamp: string;         // ISO 8601
  meta?: {
    dataCount?: number;      // event 专用：数据条数
    gisEnabled?: boolean;    // 是否含 GIS 数据
  };
}
```

### 2.2 统一状态映射（筛选用）

| 原始表 | 原始字段值 | 统一 status |
|--------|-----------|-------------|
| events | `success` | `success` |
| events | `partial` | `partial` |
| events | `failed` | `failed` |
| insights | `high` | `high_risk` |
| insights | `medium` | `medium_risk` |
| insights | `low` | `low_risk` |
| insights | `safe` | `safe` |

### 2.3 表格列设计

| 列名 | 宽度 | 说明 |
|------|------|------|
| 类型 | 80px | 图标标签：事件 / 洞察 |
| 标题 | 弹性 | 可点击，hover 高亮 `#00E0FF` |
| 关联任务 | 160px | `sourceTaskName`，点击可筛选该任务下全部信息 |
| 状态 | 100px | 带颜色标签（成功 `#44FF44` / 失败 `#FF4444` / 高危 `#FF4444` 等） |
| 分类 | 100px | 仅洞察显示（地缘 / 军事 / 产业） |
| 时间 | 140px | `MM-DD HH:mm` |
| 数据量 | 80px | 仅事件显示 |
| 操作 | 120px | 【详情】【GIS查看（如有）】 |

---

## 三、API 接口设计

### 3.1 新增聚合列表接口

```
GET /info-center?page=1&pageSize=20&type=event,insight&status=success,high_risk&startTime=...&endTime=...&taskId=...&search=...
```

**Query 参数**：

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `page` | number | 1 | 页码 |
| `pageSize` | number | 20 | 每页条数，最大 100 |
| `type` | string | `event,insight` | 逗号分隔筛选类型 |
| `status` | string | — | 逗号分隔，见统一状态映射 |
| `startTime` | ISO string | — | 起始时间（含） |
| `endTime` | ISO string | — | 结束时间（含） |
| `taskId` | UUID | — | 关联 job_task ID 精确筛选 |
| `search` | string | — | 对 `title`、`summary` 模糊匹配（大小写不敏感） |

**Response**：

```json
{
  "items": [
    {
      "id": "uuid",
      "itemType": "event",
      "title": "南海海域船舶监测结果",
      "summary": "发现 12 艘可疑船舶，其中 3 艘处于静默航行状态...",
      "status": "success",
      "sourceTaskId": "job-task-uuid",
      "sourceTaskName": "每日态势日报",
      "agentTaskId": "agent-task-uuid",
      "timestamp": "2026-05-14T08:30:00Z",
      "meta": { "dataCount": 12, "gisEnabled": true }
    },
    {
      "id": "uuid",
      "itemType": "insight",
      "title": "南海地缘风险评估",
      "summary": "综合研判显示当前海域存在中等地缘政治风险...",
      "status": "high_risk",
      "category": "geopolitics",
      "sourceTaskId": "job-task-uuid",
      "sourceTaskName": "每日态势日报",
      "agentTaskId": "agent-task-uuid",
      "timestamp": "2026-05-14T08:35:00Z",
      "meta": {}
    }
  ],
  "total": 156,
  "page": 1,
  "pageSize": 20
}
```

**后端实现策略**：

Drizzle ORM 目前对 UNION 的支持有限（要求 select 字段严格对齐），建议实现方式：

```typescript
// api/src/modules/info-center/service.ts
async function getInfoCenterItems(params: InfoCenterQuery) {
  const { page, pageSize, type, status, startTime, endTime, taskId, search } = params;
  const offset = (page - 1) * pageSize;

  // 分别查询，内存合并排序（数据量 < 1万时性能足够）
  const promises: Promise<InfoItem[]>[] = [];

  if (type.includes('event')) {
    promises.push(
      db.select({
        id: events.id,
        itemType: sql<string>`'event'`,
        title: events.title,
        summary: events.content,
        status: events.status,
        sourceTaskId: events.taskId,
        sourceTaskName: jobTasks.name,    // 需要 join job_tasks
        agentTaskId: events.agentTaskId,
        timestamp: events.timestamp,
        meta: sql`jsonb_build_object('dataCount', 0, 'gisEnabled', ${events.gisData} IS NOT NULL)`,
      })
      .from(events)
      .leftJoin(jobTasks, eq(events.taskId, jobTasks.id))
      .where(buildEventWhere({ status, startTime, endTime, taskId, search }))
      .then(rows => rows.map(normalizeEventRow))
    );
  }

  if (type.includes('insight')) {
    promises.push(
      db.select({
        id: insights.id,
        itemType: sql<string>`'insight'`,
        title: insights.title,
        summary: insights.summary,
        status: insights.riskLevel,
        category: insights.category,
        sourceTaskId: sql<null>`NULL`,   // insights 无直接 taskId，需从 agentTaskId 反查
        sourceTaskName: jobTasks.name,    // join tasks → job_tasks
        agentTaskId: insights.agentTaskId,
        timestamp: insights.createdAt,
        meta: sql<null>`NULL`,
      })
      .from(insights)
      .leftJoin(tasks, eq(insights.agentTaskId, tasks.id))
      .leftJoin(jobTasks, eq(tasks.id, jobTasks.agentTaskId))
      .where(buildInsightWhere({ status, startTime, endTime, taskId, search }))
      .then(rows => rows.map(normalizeInsightRow))
    );
  }

  const allItems = (await Promise.all(promises)).flat();

  // 统一按时间倒序
  allItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // 内存分页
  const total = allItems.length;
  const items = allItems.slice(offset, offset + pageSize);

  return { items, total, page, pageSize };
}
```

> **性能备注**：当前展示层数据量通常在数千条以内，内存合并排序可行。若未来数据量 > 5万条，需改为数据库 VIEW + 游标分页。

### 3.2 复用现有详情接口

**不新建统一详情接口**，前端根据 `itemType` 路由：

| itemType | 调用接口 | 说明 |
|----------|---------|------|
| `event` | `GET /events/:id` | 现有接口，返回完整 event 含 `gisData` |
| `insight` | `GET /insights/:id` | 现有接口，返回完整 insight 含 `content`、`sources` |

**前端适配层**：

```typescript
// src/lib/api.ts
export async function getInfoDetail(itemType: 'event' | 'insight', id: string) {
  if (itemType === 'event') return getEventById(id);
  return getInsightById(id);
}
```

### 3.3 任务链路追溯接口（复用现有）

详情面板中的"任务执行链路"调用：

```
GET /tasks/:agentTaskId
```

返回结构（现有）：
```json
{
  "taskId": "uuid",
  "status": "completed",
  "query": "分析南海态势",
  "plan": { "goal": "...", "steps": [...] },
  "steps": [
    { "id": "uuid", "actionType": "maritime", "status": "completed", "result": {...} }
  ]
}
```

前端用 `task.query` 展示"原始需求"，用 `steps[]` 渲染执行时间线。

### 3.4 实时推送方案

信息中心在新标签页独立运行，需要感知新数据到达。**复用现有 SSE 机制**：

**方案 A：复用任务 SSE（推荐）**

现有 `useRightPanel` 已建立 SSE 连接监听任务完成：
```
EventSource('http://localhost:3001/tasks/:taskId/stream')
```

信息中心页面可扩展为：
1. 页面加载时先 `GET /info-center` 获取当前列表
2. 同时查询当前正在运行的 `job_tasks`（`status = 'running'`）
3. 对每个 running 的 jobTask，获取其 `agentTaskId`，建立 SSE 连接
4. SSE 收到 `type: 'completed' | 'subscription_completed'` 时，自动刷新列表

**前端轮询兜底**：
```typescript
// 无论 SSE 是否连通，每 5s 轮询一次
const interval = setInterval(() => {
  refetchInfoCenter();
}, 5000);
```

> 说明：SSE 负责"任务完成瞬间刷新"，轮询负责兜底和补偿。与现有 RightPanel 机制完全一致。

### 3.5 导出接口

```
GET /info-center/export?format=csv&startTime=...&endTime=...&type=...&status=...&search=...
```

**参数**：与列表查询参数一致（不含 page/pageSize，导出全部匹配数据）。

**Response**：`Content-Type: text/csv; charset=utf-8`，`Content-Disposition: attachment; filename="info-center-export.csv"`

**CSV 列**：类型、标题、关联任务、状态、分类、时间、数据量、摘要

**后端实现**：
```typescript
// 查询全部匹配数据（无分页），流式写入 CSV
const items = await getAllInfoCenterItems(params);
res.setHeader('Content-Type', 'text/csv; charset=utf-8');
res.setHeader('Content-Disposition', 'attachment; filename="info-center-export.csv"');
// 写入 BOM + header + rows
```

---

## 四、前端页面结构

### 4.1 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/lib/api.ts` | 修改 | 新增 `getInfoCenterItems`、`getInfoCenterExport`、`getInfoDetail` |
| `src/app/info-center/page.tsx` | 重写 | 主页面：表格 + 筛选 + 分页 + SSE/轮询 |
| `src/components/info-center/InfoTable.tsx` | 新增 | 表格组件（shadcn Table） |
| `src/components/info-center/InfoFilters.tsx` | 新增 | 筛选栏 |
| `src/components/info-center/InfoPagination.tsx` | 新增 | 分页组件 |
| `src/components/info-center/InfoDetail.tsx` | 新增 | 详情 Drawer |
| `src/components/info-center/TaskTrace.tsx` | 新增 | 任务执行链路时间线 |
| `src/components/info-center/useInfoCenterStream.ts` | 新增 | SSE + 轮询组合 hook |

### 4.2 页面布局

```
┌─────────────────────────────────────────────────────────────────────┐
│ Header: ← 返回    信息中心    [搜索框________]    [导出▼]          │
├─────────────────────────────────────────────────────────────────────┤
│ Filters: [类型: 全部▼] [状态: 全部▼] [时间: 近7天▼] [任务: 全部▼] │
├─────────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────────────────┐ │
│ │ 类型 │ 标题           │ 关联任务     │ 状态   │ 时间   │ 操作  │ │
│ ├──────┼────────────────┼──────────────┼────────┼────────┼───────┤ │
│ │ 事件 │ 南海船舶监测   │ 态势日报     │ 成功   │ 08:30  │ 详情  │ │
│ │ 洞察 │ 地缘风险评估   │ 态势日报     │ 高危   │ 08:35  │ 详情  │ │
│ └────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│ Footer:  ←  1 2 3 ... 8  →     共 156 条    每页 20 ▼            │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.3 详情 Drawer

点击行或【详情】后，右侧滑出 Drawer（宽度 600px，桌面端）：

**Header**：标题 + 关闭按钮
**内容区**：
1. **元信息卡片**：类型标签、状态标签、时间、关联任务（点击跳转该任务筛选）
2. **完整内容**：event.content / insight.summary + insight.content
3. **GIS 数据区**（仅 event 且 `gisData` 存在）：
   - 展示 entities/trajectories/regions 统计（如 "12 艘船舶，3 条轨迹"）
   - 【在主页面地图查看】按钮（通过 `window.opener?.postMessage` 或 URL 回传）
4. **任务执行链路区**（TaskTrace）：
   ```
   原始需求: "分析南海态势"
   ├─ [已完成] 船舶数据采集 (maritime)     08:12
   ├─ [已完成] 新闻情报检索 (news)         08:15
   ├─ [已完成] 天气数据获取 (weather)      08:18
   └─ [已完成] 综合洞察生成 (insight)      08:20
   ```
   - 点击每个 step 可展开查看 `result` 摘要
5. **来源信息**（仅 insight）：`sources` 列表

### 4.4 与主页面联动（可选增强）

信息中心新标签页点击【在地图查看】时：

```typescript
// 方案：window.opener postMessage
function focusOnMainMap(gisData: GisData) {
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage({
      type: 'info-center:focus-gis',
      payload: gisData,
    }, window.location.origin);
  }
}
```

主页面 `page.tsx` 监听 message：
```typescript
useEffect(() => {
  const handler = (e: MessageEvent) => {
    if (e.data?.type === 'info-center:focus-gis') {
      // 将 GIS 数据 push 到 activeGisDataList，自动定位
      handleGisDataRequest(e.data.payload);
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}, []);
```

> 如主页面已被刷新或 `window.opener` 不可用，降级为提示用户手动切换标签页。

---

## 五、后端模块设计

### 5.1 新增目录结构

```
api/src/modules/info-center/
├── service.ts        # 聚合查询 + 导出 CSV 逻辑
├── controller.ts     # Express handlers
├── routes.ts         # 路由注册
└── types.ts          # 类型定义
```

### 5.2 注册路由

修改 `api/src/index.ts`（或统一路由注册文件）：
```typescript
import infoCenterRoutes from './modules/info-center/routes.js';
app.use('/info-center', infoCenterRoutes);
```

### 5.3 现有模块零改动清单

| 模块 | 是否改动 | 说明 |
|------|---------|------|
| `api/src/modules/events/` | ❌ 不改 | 复用 `service.getEventById` |
| `api/src/modules/insights/` | ❌ 不改 | 复用 `service.getInsightById` |
| `api/src/modules/tasks/` | ❌ 不改 | 复用 `service.getTaskWithSteps` |
| `api/src/modules/jobs/` | ❌ 不改 | 复用 `service.getJobTasks` / `getJobTaskById` |
| `api/src/db/schema.ts` | ❌ 不改 | 零 schema 变更 |

---

## 六、实施阶段

### 第一阶段：后端聚合接口 + 前端表格（核心可用）

1. **后端**：
   - 创建 `api/src/modules/info-center/service.ts`：实现 `getInfoCenterItems`（聚合 events + insights，内存排序分页）
   - 创建 `controller.ts` + `routes.ts`
   - 注册路由
2. **前端**：
   - `src/lib/api.ts` 新增 `getInfoCenterItems`
   - 重写 `info-center/page.tsx`：表格 + 筛选 + 分页
   - 新增 `InfoTable.tsx`、`InfoFilters.tsx`

**工期**：1.5 天

### 第二阶段：详情 + 任务链路 + 导出

1. **前端详情**：
   - 新增 `InfoDetail.tsx` Drawer
   - 复用现有 `getEventById` / `getInsightById`
   - 新增 `TaskTrace.tsx`，调用 `GET /tasks/:agentTaskId`
2. **导出**：
   - 后端 `service.ts` 新增 `exportInfoCenterToCSV`
   - 前端新增导出按钮（`GET /info-center/export`）

**工期**：1 天

### 第三阶段：实时推送

1. 前端新增 `useInfoCenterStream.ts`：
   - 页面加载时查询 running 任务列表
   - 对每个 running task 建立 SSE 连接
   - 收到 completed 事件后 `refetchInfoCenter()`
   - 兜底 5s 轮询

**工期**：0.5 天

**总工期**：约 3 天

---

## 七、风险评估与回退

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 聚合查询数据量大导致慢 | 列表加载 > 3s | 增加数据库索引（`events.timestamp`、`insights.created_at`），必要时加 Redis 缓存 |
| SSE 连接数过多 | 浏览器并发限制 | 单页面内合并 SSE 为 1 个（通过服务端支持多 task 订阅）或仅用轮询 |
| events/insights ID 冲突 | 理论上 UUID v4 冲突概率极低 | 前端始终携带 `itemType` 参数，不依赖 ID 唯一性 |
| 导出大数据量内存溢出 | CSV 生成时 Node OOM | 流式写入（`res.write` 逐行），或限制单次导出最多 5000 条 |

**回退方案**：若聚合接口实现困难，可降级为前端同时请求 `/events` 和 `/insights`，内存合并后展示。失去后端分页/搜索能力，但页面仍可运行。
