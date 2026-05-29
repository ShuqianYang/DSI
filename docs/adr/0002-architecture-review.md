# ADR-0002: 项目架构演进评审（2026-05-23）

- **日期**: 2026-05-23
- **状态**: Accepted（基于 ADR-0001 的演进评估）
- **作者**: Claude Code (Opus 4.7)
- **前序**: [ADR-0001: 项目架构现状评审](./0001-architecture-review.md)

---

## 背景

自 ADR-0001（2026-04-27）以来，项目经历了显著的架构演进：
- 3D 可视化从 react-globe.gl 迁移到 CesiumJS
- AI 层从纯 Dify 扩展到 DeepSeek + Qwen + Tavily 多模型混合
- 新增 10+ 个 capability（地震评估、洪水评估、火情、油污溯源等）
- Executor 增加阻断校验与需求提报机制
- 前端进行了多轮组件拆分和交互优化

本 ADR 评估这些演进带来的架构变化、新增债务和已解决的问题。

---

## 技术栈演进

### 变更汇总

| 技术 | ADR-0001 状态 | 当前状态 | 评价 |
|------|--------------|---------|------|
| 3D 可视化 | react-globe.gl | **CesiumJS** | 正确迁移，功能更强大，但性能开销更大 |
| Planner/Router LLM | Dify | **DeepSeek API** | 正确，降低延迟，减少外部依赖 |
| 新增 LLM | 无 | **Qwen + Tavily** | 合理，多模型互补 |
| Mock 模式 | 硬编码混编 | **配置开关** | 部分改善，但仍有硬编码 |
| 数据源 | OpenSky + 本地 Mock | **+ ShipDT + AISStream** | 合理，数据更丰富 |

### Cesium 迁移评估

**优势**：
- 支持 2D/3D 切换、自定义底图、影像叠加、实体动画
- ImageryProvider 体系支持本地瓦片 + 网络底图混合
- Entity API 支持船舶 billboard、轨迹流动材质、脉冲环等复杂效果

**代价**：
- 包体积增大（Cesium 1.140 ~ 50MB+）
- 主线程计算压力大（CallbackProperty 每帧回调、大量 Entity 同步）
- 掉帧率 46.8%，需持续优化（见性能债务）

### AI 层演进

**从单模型到多模型混合**：

```
ADR-0001:  Dify (Planner + Router + Insight + Maritime + News)
当前:      DeepSeek (Planner + Router) + Dify (Insight/Maritime/News) + Qwen + Tavily
```

- **DeepSeek 替换 Planner/Router**：降低一次网络跳转延迟，提示词可控性更强
- **Qwen**：作为备用/补充模型
- **Tavily**：搜索增强，替代部分 Dify 搜索能力
- **Blockage-Analyzer**：新增模块，分析执行阻断原因并建议修复方案

---

## 模块架构演进

### 新增模块

| 模块 | 职责 | 位置 |
|------|------|------|
| **blockage-analyzer** | 执行阻断分析（依赖缺失、参数不匹配等） | `api/src/modules/blockage-analyzer/` |
| **requirements** | 天基信息服务需求提报管理 | `api/src/modules/requirements/` |
| **events** | 事件生命周期管理（CRUD） | `api/src/modules/events/` |
| **jobs** | 可执行任务管理（CRUD） | `api/src/modules/jobs/` |
| **subscriptions** | 订阅任务管理（CRUD） | `api/src/modules/subscriptions/` |
| **info-center** | 信息中心聚合查询 | `api/src/modules/info-center/` |
| **ads** | ADS-B 航空器数据接口 | `api/src/modules/ads/` |

### Capability 扩展

从 ADR-0001 的 7 个扩展到 **20+** 个：

**新增 capabilities**：
- `ais-fetch` — AIS 船舶数据获取
- `ais-match-suspects` — 嫌疑船匹配
- `ais-suspect-ranking` — 嫌疑船排序
- `oil-drift` — 油污漂移溯源
- `earthquake-evaluation` — 地震灾后评估
- `flood-evaluation` — 洪水灾后评估
- `fire` — 火情分析
- `news` — 新闻/舆情分析
- `weather-fetch` — 气象数据获取
- `region-mark` — 区域标记
- `border-push` — 边境推送
- `satelliteCallbackStore` — 卫星异步回调管理

