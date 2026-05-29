# 信息中心（Info Center）页面改造方案

## 一、当前系统链路梳理

```
用户提问 (Dashboard ChatPanel)
    │ POST /tasks { query }
    ▼
┌──────────────────────────────────────┐
│  Agent 编排任务表 (tasks)             │
│  - id, query, status, plan, actions  │
└──────────────────────────────────────┘
    │
    ▼ 任务规划 (planner/service.ts)
调用 Dify Planner API → 生成 Plan（含 steps/subtasks）
    │
    ▼ 任务执行 (executor/service.ts)
遍历 taskSteps，调用 actionsService.execute(action)
    │
    ├── 执行中：SSE 推送 step_update / progress 到前端
    │
    ├── 每步完成：writeDisplayData() 写入展示层
    │
    └── 全部完成：generateInsights() 生成洞察入库
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│  展示层数据表（RightPanel 数据源）                              │
│  ─────────────────────────────                                │
│  job_tasks  可执行任务（日报/周报/实时）                        │
│  events     事件列表（单步执行结果产生的事件）                  │
│  insights   AI 洞察（综合研判结果）                           │
│  subscriptions 订阅任务                                       │
│  requirements  定制需求                                       │
└──────────────────────────────────────────────────────────────┘
    │
    ▼ 前端轮询 (useRightPanelData, 5s 间隔)
GET /jobs /events /insights /subscriptions /requirements
    │
    ▼
RightPanel 展示（即时任务 / 订阅任务 / 定制需求）
└── 常驻区域：信息列表 (EventList) + 洞察列表 (InsightList)
```

### 关键数据关系

| 表 | 关键字段 | 关联 |
|---|---|---|
| `tasks` | `id` (agentTaskId) | 核心编排任务 |
| `task_steps` | `taskId` → tasks.id | 执行步骤 |
| `job_tasks` | `agentTaskId` → tasks.id | 前端展示用的任务卡片 |
| `events` | `taskId` → job_tasks.id, `agentTaskId` → tasks.id | 单步事件 |
| `insights` | `agentTaskId` → tasks.id | 综合洞察 |

**结论**：一条用户提问 → 产生一个 `tasks` 记录 → 执行中产生多个 `task_steps` → 每步结果写入 `events` → 最终汇总生成 `insights`。`job_tasks` 是前端的"任务卡片"视图。

---

## 二、信息中心定位与数据聚合策略

### 2.1 定位

信息中心是**跨会话、跨任务的集中查询页面**，聚合以下三类信息：

1. **事件 (Event)**：任务执行过程中单步 action 产生的信息（如船舶查询结果、新闻检索结果、GIS 标绘结果）
2. **洞察 (Insight)**：任务全部执行完毕后，由 Dify 综合生成的研判结论
3. **任务 (JobTask)**：任务本身的执行记录和状态（可选展示，用于追溯根源）

### 2.2 聚合策略：后端 UNION 查询（推荐）

现有 `events` 和 `insights` 分属不同业务表，前端直接调两个接口做内存合并存在以下问题：
- 分页逻辑断裂（各表独立分页，无法全局排序）
- 筛选条件无法统一（events 有 `status`，insights 有 `riskLevel`）
- 搜索需要两次请求

**因此推荐在后端新增聚合接口**，将多表结果合并为统一的 `InfoItem` 视图返回。

---

## 三、表格结构设计

### 3.1 统一数据模型 `InfoItem`

```typescript
interface InfoItem {
  id: string;           // 原始记录 ID
  itemType: 'event' | 'insight' | 'job';
  title: string;
  summary: string;      // 截断后的内容摘要
  status: string;       // 统一状态映射（见下方）
  riskLevel?: string;   // insight 专用
  category?: string;    // insight 专用
  sourceTaskId?: string;    // 关联的 job_task ID
  sourceTaskName?: string;  // 关联任务名称
  agentTaskId?: string;     // 关联的 agent tasks ID
  timestamp: string;    // ISO 8601
  meta?: {
    dataCount?: number;
    gisData?: boolean;  // 是否包含 GIS 数据
    hasDetail?: boolean;
  };
}
```

### 3.2 状态映射（统一筛选）

| 原始类型 | 原始状态 | 统一状态 (status) |
|---|---|---|
| event | `success` | `success` |
| event | `partial` | `partial` |
| event | `failed` | `failed` |
| insight | `high` | `high_risk` |
| insight | `medium` | `medium_risk` |
| insight | `low` | `low_risk` |
| insight | `safe` | `safe` |
| job | `running` | `running` |
| job | `completed` | `completed` |
| job | `partial` | `partial` |
| job | `failed` | `failed` |

