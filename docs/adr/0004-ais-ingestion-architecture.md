# ADR-0004: AIS 每小时注入与查询架构评审

- **日期**: 2026-06-10
- **状态**: Accepted
- **作者**: Claude Code (Opus 4.8)
- **前序**: [ADR-0003: Agent Loop 运行时架构评审](./0003-agent-loop-architecture.md)

---

## 背景

项目已具备 OpenSky ADS-B 航空器数据的每小时注入流水线（REST API → normalize → DB `aircraft_current_states` → Dashboard API / Agent skill）。AIS（船舶）数据此前仅通过 ShipDT 接口提供区域聚合查询，缺乏与 ADS-B 同构的实时快照能力。

引入 AIS 每小时注入的需求：
1. **地图对称性**：Dashboard 需要同时展示航空器（ADS-B）和船舶（AIS）两类目标
2. **Agent 查询能力**：Agent Loop 需要能通过 skill 查询船舶数据，与 aircraft-region-query 对称
3. **数据时效性**：ShipDT 的聚合查询有延迟，需要独立的实时数据源

---

## 决策

复用 OpenSky 已验证的注入模式，为 AIS 建立完全对称的数据流水线：

```
aisstream.io WebSocket (global bbox, 60s)
  └─→ ais/client.ts ──→ ais/ingestion.ts ──→ ais/repository.ts
                                            └─→ DB ais_current_states
                                                   ├─→ agent skill query
                                                   └─→ dashboard API → frontend
```

**核心原则**：
- 与 OpenSky 模式保持一致（client / ingestion / repository / queue / worker）
- 独立表前缀 `ais_`，避免与 `aircraft_current_states` 命名冲突
- 独立 skill（`ais-region-query`），不与 `aircraft-region-query` 混编
- 不集成 ShipDT（静态数据查询保持独立）

---

## 架构设计

### 数据流

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  aisstream.io   │ →   │  ais/client.ts  │ →   │ ais/ingestion.ts│
│  WebSocket      │     │  (connect +     │     │ (normalize      │
│  global bbox    │     │   accumulate)   │     │  PositionReport)│
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                              ┌────────────────────────┘
                              ▼
                    ┌─────────────────┐
                    │ ais/repository.ts│
                    │  replaceAll()    │
                    │  DELETE + INSERT │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  ais_current_states│
                    │  (PG table)        │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │  dashboard   │  │  agent-loop  │  │  ShipDT      │
  │  getAisData()│  │  skill query │  │  (独立，不   │
  │  limit 1000  │  │  bbox filter │  │   集成本流水线)│
  └──────────────┘  └──────────────┘  └──────────────┘