**评价**：
- Capability 数量增长快，但 `registry.ts` 仍是手动注册
- 建议：支持目录扫描自动注册，减少新增 capability 的 boilerplate

---

## Agent Pipeline 演进

### Executor 阻断校验机制

**新增功能**：
- 执行前检查 action 的 context 依赖是否满足
- 支持嵌套对象递归搜索（`findInContext`）
- 阻断时调用 Blockage-Analyzer 分析原因并生成建议
- 部分 action（如 oil-drift、earthquake）支持需求自动提报到外部系统

**代码位置**：
- 阻断校验：`api/src/modules/executor/service.ts:validateActionCase()`
- 嵌套搜索：`api/src/modules/executor/service.ts:findInContext()`
- Blockage-Analyzer：`api/src/modules/blockage-analyzer/service.ts`

### 卫星影像异步回调

**新增机制**：
- Satellite capability 支持 `phase=pre/post` 模式
- Post 阶段提交需求后阻塞等待外部系统回调
- 使用 `satelliteCallbackStore` 管理 pending callbacks
- 回调路由：`POST /agent/callback/slice`

**评价**：
- 异步回调机制设计正确，但超时/重试策略需明确
- Pending callbacks 存储在内存中，进程重启会丢失（应持久化到 Redis）

---

## 数据流评估

### 后端数据流

```
Executor → Redis Pub/Sub → API 实例 → SSE → 前端
```

**状态**：与 ADR-0001 一致，设计正确，多实例部署可用。

### 新增数据流

| 数据流 | 路径 | 评价 |
|--------|------|------|
| AISStream WebSocket | `api/src/data/aisDataStore.ts` | 实时船舶数据，设计合理 |
| ShipDT HTTP API | `api/src/modules/ais/` | 补充 AIS 数据源，有降级逻辑 |
| OpenSky REST API | `api/src/modules/ads/` | ADS-B 航空器数据，有降级逻辑 |
| 卫星回调 | 外部系统 → `/agent/callback/slice` | 异步设计，但缺少持久化 |

---

## 前端架构评估

### 组件拆分进展

**已完成**：
- `ChatPanel` 拆分为 `chat/ChatHeader/ChatHistory/ChatMessageList/ChatInput`
- `CesiumMap` 拆分为多个 effect 模块（fireGroundEffect、earthquakeGroundEffect 等）
- 新增 `features/gis-custom/` 实验性功能模块

**新增交互**：
- Suggestion 按钮增加确认弹窗（预览完整 prompt）
- 地图绘制工具（点/线/面/矩形）
- 2D/3D 场景切换
- 底图样式切换面板

### 性能问题（严重）

**现象**：掉帧率 46.8%，主线程长任务 200~400ms

**根因**：
1. **CallbackProperty 每帧重算**：脉冲环（ring）和呼吸光圈（glowBillboard）每帧触发 300+ 次 JS 回调
2. **sync 函数全量同步**：`syncEntities`/`syncTrajectories`/`syncRegions` 在数据更新时遍历所有实体创建/更新 Cesium Entity

**已规划修复**：见 `api/plan/p0-main-thread-blocking.md`
- 简化 CallbackProperty（静态替代动态）
- 深比较缓存减少 sync 触发
- 分帧执行让出主线程

---

## 已解决的债务（ADR-0001 → 当前）

| 债务 | ADR-0001 状态 | 当前状态 | 解决方式 |
|------|--------------|---------|---------|
| `api/src/index.ts` 路由缩进错误 | 存在 | **已修复** | 代码格式化 |
| 前端组件逻辑/UI 混杂 | P1 | **部分改善** | ChatPanel 拆分、Cesium 组件拆分 |
| Mock 与真实逻辑混编 | P2 | **部分改善** | DeepSeek 替代减少 Mock 依赖，但仍有硬编码 |
| 缺乏日志目录 | 无 | **已解决** | 新增 `logs/` 目录 |
| Coze 平台配置残留 | 无 | **已清理** | 删除 `.coze` 和 Coze 专用脚本 |

---

## 新增架构债务