### 3.3 表格列设计

| 列名 | 宽度 | 说明 |
|---|---|---|
| 类型 | 80px | 图标 + 文字标签（事件/洞察/任务） |
| 标题 | 弹性 | 可点击，hover 高亮 |
| 关联任务 | 160px | 显示 sourceTaskName，点击可筛选 |
| 状态 | 100px | 带颜色标签 |
| 时间 | 140px | `MM-DD HH:mm` 格式 |
| 数据量 | 80px | 仅事件/任务显示 |
| 操作 | 100px | 【查看详情】按钮 |

### 3.4 筛选栏设计

- **类型筛选**：全部 / 事件 / 洞察 / 任务（多选）
- **状态筛选**：成功 / 部分成功 / 失败 / 高危 / 中危 / 低危 / 安全（根据类型动态显示）
- **时间范围**：近 1 小时 / 近 24 小时 / 近 7 天 / 自定义
- **关联任务**：下拉选择（从 `/jobs` 加载）
- **关键词搜索**：对 title + summary 做模糊匹配
- **仅未读**：checkbox（event 有 read 字段，insight 可扩展）

---

## 四、API 接口设计

### 4.1 新增聚合列表接口

```
GET /info-center?page=1&pageSize=20&type=event,insight&status=success,high_risk&startTime=...&endTime=...&taskId=...&search=...
```

**Query 参数**：
| 参数 | 类型 | 说明 |
|---|---|---|
| `page` | number | 默认 1 |
| `pageSize` | number | 默认 20，最大 100 |
| `type` | string | 逗号分隔：`event,insight,job` |
| `status` | string | 逗号分隔，见统一状态映射 |
| `startTime` | ISO string | 起始时间 |
| `endTime` | ISO string | 结束时间 |
| `taskId` | UUID | 关联的 job_task ID |
| `agentTaskId` | UUID | 关联的 agent task ID |
| `search` | string | 模糊搜索 title + summary |
| `unreadOnly` | boolean | 仅未读（仅对 event 生效） |

**Response**：
```json
{
  "items": [
    {
      "id": "uuid",
      "itemType": "event",
      "title": "南海海域船舶监测结果",
      "summary": "发现 12 艘可疑船舶，其中 3 艘...",
      "status": "success",
      "sourceTaskId": "uuid",
      "sourceTaskName": "每日态势日报",
      "agentTaskId": "uuid",
      "timestamp": "2026-05-14T08:30:00Z",
      "meta": { "dataCount": 12, "gisData": true }
    }
  ],
  "total": 156,
  "page": 1,
  "pageSize": 20
}
```

### 4.2 新增统一详情接口（推荐新增，也可复用现有）

> 现有 `/events/:id` 和 `/insights/:id` 已能查单条，但返回结构不同。为保持前端一致性，建议新增统一详情接口。

```
GET /info-center/:id?type=event
```

**说明**：由于 events 和 insights 的 ID 空间可能冲突（都是 UUID v4），需要显式传入 `type` 参数，或后端通过 UNION 视图 + 类型前缀编码解决。推荐传 `type` 参数。

**Response**：
```json
{
  "id": "uuid",
  "itemType": "event",
  "title": "...",
  "content": "完整内容（不截断）",
  "status": "success",
  "timestamp": "...",
  "sourceTaskId": "uuid",
  "sourceTaskName": "每日态势日报",
  "agentTaskId": "uuid",
  "taskSteps": [
    { "id": "uuid", "actionType": "maritime", "status": "completed", "startedAt": "...", "completedAt": "..." }
  ],
  "gisData": { ... },
  "meta": { ... }
}
```

**替代方案（零后端改动）**：
前端根据 `itemType` 判断调用 `/events/:id` 或 `/insights/:id`，自行适配字段差异。缺点是需要维护两套详情解析逻辑。

### 4.3 标记已读接口（扩展）

```
PATCH /info-center/:id/read
Body: { "read": true }
```

后端根据记录类型路由到 `events` 或 `insights` 表的 update。

---

## 五、后端改动方案

### 5.1 最小改动方案（推荐第一阶段实施）

**不新增物理表，通过 Drizzle ORM 多表查询 + 内存合并实现聚合。**

