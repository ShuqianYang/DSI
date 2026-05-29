# ADR-0001: 项目架构现状评审

- **日期**: 2026-04-27
- **状态**: Accepted（作为基线记录，后续重构以此为参照）
- **作者**: Claude Code (Sonnet 4.6)

---

## 背景

本项目为"数智融合智能体平台"，是一个以 AI Agent 编排为核心、基于多元数据融合的一站式信息服务应用。

技术栈概览：
- 前端：Next.js 16 + React 19 + Tailwind CSS 4 + react-globe.gl
- 后端：Express 5 + TypeScript
- 数据库：PostgreSQL 16 + Drizzle ORM
- 缓存/队列：Redis 7 + BullMQ
- AI 服务：Dify API（外部 LLM Agent 服务）
- 包管理：pnpm 9 workspace (monorepo)

---

## 决策

当前架构在 MVP 阶段是**合理的**（7/10），核心链路设计正确，但存在可预期的技术债务。

---

## 分层架构评价

### 优势

| 层面 | 设计 | 评价 |
|------|------|------|
| 前后端分离 | Next.js (前端) + Express (后端 API) | 正确，职责清晰 |
| monorepo | pnpm workspace + `packages/shared` | 正确，共享类型避免前后端漂移 |
| 数据库层 | Drizzle ORM + 迁移文件 | 正确，类型安全 |
| 队列层 | BullMQ + 独立 Worker 进程 | 正确，任务异步执行不阻塞 API |
| AI 层 | Dify 外部服务 | 正确，LLM 推理不放在应用进程内 |

### 边界模糊点

1. **`api/src/index.ts` 承载了过多职责**：
   - Express 服务器启动
   - 路由注册
   - Redis Pub/Sub 订阅 + SSE 广播
   - 订阅调度器启动
   - AIS 位置更新定时器

   该文件既是"启动脚本"又是"运行时编排器"。Redis 订阅逻辑应移到专门的 `bootstrap/` 或 `listeners/` 模块。

2. **`api/src/modules/actions/capabilities/` 的粒度不均**：
   - `maritime.ts` 包含完整的船舶态势分析逻辑（300+ 行）
   - `intelligent_qa.ts` / `daily_report.ts` 较薄
   - 没有统一的 capability 接口约束（虽然 registry 注册了它们）

---

## Agent Pipeline 设计评价

### Pipeline 流程

```
Planner → Router → Executor → Actions → Insights
```

这是标准的 Agent 编排模式，与 LangChain / AutoGen 的设计思路一致。

### 问题

| 问题 | 位置 | 影响 |
|------|------|------|
| Planner/Router/Insight 各调不同的 Dify Agent | `api/src/lib/dify.ts` + 环境变量 | 维护成本高，三个 Agent 的提示词可能漂移 |
| Mock 模式硬编码在业务代码中 | `api/src/modules/planner/service.ts` 等 | 无法通过配置开关，Mock 与真实逻辑混编 |
| Plan → Action 的依赖解析在 Executor 中隐式处理 | `api/src/modules/executor/service.ts` | 缺乏显式的 DAG 验证，循环依赖可能崩溃 |
| Action 结果直接写入 events/subscriptions/insights 表 | `api/src/modules/executor/service.ts` | 数据写入分散，事务一致性难保证 |

### 建议

考虑将 Planner + Router 合并为一个 "Orchestrator" Agent，减少一次 LLM 调用延迟。或明确三层分工：
- **Planner**: 只输出 Goal + 高层步骤
- **Router**: 只输出工具列表（不修正意图）
- **Validator**: 验证 Plan 的可执行性（新增）

---

## 数据流评价

### 后端数据流

```
Executor → Redis Pub/Sub → API 实例 → SSE → 前端
```

该设计在**多实例部署**下可以工作：
- 所有 API 实例订阅同一 channel
- 每个实例只推送连接在自己上的 SSE 客户端
- 无需 sticky session

### 前端数据流问题

| 问题 | 已记录 |
|------|--------|
| ChatPanel 和 RightPanel 重复建立 SSE | `api/issues/sse-frontend-interaction-issues.md` |
| 无自动重连 | `api/issues/sse-frontend-interaction-issues.md` |
| 无心跳保活 | `api/issues/sse-frontend-interaction-issues.md` |