| 优先级 | 债务 | 位置 | 说明 |
|--------|------|------|------|
| **P0** | 前端主线程阻塞 | `src/components/cesium/CesiumMap.tsx` | 掉帧率 46.8%，长任务 200~400ms |
| **P0** | GPU 线程阻塞 | Cesium 渲染管线 | 平均 88ms/帧，几何体提交过量 |
| **P1** | GC 压力频繁 | 全项目 | MinorGC 101 次，临时对象过多 |
| **P1** | 卫星回调内存存储 | `api/src/modules/actions/capabilities/satelliteCallbackStore.ts` | Pending callbacks 在内存，重启丢失 |
| **P2** | Capability 手动注册 | `api/src/modules/actions/registry.ts` | 新增 capability 需改 3+ 处 |
| **P2** | 高频 API 轮询 | 前端轮询模块 | 每 10 秒 7+ 请求，未合并 |
| **P3** | 硬编码颜色值 | 各组件 | `#00E0FF`、`#FF4444` 等散落 |
| **P3** | Supabase 依赖冗余 | `package.json` | 已安装但未使用 |

---

## 可扩展性评估

### 横向扩展

| 组件 | 是否支持水平扩展 | 当前状态 |
|------|-----------------|---------|
| API 服务器 | 是 | 无状态，可任意副本 |
| Worker | 是 | BullMQ 天然支持多 Worker |
| PostgreSQL | 需外部方案 | 单点 |
| Redis | 需外部方案 | 单点 |
| Cesium 前端 | 否 | 纯客户端，无法水平扩展 |

### 新增 Capability 成本

当前新增一种能力仍需修改：
1. `api/src/modules/actions/capabilities/` 新增文件
2. `api/src/modules/actions/registry.ts` 手动注册
3. `packages/shared/src/types/action.ts` 新增 ActionType（若用联合类型）
4. 可能需修改前端 `taskResultFormatter.ts`
5. 可能需修改 Executor 阻断校验逻辑

**建议**：Capability 应支持**目录扫描自动注册**，ActionType 用字符串而非联合类型，阻断校验用声明式配置。

---

## 总体评价

**合理性：6.5/10**（ADR-0001 为 7/10）

**优势**：
- AI 层多模型混合策略正确（DeepSeek + Dify + Qwen + Tavily）
- Executor 阻断校验机制设计良好，提升了执行可靠性
- 卫星影像异步回调机制支持复杂的外部系统交互
- Capability 体系扩展性强，已覆盖多种业务场景
- 前端组件拆分有进展，代码组织更清晰

**劣势**：
- **前端性能成为最大瓶颈**（掉帧率 46.8%），Cesium 的高开销未得到有效控制
- 架构债务积累加速：GC 压力、高频轮询、手动注册等问题未解决
- 缺乏生产部署配置（Docker 只有开发模式）
- 监控、日志、错误追踪基础设施仍缺失
- 测试覆盖未知

**MVP 阶段**：架构基本合理，核心链路跑通，但前端性能已严重影响体验。
**生产阶段**：必须优先解决前端性能问题，补充生产部署配置，建立监控体系。

---

## 建议行动项

| 优先级 | 行动 | 参考文档 |
|--------|------|---------|
| P0 | 修复前端主线程阻塞 | `api/plan/p0-main-thread-blocking.md` |
| P1 | 卫星回调持久化到 Redis | 需新建 issue |
| P1 | 合并前端高频轮询 | 需新建 issue |
| P2 | Capability 自动注册 | 需新建 issue |
| P2 | 补充生产 Docker 配置 | 需新建 issue |
| P3 | 引入性能监控（Sentry / OpenTelemetry） | 需新建 issue |

---

## 相关文档

- [ADR-0001: 项目架构现状评审](./0001-architecture-review.md)
- [P0 前端性能修复计划](../../api/plan/p0-main-thread-blocking.md)
- [前端性能问题 Trace](../../api/issues/frontend-performance-trace-20260522.md)
- [项目 README](../../README.md)

---

## 未知项

1. **Cesium 的 Web Worker 几何计算是否已启用** — Cesium 内部有 Web Worker 支持，但当前配置是否启用未知
2. **BullMQ 任务重试策略** — 未读取到完整的重试配置
3. **数据库连接池配置** — `api/src/config/database.ts` 是否配置了 pool size
4. **Dify Agent 提示词版本管理** — `api/src/lib/prompts/` 下有 requirement-eval.ts，但是否与线上 Dify 应用同步
5. **前端代码分割（Code Splitting）** — Next.js build 是否启用了合理的代码分割策略
