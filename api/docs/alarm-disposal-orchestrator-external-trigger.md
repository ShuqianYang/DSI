# alarm-disposal-orchestrator 外部触发改造指南

> 文档路径：`api/docs/alarm-disposal-orchestrator-external-trigger.md`  
> 对应代码：`skills/alarm-disposal-orchestrator/scripts/orchestrate.py`、`skills/alarm-disposal-orchestrator/SKILL.md`

本文说明：如果把 `alarm-disposal-orchestrator` 从「用户在 Agent Loop 里输入报警信息」改为「外部报警系统直接推送报警并触发处置规划」，需要哪些外部数据输入，以及需要预先在数据库/Redis/外部服务里准备什么数据。

---

## 1. 当前 skill 的触发方式

当前 `alarm-disposal-orchestrator` 由用户在聊天中描述报警，Agent Loop 把报警解析成 JSON，调用 `orchestrate.py`：

```bash
cd "S:/Projects/projects_new/skills/alarm-disposal-orchestrator"
run-orchestrate.cmd \
  --alarm-file alarm.json \
  --personnel-file personnel.json
```

`orchestrate.py` 内部会走 10 步：

1. 解析报警 → 2. 创建 suspect event → 3. 更新状态为 processing → 4. 拉取事件轨迹 → 5. 盲区补全 → 6. 加载边境/地形数据 → 7. 轨迹预测 → 8. 拉取可用资源 → 9. 资源调度 → 10. 轮询 active allocation。

---

## 2. 外部触发改造后的架构

```text
外部报警系统（便携设备/雷达/视频 AI/人工上报）
           │
           │ 推送报警 JSON
           ▼
┌─────────────────────┐
│  Alarm Gateway/API  │  ← 新增：接收外部报警、校验、写入事件、触发编排
│  （可复用 weitong   │     也可新建一个独立服务）
│   /external/suspect/events）
└─────────────────────┘
           │
           │ 调用 orchestrate.py（带 --event-id 或 --alarm-file）
           ▼
┌─────────────────────────────────────────┐
│        alarm-disposal-orchestrator      │
│  1. parse alarm / reuse event            │
│  2. blind_spot_completion               │
│  3. trajectory_forecast                 │
│  4. fetch resources (portable/simulator/ │
│     static)                             │
│  5. resource_allocation                 │
│  6. poll active allocation              │
└─────────────────────────────────────────┘
           │
           ▼
    返回 dispatch plan
           │
           ▼
    前端/指挥台展示建议方案
```

---

## 3. 外部数据提供方（External Data Providers）

改造后，以下数据必须由外部系统实时或准实时提供。

### 3.1 报警事件数据（Alarm Event Provider）

**必要字段**（`orchestrate.py` 创建 suspect event 所需）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `longitude` | float | 报警经度，WGS-84 |
| `latitude` | float | 报警纬度，WGS-84 |
| `eventTime` | string | 发生时间，`yyyy-MM-dd HH:mm:ss` |
| `currentDeviceId` | string | 发现报警的设备 ID |

**建议字段**（用于生成更丰富的 title/description）：

| 字段 | 说明 |
|------|------|
| `personId` / `currentTrackId` | 目标身份/轨迹 ID |
| `personType` | 人员类型，如「迷彩服」 |
| `personAction` | 动作，如「行走」 |
| `personDistance` | 与设备距离 |
| `imageUrl` | 抓拍图片 URL |
| `previousDeviceId` / `previousTrackId` | 上一跳设备/轨迹 |

**提供方式**：

- 方式 A：外部系统直接调用 weitong `POST /dev-api/api/v1/external/suspect/events`，拿到 `eventId`，再把这个 `eventId` 传给 orchestrator（`--event-id`）。
- 方式 B：Alarm Gateway 接收报警后写文件/发消息，调用 orchestrator 时传 `--alarm-file`。

### 3.2 资源目录数据（Resource Catalog Provider）

**来源**：weitong PostgreSQL 的 `patrol_resource` 表。

**必须预先写入的字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int/bigint | 资源唯一 ID |
| `type` | string | `drone` / `car` / `dog` / `person` |
| `speed` | float | 默认速度（m/s） |
| `is_dispatched` | boolean | 当前是否已被调度（busy） |