新增文件：
```
api/src/modules/info-center/
├── service.ts      # 聚合查询逻辑
├── controller.ts   # Express controller
└── routes.ts       # 路由注册
```

**service.ts 核心逻辑**：

```typescript
// 伪代码
async function getInfoCenterItems(params) {
  const queries = [];
  if (includeEvent) {
    queries.push(
      db.select({ ...eventsFields, itemType: sql`'event'` })
        .from(events)
        .where(buildEventWhere(params))
    );
  }
  if (includeInsight) {
    queries.push(
      db.select({ ...insightsFields, itemType: sql`'insight'` })
        .from(insights)
        .where(buildInsightWhere(params))
    );
  }
  // UNION ALL，统一排序，分页
  const union = db.unionAll(...queries).orderBy(desc(timestamp)).limit(pageSize).offset(offset);
  return union;
}
```

**注意**：Drizzle ORM 的 `unionAll` 要求各 select 字段完全对齐，实际实现时可能需要选择公共字段子集。

**routes.ts 注册到主路由**（修改 `api/src/index.ts` 或对应 router）：
```typescript
app.use("/info-center", infoCenterRoutes);
```

### 5.2 可选优化：数据库 View

若数据量增大（>10万条），可在数据库层面创建 `info_center_view`：

```sql
CREATE OR REPLACE VIEW info_center_view AS
SELECT id, 'event' as item_type, title, content as summary, status, NULL as risk_level, ...
FROM events
UNION ALL
SELECT id, 'insight', title, summary, NULL, risk_level, ...
FROM insights;
```

优点：查询性能高，分页排序由数据库完成。
缺点：需要管理 migration。

---

## 六、前端改动方案

### 6.1 新增/修改文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `src/lib/api.ts` | 修改 | 新增 `getInfoCenterItems`, `getInfoCenterDetail` |
| `src/app/info-center/page.tsx` | 重写 | 从卡片列表改为表格 + 筛选 + 分页 |
| `src/components/info-center/InfoTable.tsx` | 新增 | 表格组件 |
| `src/components/info-center/InfoFilters.tsx` | 新增 | 筛选栏组件 |
| `src/components/info-center/InfoDetail.tsx` | 新增 | 详情 Drawer/Modal |
| `src/components/info-center/TaskTrace.tsx` | 新增 | 任务执行链路追溯（steps 时间线） |

### 6.2 页面布局

```
┌──────────────────────────────────────────────────────────────┐
│  Header: ← 返回  信息中心  [搜索框]                          │
├──────────────────────────────────────────────────────────────┤
│  筛选栏: [类型▼] [状态▼] [时间范围▼] [关联任务▼] [仅未读□]  │
├──────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐   │
│  │  类型 │ 标题      │ 关联任务 │ 状态   │ 时间   │ 操作 │   │
│  ├───────┼───────────┼──────────┼────────┼────────┼──────┤   │
│  │ 事件  │ 南海船舶..│ 态势日报 │ 成功   │ 08:30  │ 详情 │   │
│  │ 洞察  │ 地缘风险..│ 态势日报 │ 高危   │ 08:35  │ 详情 │   │
│  └──────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────┤
│  分页:  ←  1 2 3 ... 10  →    共 156 条                      │
└──────────────────────────────────────────────────────────────┘
```

### 6.3 详情面板设计

点击【详情】后，在当前页面右侧滑出 Drawer（桌面端）或弹出 Modal（移动端），包含：

- **基本信息**：类型、标题、状态、时间
- **内容区**：完整 content / summary + content
- **GIS 数据预览**（如 event 包含 gisData）：缩略图或【在地图中查看】按钮（点击唤起主页面并定位）
- **任务追溯区**：展示该信息所属的 Agent 任务执行链路
  ```
  用户提问: "分析南海态势"
    ├─ [已完成] 船舶数据采集 (maritime)
    ├─ [已完成] 新闻情报检索 (news)
    ├─ [已完成] 天气数据获取 (weather)
    └─ [已完成] 综合洞察生成 (insight)
  ```
- **数据来源**：如果是 insight，展示 sources 列表

### 6.4 与主页面联动（可选高级功能）

由于信息中心在新标签页打开，可通过 `window.opener` 或 URL 参数与主页面联动：
- 详情页点击【在地图中查看】→ `window.opener.postMessage({ type: 'gis-focus', data: gisData })`
- 或在主页面 URL 中传入参数：`/?focusEvent=xxx`，主页面监听 URL 变化自动定位