```

### 模块结构

| 模块 | 职责 | 对应 OpenSky 模块 |
|------|------|------------------|
| `ais/client.ts` | WebSocket 连接、订阅、60s 累积、断开 | `opensky/client.ts` |
| `ais/ingestion.ts` | 原始消息 → `NewAisCurrentState[]` 归一化 | `opensky/ingestion.ts` |
| `ais/repository.ts` | 事务：DELETE + batch INSERT（1000/批） | `opensky/repository.ts` |
| `ais/queue.ts` | BullMQ Queue + repeatable job（hourly） | `opensky/queue.ts` |
| `ais/worker.ts` | BullMQ Worker（lockDuration 120s） | `opensky/worker.ts` |

### 表结构

```sql
ais_current_states
├── mmsi (PK, text)
├── ship_name, call_sign, ship_type
├── longitude, latitude, sog, cog, heading, navigational_status, destination
├── source_time (timestamp with timezone, not null)
├── updated_at (timestamp with timezone, not null, default now())
└── indexes: ais_lat_idx, ais_lon_idx, ais_updated_at_idx
```

### Skill 设计

`skills/ais-region-query/SKILL.md`：
- 独立的 skill，不与 `aircraft-region-query` 混编
- 定义 bbox 查询模式（东海 / 南海 / 渤海 / 黄海 / 台湾海峡 / 中国东部）
- 工具限制：`Read`, `SqlQuerySchema`, `SqlQuery`
- 响应规范：区域名、bbox、行数、最新时间戳、紧凑 vessel 列表

### Dashboard 投影

`projectAisStatesToAisData()` 映射规则：
| 字段 | 来源 |
|------|------|
| `id` | `ais-${mmsi}` |
| `name` | `shipName \|\| mmsi` |
| `type` | `"ship"` |
| `coordinates` | `[longitude, latitude]` |
| `importance` | `"low"`（hardcode） |
| `status` | `"normal"`（hardcode） |
| `description` | `AIS \| type:${shipType} \| speed:${sog} knots \| heading:${heading}° \| COG:${cog}°` |
| `speed` | `sog` 或 0 |
| `heading` | `heading` 或 0 |

---

## 与 ADS-B (OpenSky) 对比

| 维度 | ADS-B (OpenSky) | AIS (aisstream.io) |
|------|-----------------|-------------------|
| 数据源 | OpenSky REST API | aisstream.io WebSocket |
| 协议 | HTTP GET | WebSocket (wss) |
| 采集方式 | 单次请求当前快照 | 订阅后累积 60s |
| 数据量 | 全球 ~5000 架飞机 | 全球 ~50万+ 艘船（免费 tier 有限制） |
| DB 表 | `aircraft_current_states` | `ais_current_states` |
| Dashboard limit | 3000 | 1000 |
| Skill | `aircraft-region-query` | `ais-region-query` |
| 查询维度 | icao24, callsign, origin_country, altitude | mmsi, ship_name, ship_type, sog |

**关键差异**：
1. **数据源协议**：OpenSky 是 REST API，AIS 是 WebSocket（需维护连接状态）
2. **数据量**：AIS 全球数据量远大于 ADS-B，免费 tier 可能受限
3. **Dashboard limit**：AIS 设为 1000（低于 ADS-B 的 3000），因当前 snapshot 数据量较小且 Cesium 性能考虑

---

## 设计决策记录

### 决策 1: 为什么复用 OpenSky 模式而非创建新架构？

**理由**：
- OpenSky 流水线已验证稳定运行，模式成熟
- 保持代码一致性，降低维护成本
- 团队对 BullMQ + replaceAll 模式已有理解

**权衡**：
- WebSocket 与 REST 的差异被封装在 `client.ts` 中，不影响整体模式
- 如果未来需要 AIS 实时流（非 hourly），当前模式无法直接支持，需额外设计

### 决策 2: 为什么使用 `replaceAll`（DELETE + INSERT）而非 UPSERT？

**理由**：
- 与 OpenSky 保持一致
- 简单可靠：旧数据全部清除，新数据全部插入，无 orphan 记录
- 事务保证一致性

**权衡**：
- 删除期间查询会短暂返回空（事务隔离级别决定）
- 如果未来需要增量更新（只更新变化的 vessel），replaceAll 效率低

### 决策 3: 为什么 AIS 和 ADS-B 使用独立 skill？

**理由**：
- 船舶和航空器的查询语义不同（ship_type vs category，sog vs velocity）
- 支持的海域和空域区域不完全重叠
- 独立 skill 使模型更精确地选择工具，减少混淆

**权衡**：
- 两个 skill 有重复的 bbox 定义，未来可考虑提取共享区域配置

### 决策 4: 为什么不集成 ShipDT？

**理由**：
- ShipDT 提供静态数据（船舶档案、区域聚合），与 aisstream.io 的动态快照是互补关系
- ShipDT 已有独立的 API 接口和前端集成
- 集成会增加复杂度，且 ShipDT 的查询模式（区域聚合 denseCells）与逐条 snapshot 不同

**未来可能**：在 dashboard 上同时显示 aisstream 实时数据和 ShipDT 聚合数据（当前已实现）

---

## 已解决的债务（ADR-0003 → 当前）

| 债务 | ADR-0003 状态 | 当前状态 | 解决方式 |
|------|--------------|---------|---------|
| SkillManager 未配置 skill 目录 | P2 | **已解决** | `skills/` 目录已创建，`ais-region-query` 和 `aircraft-region-query` 已部署 |
| Agent Loop 缺少端到端测试 | P2 | **已改善** | `agent-loop-smoke.ts` 支持 GIS toolchain 场景，skill 测试覆盖 AIS 查询路径 |

---

## 新增架构债务

| 优先级 | 债务 | 位置 | 说明 |
|--------|------|------|------|
| **P2** | AIS WebSocket 60s 累积内存风险 | `ais/client.ts` | 全球数据量大时，60s 累积可能 OOM；当前 ~800 条安全，>10万 需分批 |
| **P2** | aisstream.io 免费 tier 限速 | `ais/worker.ts` | 未实现 backoff/重试，被限流时 job 会失败 |
| **P2** | ADS-B 和 AIS 的 bbox 区域重复定义 | `skills/` | 两个 skill 各自定义区域，未提取共享配置 |
| **P2** | Dashboard 无聚合降采样 | `CesiumMap.tsx` | 1000+ 实体直接渲染，无前端聚合；ADS 已放开到 3000，性能风险增加 |
| **P3** | replaceAll 非增量更新 | `ais/repository.ts` | 每小时全量替换，数据传输量大；未来可考虑增量 |
| **P3** | heading=511 未语义化处理 | `projection.ts` | AIS 中 heading=511 表示 "not available"，但直接透传为 511° |

---

## 可扩展性评估

### 数据量增长应对

| 场景 | 当前方案 | 应对方案 |
|------|---------|---------|
| AIS 数据 > 1000 条 | Dashboard 截断（limit 1000） | 前端聚合 / 分页 |
| AIS 数据 > 10万 条 | 内存累积风险 | 分批 ingest（按 region）或升级 aisstream tier |
| 并发查询 | DB 连接池 | 已有连接池，skill 查询 LIMIT 100 |

### 新增数据源

如果未来需要其他 maritime 数据源（如 MarineTraffic、VesselFinder）：
1. 创建 `modules/<source>/` 目录，复用相同模式
2. 独立表（`<source>_current_states`）避免 schema 冲突
3. 独立 skill 或扩展现有 skill

---

## 总体评价

**合理性：8/10**（ADR-0003 为 7.5/10）

**优势**：
- 复用已验证的 OpenSky 模式，风险低、一致性好
- 完整的端到端流水线：WebSocket → normalize → DB → skill → Dashboard
- 与 Agent Loop skill 体系无缝集成（`ais-region-query` 与 `aircraft-region-query` 对称）
- 独立表和独立 skill 保持关注点分离
- Dashboard 投影函数复用现有辅助函数（`isFiniteNumber`、`latestTimestamp`）

**劣势**：
- WebSocket 累积模式有内存上限风险（当前数据量安全，但未设防护）
- Dashboard 前端无聚合降采样，1000+ 实体渲染性能待验证
- replaceAll 全量替换非最优，增量更新未来可能需要
- heading=511 等特殊值未语义化处理

**MVP 阶段**：AIS 注入流水线已可运行，Dashboard 和 Agent skill 均可查询船舶数据。
**生产阶段**：需添加 WebSocket 数据量监控、前端聚合、增量更新优化。

---

## 建议行动项

| 优先级 | 行动 | 说明 |
|--------|------|------|
| P2 | 添加 WebSocket 累积数据量监控 | `ais/client.ts` 中记录累积消息数和内存占用 |
| P2 | 实现 aisstream 限流时的 backoff 重试 | `ais/worker.ts` 中处理 429/503 |
| P2 | 前端聚合降采样（类似 ShipDT denseCells） | `CesiumMap.tsx` 中高密度区域聚合为计数点 |
| P3 | 评估增量更新替代 replaceAll | 对比 DELETE+INSERT 与 UPSERT 的性能和一致性 |
| P3 | heading=511 语义化处理 | projection 中映射为 "N/A" 而非 511° |

---

## 相关文档

- [ADR-0003: Agent Loop 运行时架构评审](./0003-agent-loop-architecture.md)
- [AIS Hourly Ingestion & Query Plan](../../api/plan/ais-hourly-ingestion-and-query-plan.md)
- [项目 README](../../README.md)

---

## 未知项

1. **aisstream.io 免费 tier 的实际速率限制** — 文档未明确说明，需通过运行时监控确认
2. **Cesium 渲染 1000+ 船舶实体时的帧率** — 当前测试 ~800 条流畅，1000+ 需验证
3. **ais_current_states 表的长期增长** — 当前为 replaceAll（固定行数），如果改为增量，需考虑归档策略