**提供方式**：

- 在 weitong 初始化 SQL 中写入（如 `weitong/sql/patrol_resource.sql`）。
- 或者由资源管理系统在资源上线/下线时维护该表。

### 3.3 资源实时位置数据（Resource Position Provider）

**来源 1（优先）**：Redis `realtime:patrol_resource:{id}` hash，字段 `lng`、`lat`、`updated_at`。  
**来源 2（fallback）**：weitong PostgreSQL `patrol_resource_position` 表最新一条记录。

**必须提供的数据**：

| 字段 | 说明 |
|------|------|
| `lng` | 资源当前经度 |
| `lat` | 资源当前纬度 |
| `updated_at` | 更新时间（可选，用于 freshness 判断） |

**提供方式**：

- 真实场景：`patrol_simulator/simulator.py` 或便携设备后端持续写入 Redis。
- 测试场景：`scripts/seed_positions.py` 批量写入 Redis。
- 无 Redis 时：由位置服务持续写入 `patrol_resource_position` 表。

### 3.4 边境/地形辅助数据（Border/Terrain Provider）

**来源**：weitong PostgreSQL 的 `patrol_boundary` 和 `patrol_camera` 表，通过 weitong API 暴露：

- `GET /dev-api/api/v1/patrol/boundaries`
- `GET /dev-api/api/v1/patrol/cameras`

**必须预先写入的数据**：

`patrol_boundary` 表：

| 字段 | 说明 |
|------|------|
| `id` | 边界 ID |
| `name` | 边界名称 |
| `points` | 边界点数组 `[{lng, lat, seq}]` |

`patrol_camera` 表：

| 字段 | 说明 |
|------|------|
| `id` | 摄像头 ID |
| `lng` / `lat` | 摄像头经纬度 |

**提供方式**：

- 在 weitong 初始化 SQL 中写入（如 `weitong/sql/06_patrol_camera_boundary.sql`）。
- 或者通过 weitong 的摄像头/边界管理 API 维护。

### 3.5 现场巡逻人员位置（Patrol Personnel Provider）

**来源**：外部人员定位系统（如北斗终端、手持 APP）。

**数据格式**：

```json
[
  {"id": "P_001", "type": "person", "lng": 87.1500, "lat": 43.9200, "speed": 2.0}
]
```

**提供方式**：

- 报警推送时一起带上。
- 或者由人员定位服务在触发时查询并写入 `personnel.json`。

---

## 4. 需要预先写入数据库/Redis 的数据清单

### 4.1 PostgreSQL（weitong 库）

| 表 | 必须预先写入的数据 | 谁维护 |
|----|-------------------|--------|
| `patrol_resource` | 资源目录（id/type/speed/is_dispatched） | 资源管理系统 / 初始化 SQL |
| `patrol_resource_position` | 资源历史位置（fallback） | 位置服务 / simulator |
| `patrol_boundary` | 边境线点序列 | 初始化 SQL / 边界管理 API |
| `patrol_camera` | 摄像头位置 | 初始化 SQL / 摄像头管理 API |
| `suspect_event` 及其子表 | 报警事件记录 | 外部报警系统 / Alarm Gateway |

### 4.2 Redis

| Key 模式 | 必须写入的数据 | 谁维护 |
|----------|---------------|--------|
| `realtime:patrol_resource:{id}` | 资源实时位置 hash（lng/lat/updated_at） | `patrol_simulator` / 便携设备后端 / `seed_positions.py` |

### 4.3 外部服务/接口

| 服务 | 必须可用 | 说明 |
|------|---------|------|
| weitong 后端 | 必需 | 提供 suspect event、boundary、camera、dispatch API |
| TrajRP（轨迹预测） | 必需 | `/trajrp/api/v1/prediction/trajectory_forecast` |
| 盲区补全服务 | 必需 | `/completion/api/v1/prediction/blind_spot_completion` |
| dispatch 服务 | 必需 | `/dispatch/api/v1/dispatch/resource_allocation` |
| 便携设备后端（`/home`） | 可选 | 提供 UAV/UGV/机器狗实时位置；不可用则回退到 simulator 源 |
| qijingnan 代价图服务 | 当前未使用 | 当前使用固定 `task_id = cost_fixed_task_001`；如需真实代价图需额外改造 |