### API 设计问题

`api/src/index.ts:38` 存在明显的缩进错误：
```ts
app.use("/insights", insightRoutes);
  app.use("/ais", aisRoutes);  // 异常缩进
```

---

## 可扩展性评估

### 横向扩展

| 组件 | 是否支持水平扩展 | 说明 |
|------|-----------------|------|
| API 服务器 | 是 | 无状态，可任意副本 |
| Worker | 是 | BullMQ 天然支持多 Worker |
| PostgreSQL | 需外部方案 | 单点，需主从或读写分离 |
| Redis | 需外部方案 | 单点，需 Sentinel 或 Cluster |
| Dify | 是 | 外部服务，本项目无感知 |

### 新增 Capability

当前新增一种能力需要修改：
1. `api/src/modules/actions/capabilities/` 新增文件
2. `api/src/modules/actions/registry.ts` 注册
3. `packages/shared/src/types/action.ts` 新增 ActionType
4. 可能需修改前端 `formatTaskResult`

**建议**：Capability 应支持**动态注册**或**约定大于配置**。例如扫描 `capabilities/` 目录自动注册，ActionType 用字符串枚举而非联合类型。

---

## 技术选型评价

| 技术 | 评价 |
|------|------|
| Next.js 16 + App Router | 合理，但项目未使用 SSR/SSG 优势，所有页面都是 Client Component |
| Express 5 | 合理，API 服务器轻量够用 |
| Drizzle ORM | 合理，TypeScript 原生支持 |
| BullMQ | 合理，替代方案如 Temporal 更重 |
| react-globe.gl | 需关注性能，大数据量时可能卡顿 |
| Dify | 外部依赖，API 稳定性影响核心功能 |
| pnpm workspace | 合理 |

---

## 当前架构债务汇总

| 优先级 | 债务 | 文件位置 |
|--------|------|----------|
| P1 | 前端组件逻辑/UI 混杂 | `src/components/ChatPanel.tsx` / `RightPanel.tsx` |
| P1 | SSE 实现缺陷 | `api/src/sse/sseManager.ts` / `modules/tasks/routes.ts` / 前端组件 |
| P2 | API 入口文件职责过重 | `api/src/index.ts` |
| P2 | Mock 与真实逻辑混编 | `api/src/modules/planner/service.ts` / `router/service.ts` |
| P2 | 无全局错误/日志追踪 | 未找到 Sentry / OpenTelemetry 集成 |
| P3 | 硬编码颜色值分散在各组件 | 大量 `#00E0FF` / `#FF4444` 等 |
| P3 | Supabase 依赖冗余 | `package.json` 中有但未使用 |

---

## 总体评价

**合理性：7/10**

**优势**：
- Agent Pipeline 的分层设计（Planner/Router/Executor/Actions）思路正确，与业界主流方案对齐
- 队列 + Worker 分离保证了 API 响应性
- monorepo + 共享类型保证了前后端类型一致
- Redis Pub/Sub + SSE 的多实例推送方案设计正确

**劣势**：
- 前端代码质量明显落后于后端（组件臃肿、硬编码、无共享 Hook）
- 架构文档缺失（已补充 README，但缺少 ADR / 架构决策记录）
- 缺乏监控、日志、错误追踪基础设施
- 测试覆盖未知（未找到测试文件的实际运行证据）

**MVP 阶段**：架构合理，核心链路跑通。
**生产阶段**：需补充监控、完善前端重构、解决 SSE 可靠性、将 Mock 逻辑彻底剥离。

---

## 相关文档

- [前端组件重构计划](../api/issues/frontend-refactor-plan.md)
- [SSE 前端交互问题](../api/issues/sse-frontend-interaction-issues.md)
- [项目 README](../../README.md)

---

## 未知项

1. **BullMQ 任务失败的重试策略** — 未读取到 `api/src/queue/taskQueue.ts` 的完整重试配置
2. **数据库连接池配置** — `api/src/config/database.ts` 是否配置了 pool size？
3. **Dify Agent 的提示词版本管理** — `api/docs/` 下有提示词文档，但是否与线上 Dify 应用同步？
4. **是否有灰度/环境隔离** — dev/staging/prod 环境如何管理？