---

## 七、任务执行链路在信息中心的展示

这是用户特别关心的部分：

**链路查询逻辑**：
1. 信息详情接口返回 `agentTaskId`
2. 前端调用 `GET /tasks/:agentTaskId` 获取完整任务（含 steps）
3. 结合 `job_tasks` 的 `subTasks` 展示友好的时间线

**展示内容**：
| 节点 | 来源 |
|---|---|
| 原始需求 | `tasks.query` |
| 任务规划 | `tasks.plan.goal` + `plan.steps[]` |
| 执行步骤 | `tasks.steps[]` (actionType, status, startedAt, completedAt) |
| 产生的事件 | `events` 表中该 `agentTaskId` 下的记录 |
| 最终洞察 | `insights` 表中该 `agentTaskId` 下的记录 |

---

## 八、影响范围评估

### 8.1 后端影响

| 模块 | 影响 | 说明 |
|---|---|---|
| `api/src/db/schema.ts` | 无变更 | 复用现有表 |
| `api/src/modules/info-center/` | 新增 | 聚合查询服务、controller、路由 |
| `api/src/index.ts` | 修改 | 注册 `/info-center` 路由 |
| `api/src/modules/events/` | 无变更 | 复用现有 service 的 `getEventById` |
| `api/src/modules/insights/` | 无变更 | 复用现有 service 的 `getInsightById` |
| `api/src/modules/tasks/` | 无变更 | 详情接口已提供 `GET /tasks/:id` |

### 8.2 前端影响

| 模块 | 影响 | 说明 |
|---|---|---|
| `src/app/info-center/page.tsx` | **重写** | 从卡片列表改为表格 + 筛选 + 分页 |
| `src/lib/api.ts` | 修改 | 新增 2~3 个接口函数 |
| `src/components/UserCenter.tsx` | 无变更 | 已存在跳转入口 |
| `src/components/right-panel/*` | 无变更 | 右侧栏不受影响 |
| `src/types/prd.ts` | 可选扩展 | 可新增 `InfoItem` 类型定义 |

### 8.3 数据库影响

- **零 schema 变更**，复用现有 `events`、`insights`、`job_tasks`、`tasks`、`task_steps` 表。
- 如后续数据量大，可再考虑新增 `info_center_view` 物化视图。

### 8.4 兼容性影响

- 现有 `/events`、`/insights` 接口保持不动，RightPanel 不受影响。
- 信息中心页面独立运行，与 Dashboard 主页面解耦。

---

## 九、实施建议（分阶段）

### 第一阶段：MVP（核心功能）

**目标**：可用的新标签页表格 + 详情

1. 后端：新增 `GET /info-center` 聚合列表接口（支持 type/status/time/page 筛选）
2. 后端：新增 `GET /info-center/:id?type=` 统一详情接口
3. 前端：重写 `info-center/page.tsx` 为表格 + 筛选 + 分页
4. 前端：新增详情 Drawer，展示完整内容

**工期预估**：1~2 天

### 第二阶段：任务链路追溯

1. 前端：详情面板新增「任务执行链路」时间线组件
2. 前端：调用 `GET /tasks/:agentTaskId` 获取 steps 并渲染
3. 前端：GIS 数据预览（如有）

**工期预估**：0.5~1 天

### 第三阶段：高级筛选与联动

1. 后端：支持 `search` 关键词搜索（title + summary 模糊匹配）
2. 前端：关联任务下拉筛选（从 `/jobs` 加载）
3. 跨页面联动：信息中心点击【在地图查看】→ 主页面自动定位

**工期预估**：1 天

---

## 十、待确认事项

1. **洞察表是否需要 `read` 字段？** 现有 `events` 有 `read` boolean，`insights` 没有。信息中心如果要做"未读"筛选和标记，需要给 `insights` 新增 `read` 字段，或在前端通过本地状态模拟。
2. **job_tasks 是否需要纳入信息中心？** 当前方案建议纳入，作为"任务执行记录"类型。如果不纳入，仅聚合 event + insight 即可。
3. **统一详情接口 vs 复用现有接口**：前者代码更整洁，后者后端改动更小。请确认倾向。
4. **表格是否需要导出功能？**（如导出 Excel / CSV）
5. **是否需要实时推送？** 信息中心新标签页是否需要通过 SSE 或轮询实时更新数据？