---

## 5. 外部触发的推荐实现路径

### 5.1 最小可用路径（MVP）

1. **外部报警系统**把报警 POST 到 weitong `/external/suspect/events`。
2. weitong 返回 `eventId`。
3. **Alarm Gateway** 调用：
   ```bash
   python scripts/orchestrate.py --event-id {eventId} --resource-source simulator
   ```
4. `orchestrate.py` 从 weitong DB/Redis 读资源位置和边境数据，生成 dispatch plan。
5. Alarm Gateway 把 plan 推给前端/指挥台。

**前提**：

- `patrol_resource`、`patrol_boundary`、`patrol_camera` 已初始化。
- Redis 里有 `realtime:patrol_resource:*`（由 simulator 或 seed_positions.py 提供）。

### 5.2 完整路径（含真实便携设备）

1. 外部报警系统推送报警 JSON 到 **Alarm Gateway**。
2. Alarm Gateway 写 `alarm.json`，并可选写 `personnel.json`。
3. Alarm Gateway 调用：
   ```bash
   python scripts/orchestrate.py \
     --alarm-file alarm.json \
     --personnel-file personnel.json \
     --resource-source portable
   ```
4. `orchestrate.py`：
   - 创建 suspect event。
   - 调 TrajRP 预测。
   - 调便携设备 `/home` 拿实时位置。
   - 调 dispatch 服务生成 plan。
   - 轮询 active allocation。
5. 返回 plan。

**前提**：

- 便携设备后端 `/home` 可达。
- 便携设备在线且位置有效。

### 5.3 纯静态演示路径（无需 DB/Redis/便携设备）

1. Alarm Gateway 准备：
   - `alarm.json`
   - `static-resources.json`（固定资源点）
2. 调用：
   ```bash
   python scripts/orchestrate.py \
     --alarm-file alarm.json \
     --static-resources-file static-resources.json
   ```
3. `orchestrate.py` 只用静态点跑 dispatch，不读任何外部资源位置服务。

**适用场景**：演示、离线测试、固定哨所/卡点。

---

## 6. 外部触发时需要新增/改造的模块

| 模块 | 改造内容 |
|------|----------|
| **Alarm Gateway** | 新增一个 HTTP/WebSocket/MQTT 接收端，接收外部报警，校验字段，调用 orchestrator |
| **事件写入** | 外部报警可直接写 weitong `suspect_event`，或复用 `/external/suspect/events` API |
| **资源位置服务** | 确保 `realtime:patrol_resource:*` 持续更新；无 Redis 时保证 `patrol_resource_position` 有最新位置 |
| **触发方式** | 把 `--alarm-file` 调用改为程序内 `import orchestrate; result = orchestrate.run(...)`，避免 shell 调用开销 |
| **结果推送** | orchestrator 返回的 plan 需要推送给前端 SSE/WebSocket，或写入任务结果表 |
| **异常处理** | 外部触发无人值守，需要重试、告警、降级（如 `/home` 不可达时自动切 simulator） |

---

## 7. 环境变量清单

外部触发部署时需要配置：

```bash
# weitong 后端
WEITONG_BASE_URL=http://192.168.0.27

# 便携设备后端（可选）
PORTABLE_DEVICE_BASE_URL=http://192.168.0.33:5284

# 调度任务 ID（当前固定为预烘焙代价图）
TASK_ID=cost_fixed_task_001

# 轮询参数
POLL_INTERVAL_SECONDS=2
MAX_POLL_ROUNDS=10

# 边境数据开关
USE_BOUNDARY_DATA=true
BORDER_INFLUENCE_FACTOR=0.8

# Simulator 源用到的 DB/Redis（从 weitong 库读取资源目录和位置）
DB_HOST=192.168.0.27
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=123456
REDIS_HOST=192.168.0.27
REDIS_PORT=6379
REDIS_DB=0
REDIS_PASSWORD=
```

---

## 8. 常见坑与注意事项

