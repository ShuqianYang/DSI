# Issue: Agent Loop 分支后端路由大量缺失

> **优先级**: P0（阻塞合并）  
> **关联**: [合并阻塞项汇总](agent-loop-merge-blockers.md)

---

## 问题描述

agent-loop 分支的 `api/src/index.ts` 仅注册了 3 个路由入口：

```typescript
app.use("/tasks", taskRoutes);
app.get("/sse/global", ...);
app.get("/health", ...);
```

前端代码（`src/lib/api.ts`）调用的所有其他接口均返回 **404**。

---

## 缺失路由清单

### 任务/执行模块

| 前端调用 | 方法 | 路径 | 当前状态 |
|---|---|---|---|
| `getTasks()` | GET | `/jobs` | ❌ 404 |

### 事件模块

| 前端调用 | 方法 | 路径 | 当前状态 |
|---|---|---|---|
| `getEvents()` | GET | `/events` | ❌ 404 |
| `getEvent(id)` | GET | `/events/:id` | ❌ 404 |
| `updateEvent(id)` | PUT | `/events/:id` | ❌ 404 |
| `deleteEvent(id)` | DELETE | `/events/:id` | ❌ 404 |

### 订阅模块

| 前端调用 | 方法 | 路径 | 当前状态 |
|---|---|---|---|
| `getSubscriptions()` | GET | `/subscriptions` | ❌ 404 |
| `updateSubscription(id)` | PUT | `/subscriptions/:id` | ❌ 404 |
| `deleteSubscription(id)` | DELETE | `/subscriptions/:id` | ❌ 404 |

### 洞察模块

| 前端调用 | 方法 | 路径 | 当前状态 |
|---|---|---|---|
| `getInsights()` | GET | `/insights` | ❌ 404 |
| `getInsight(id)` | GET | `/insights/:id` | ❌ 404 |

### 需求模块

| 前端调用 | 方法 | 路径 | 当前状态 |
|---|---|---|---|
| `getRequirements()` | GET | `/requirements` | ❌ 404 |

### AIS 数据模块

| 前端调用 | 方法 | 路径 | 当前状态 |
|---|---|---|---|
| `getAisData()` | GET | `/ais/data` | ❌ 404 |
| `getAisGeoJson()` | GET | `/ais/geojson` | ❌ 404 |
| `getAisShipdtArea()` | GET | `/ais/shipdt-area` | ❌ 404 |

### ADS-B 数据模块

| 前端调用 | 方法 | 路径 | 当前状态 |
|---|---|---|---|
| `getAdsData()` | GET | `/ads/data` | ❌ 404 |
| `getAdsGeoJson()` | GET | `/ads/geojson` | ❌ 404 |

### 信息中心模块

| 前端调用 | 方法 | 路径 | 当前状态 |
|---|---|---|---|
| `getInfoCenterItems()` | GET | `/info-center` | ❌ 404 |
| `getInfoCenterExport()` | GET | `/info-center/export` | ❌ 404 |

### 卫星回调

| 用途 | 方法 | 路径 | 当前状态 |
|---|---|---|---|
| 卫星影像切片回调 | POST | `/agent/callback/slice` | ❌ 404 |

---

## 可用路由（agent-loop 分支）

| 前端调用 | 方法 | 路径 | 当前状态 |
|---|---|---|---|
| `createAgentTask()` | POST | `/tasks` | ✅ 正常 |
| `getTask(id)` | GET | `/tasks/:id` | ✅ 正常 |
| `startTaskSse()` | GET | `/tasks/:id/stream` | ✅ 正常 |
| 全局 SSE | GET | `/sse/global` | ✅ 正常 |
| 健康检查 | GET | `/health` | ✅ 正常 |

---

## 根因分析

agent-loop 分支在重构过程中，为了最小化入口，从 `api/src/index.ts` 中移除了所有非核心路由注册：

```typescript
// main 分支存在，agent-loop 分支缺失：
app.use("/jobs", jobRoutes);
app.use("/events", eventRoutes);
app.use("/subscriptions", subscriptionRoutes);
app.use("/requirements", requirementRoutes);
app.use("/insights", insightRoutes);
app.use("/ais", aisRoutes);
app.use("/ads", adsRoutes);
app.use("/info-center", infoCenterRoutes);
app.use("/agent/callback", agentCallbackRoutes);
```

对应的 route 文件可能还在磁盘上（`api/src/modules/*/routes.ts`），但没有被 `index.ts` 引用。

---

## 修复方案

### 方案 A：从 main 恢复全部路由（短期最快）

将 main 分支 `index.ts` 中的路由注册代码复制回 agent-loop 分支：

```typescript
import jobRoutes from "./modules/jobs/routes.js";
import eventRoutes from "./modules/events/routes.js";
// ... 其他 import

app.use("/jobs", jobRoutes);
app.use("/events", eventRoutes);
// ... 其他注册
```

**优点**：快，前端立即可用  
**缺点**：保留大量旧代码，与 Agent Loop 理念不符

### 方案 B：逐个模块评估，只恢复必要的（推荐）

按优先级恢复：
1. **P0**: `/jobs`, `/events`, `/ais/data`, `/ads/data`（核心展示数据）
2. **P1**: `/subscriptions`, `/requirements`, `/insights`（管理功能）
3. **P2**: `/info-center`, `/agent/callback/slice`（低频功能）

每个模块恢复时评估：是否用 Agent Loop 重写，还是直接用旧实现。

---

## 验收标准

- [ ] 前端右侧面板所有列表页能正常加载数据（至少不 404）
- [ ] 前端地图组件能获取 AIS/ADS-B 数据
- [ ] 卫星回调接口可用
- [ ] `api/src/index.ts` 有清晰注释说明哪些路由是旧架构保留、哪些是 Agent Loop 新增