1. **`/home` 不可达时回退 simulator**：当前代码会静默回退，但 simulator 源依赖 Redis/DB 有实时位置；如果两者都没有，会返回「无可用资源」。
2. **`is_dispatched=true` 的资源会被跳过**：测试残留会导致可用资源变少，需要定期清理或提供 `--reset-dispatch` 工具。
3. **单点报警不会走轨迹预测**：`trajectory_forecast` 需要 ≥2 个轨迹点；单点报警 dispatch 只基于当前点。
4. **`cost_fixed_task_001` 是预烘焙代价图**：不根据当前事件区域重算，调度结果不是基于真实高程/道路网。
5. **不要自动下发控制指令**：当前 skill 只输出建议方案，不会调用便携设备控制接口。

---

## 9. 并发多警报处理能力

### 9.1 现状结论

- **底层调度服务支持多事件并发**：`resource_dispatch_service.py` 的 `patrol_allocation` 表按 `event_id + resource_id + status` 记录分配，并对 `status='active'` 的 `resource_id` 建有唯一索引，保证同一资源同一时刻只能服务一个事件。
- **模拟器支持多嫌疑人并发**：`patrol_simulator/simulator.py` 用 `suspect_states {event_id -> SuspectState}` 同时维护多个事件轨迹。
- **但 skill 自身是单事件入口**：`alarm-disposal-orchestrator` 一次只处理一个报警，没有事件队列、优先级、批量并发入口或跨事件全局优化。

### 9.2 调度服务的并发行为

当两个警报几乎同时触发时：

1. 事件 A 先完成 dispatch，占用了资源 R1、R2。
2. 事件 B 后触发，dispatch 时发现 R1/R2 已经是其他事件的 `active` 分配（`conflict_ids`）。
3. 默认 `allow_reassign_active_resources=false`，事件 B 会**丢弃冲突资源**，只使用剩余可用资源。
4. 若剩余资源不足，事件 B 的 `capture_feasible` 可能为 false。

### 9.3 资源冲突与抢占

`resource_dispatch_service.py` 中的关键逻辑：

```python
# 检测本事件历史分配与其他事件冲突
prev_active_ids = [rid for (eid, rid) in active_rows if int(eid) == int(event_id)]
conflict_ids = [rid for (eid, rid) in active_rows if int(eid) != int(event_id) and int(rid) in dispatched_set]

# 默认：丢弃冲突资源，不抢占其他事件
if conflict_ids and not allow_reassign:
    filtered_items = [it for it in filtered_items if int(it["rid"]) not in conflict_set]

# 可选：允许抢占，把其他事件的 active 分配标记为 superseded
if conflict_ids and allow_reassign:
    cur.execute(
        "UPDATE patrol_allocation SET status='superseded' ...
        WHERE status='active' AND event_id<>%s AND resource_id = ANY(%s)",
        (event_id, conflict_ids),
    )
```

此外，调度时对相关资源加 PostgreSQL advisory lock（`pg_try_advisory_lock`），防止并发请求同时调度同一资源。

### 9.4 外部触发改造时的并发建议

如果外部报警系统会高频、并发地推送多个报警， Alarm Gateway 至少需要补充：

| 能力 | 说明 |
|------|------|
| 报警队列/优先级 | 按时间、威胁等级、区域密度排序，避免瞬间大量请求压垮调度服务 |
| 事件合并/聚类 | 同一区域短时间内的多个报警可合并为一个统一处置任务 |
| 全局资源优化 | 在所有待处理/进行中的事件之间做联合分配，而不是每个事件独立贪心 |
| 抢占规则 | 明确高优先级事件可以抢占低优先级事件资源的条件 |
| 资源释放回环 | 事件完成/取消后，及时把资源 `is_dispatched` 置回 false，避免后续事件无资源可用 |

---

## 10. 轨迹预测与通行代价图的真实情况

### 10.1 当前代码实际使用的预测方式

`orchestrate.py` 调用 TrajRP 时固定使用：

```python
"prediction_config": {
    "prediction_method": "method2",
    "use_data_speed": False,
    ...
},
"task_id": "cost_fixed_task_001"
```

**method2 简化预测**不会调用 qijingnan 的通行代价/路径规划服务，它只是：

- 按历史速度 × 时间计算预测距离
- 以当前点为中心按角度均匀扇出候选点
- 加一点边界 `special_areas` 偏移

因此当前报警处置流程**并没有使用高程图或通行代价图**。

### 10.2 TrajRP 何时会用真实高程/代价图

只有在 `prediction_method != "method2"`（即 method1）时，`api_trajectory_forecast.py` 才会：

1. 调用 `generate_cost_matrix()` 请求 qijingnan：
   - `POST /api/v1/analysis/passage_cost`
   - 传入 `region_bbox`、`object_type`、`max_slope_angle`
2. 拿到 `task_id` 后调路径规划：
   - `POST /api/v1/dispatch/intent_path_planning`

### 10.3 qijingnan 高程图是否真实

qijingnan 服务配置在 `S:/Projects/weitong/qijingnan/app.py`：

```python
TILE_SOURCES = {
    "44T": {
        "land": r"data/land_use/44T_20200101-20210101.tif",
        "elev": r"data/elevation/44T_output_AW3D30.tif",
        "road": r"data/road_network/44T_roads.shp",
    },
    "45T": { ... },
}
```

实测文件大小：

| 数据 | 文件 | 大小 | 来源 |
|------|------|------|------|
| 高程 | `44T/45T/46T_output_AW3D30.tif` | 470–527MB | JAXA AW3D30（真实 DSM） |
| 土地利用 | `42T–47T_20200101-20210101.tif` | 78–163MB | Esri Land Cover 2020 |
| 路网 | `44T/45T_roads.shp` | 17–24MB | OSM 路网 |

所以 **高程图、土地利用、路网都是真实数据**。

### 10.4 但通行代价中的地形速度权重是写死的

`config/traffic_params.yaml` 中所有土地/道路类型速度被设为同一值：

```yaml
base_speeds:
  vehicle_suv:
    weights:
      1: 15.0   # water
      2: 15.0   # trees
      5: 15.0   # crops
      7: 15.0   # built_area
      8: 15.0   # bare_ground
      11: 15.0  # rangeland
      201: 15.0 # motorway
      202: 15.0 # primary
      ...
```

后果：

- 土地利用类型虽然被真实读取，但**不影响通行代价**。
- 路网虽然被真实烧录到栅格，但**不影响通行代价**。
- 真正影响代价的只有 **坡度**（来自真实高程）和 **constraints 中显式禁止的类型**（如水体、悬崖被设为速度 0）。

### 10.5 高程 → 坡度的代码路径

`core/cost_modeling.py`：

```python
dy, dx = np.gradient(elev_grid, resolution)
slope_magnitude = np.sqrt(dx ** 2 + dy ** 2)
max_slope = self.config['slope_constraints'].get(obj_type, 999.0)
f_s, impassable_slope = self.calculate_slope_factor(slope_magnitude, max_slope)

cost_grid[valid_mask] = cost_grid[valid_mask] / f_s[valid_mask]
cost_grid[impassable_slope] = 999.0
```

### 10.6 外部触发改造时的代价图建议

| 改造点 | 建议 |
|--------|------|
| 让报警处置真正使用代价图 | 把 `orchestrate.py` 的 `prediction_method` 改为 `"method1"` |
| 让土地利用/路网影响代价 | 修改 `config/traffic_params.yaml`，给不同土地/道路类型设置差异化速度 |
| 扩大图源覆盖 | `TILE_SOURCES` 只注册了 44T/45T，但磁盘有 42T–47T 土地利用和 46T 高程，应补齐注册 |
| 动态代价图 | 去掉写死的 `task_id = "cost_fixed_task_001"`，改为按事件 ROI 实时生成 `task_id` |

---

## 11. 总结

把 `alarm-disposal-orchestrator` 改为外部触发，本质上需要解决三类数据：

| 数据类别 | 来源 | 是否必须 |
|----------|------|----------|
| 报警事件 | 外部报警系统 | 是 |
| 资源目录 | `patrol_resource` 表 | 是 |
| 资源实时位置 | Redis `realtime:patrol_resource:*` 或 `patrol_resource_position` | 是 |
| 边境/摄像头 | `patrol_boundary`、`patrol_camera` | 否（`USE_BOUNDARY_DATA=false` 可关闭，但预测精度下降） |
| 现场人员 | 外部人员定位系统 | 否（可选补充） |

最小改造：外部报警系统把报警写成 weitong suspect event，Alarm Gateway 用 `--event-id` + `--resource-source simulator` 调 orchestrator，前提是 DB 和 Redis 已初始化资源数据。
