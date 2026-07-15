# 报警-调度外部接口文档（第三方接入用）

> 本文档基于流程图 `alarm-to-dispatch-with-planned-paths.mmd` 和 `alarm-to-dispatch-confirm-and-dispatch.mmd` 整理，面向需要与本系统对接的**外部平台 / 设备驱动方**：
> - 规划流程：预测 → 调度 → 直接输出 dispatch plan（不落地 active_allocation）
> - 确认-下发流程：确认 planned plan → 基于最新位置重新预测 → 调用设备平台下发目标点
>
> **说明**：本文档不涉及智能设备自身的注册/获取接口（如 `listPatrolResources`、`portable-device`、`simulator`），仅描述报警接入、环境数据提供、调度方案获取、方案确认与设备调度四类外部边界。

---

## 一、接口总览

| 序号 | 接口/数据 | 方式 | 路径/来源 | 调用方 | 说明 |
|---|---|---|---|---|---|
| 1 | 外部告警接入 | POST | `/external/suspect/events` | 外部平台 | 上报可疑事件，触发本系统处置流程 |
| 2 | 摄像头数据 | 数据库表接入 | 外部数据库 `patrol_cameras` | 本系统读取 | 获取摄像头分布，用于轨迹补全与预测 |
| 3 | 边境线数据 | 由摄像头数据生成 | 外部数据库 `patrol_cameras` | 本系统读取并计算 | 按摄像头位置连接生成边境线/警戒线 |
| 4 | 特殊区域数据 | 数据库表接入 | 外部数据库 `special_areas`（可选） | 本系统读取 | 获取地形/禁入区约束 |
| 5 | 轮询最新调度方案 | GET | `/dispatch/plan/latest` | 外部平台 | 携带嫌疑人最新位置获取最新 plan；未来可扩展 Webhook |
| 6 | 确认执行方案 | POST | `/dispatch/confirm` | 外部平台 | 确认按某份 planned plan 执行，并基于最新位置重新预测目标点 |
| 7 | 轮询调度智能设备 | POST | `/dispatch/dispatch` | 外部平台 | 每分钟轮询，携带最新位置，本系统调用设备平台下发目标点 |

---

## 二、第三方需提供的数据

第三方必须**提前准备好以下数据库表（或只读视图）**，并授权本系统直接读取。本系统会在事件处置过程中从表中拉取静态/准静态数据；其中，边境线由摄像头数据按位置连接生成，不再单独要求 `patrol_boundaries` 表：

### 2.1 摄像头数据表（`patrol_cameras`）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string/int | 是 | 摄像头唯一标识 |
| `name` | string | 否 | 摄像头名称 |
| `lng` | float | 是 | 经度 |
| `lat` | float | 是 | 纬度 |
| `detection_radius` | float | 否 | 探测半径（米），默认可填 100 |
| `type` | string | 否 | 类型：固定摄像头 / 球机 / 雷达等 |

### 2.2 边境线/边界数据（由 `patrol_cameras` 生成）

外部平台**无需单独提供** `patrol_boundaries` 表。本系统读取 `patrol_cameras` 后，按以下规则生成边境线/警戒线：

- 将摄像头按纬度（`lat`）排序；
- 依次连接相邻摄像头位置，形成一条折线；
- 该折线作为边境线/警戒线用于轨迹预测和调度约束。

因此，只要摄像头分布合理且沿边境排列，即可同时满足“摄像头数据”和“边境线数据”两个输入需求。

### 2.3 特殊区域数据表（`special_areas`，可选）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string/int | 是 | 区域唯一标识 |
| `name` | string | 否 | 区域名称 |
| `polygon` | array[{lng, lat}] / JSON | 是 | 区域多边形顶点 |
| `type` | string | 是 | 类型：`restricted`（禁入区） / `terrain`（地形区）等 |
| `allowed_types` | array[string] / JSON | 否 | 禁入区允许进入的资源类型 |
| `speed_factor` | float | 否 | 地形区速度系数，如 0.5 |

---

## 三、接口详情

### 3.1 外部告警接入

**方法**：`POST`  
**路径**：`/external/suspect/events`  
**调用方**：外部平台（radar / videoAI / 第三方平台 / 人工上报等）

#### 入参

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `source` | string | 是 | 告警来源：`radar` / `videoAI` / `manual` / `third_party` |
| `alarmType` | string | 是 | 告警类型，如 `border_intrusion` |
| `alarmTime` | string | 是 | 告警发生时间，ISO-8601 格式 |
| `location` | object | 是 | 初始位置 `{ lng: float, lat: float }` |
| `deviceId` | string | 否 | 触发设备 ID |
| `rawData` | object | 否 | 原始告警 payload，用于去重和溯源 |
| `confidence` | float | 否 | 置信度，0~1 |
| `metadata` | object | 否 | 扩展字段 |

#### 出参

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | int | 200 成功，其他为错误码 |
| `message` | string | 提示信息 |
| `data.eventId` | string/int | 创建/复用的嫌疑人事件 ID |
| `data.status` | string | 事件状态，如 `pending` / `processing` |
| `data.isNew` | bool | 是否为新建事件 |

---

### 3.2 环境数据表接入说明

本系统不通过 REST 接口请求环境数据，而是直接读取第三方提供的数据库表（或只读视图）。接入方式如下：

| 表名 | 用途 | 读取方式 |
|---|---|---|
| `patrol_cameras` | 摄像头分布，用于盲区轨迹补全与嫌疑人观测判断 | 本系统直连第三方数据库读取 |
| `patrol_boundaries` | 边境线/警戒线，由 `patrol_cameras` 按位置连接生成 | 本系统读取 `patrol_cameras` 后计算 |
| `special_areas` | 地形区、禁入区等特殊约束区域 | 本系统直连第三方数据库读取（可选） |

接入要求：
- 第三方需开放对应表的只读权限，或提供同构只读视图；
- 坐标系统一为 WGS84 经纬度；
- 表结构见本文档“二、第三方需提供的数据”。

---

## 四、调度方案输出方式

### 3.1 规划流程（`alarm-to-dispatch-with-planned-paths.mmd`）

调度方案由本系统内部生成后直接返回给外部设备驱动方：

```json
{
  "resourceId": "res_001",
  "resourceName": "无人机-01",
  "type": "drone",
  "action": "intercept",
  "targetLng": 87.18,
  "targetLat": 43.92,
  "etaSeconds": 120,
  "plannedPath": [
    { "lng": 87.16, "lat": 43.91 },
    { "lng": 87.18, "lat": 43.92 }
  ],
  "explanation": {
    "targetDescription": "嫌疑人预测期望点（87.1800°E, 43.9200°N），置信度 78%",
    "resourceSelectionReason": "选择无人机 res_001：当前位置最近、速度最快、可 100m 高空越过地形障碍",
    "pathSummary": "从无人机当前位置 (87.1600°E, 43.9100°N) 沿 plannedPath 直飞目标点，预计 120 秒到达",
    "constraintsConsidered": ["边境线约束", "禁入区绕行的地形约束"]
  }
}
```

#### 新增解释字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `resourceName` | string | 资源可读名称，便于外部日志/展示 |
| `explanation` | object | 对本次调度决策的人工可读解释 |
| `explanation.targetDescription` | string | 目标点来源与置信度说明 |
| `explanation.resourceSelectionReason` | string | 为什么选中该资源（距离、速度、能力等） |
| `explanation.pathSummary` | string | 路径概览：起点 → 途经点 → 终点、预计耗时 |
| `explanation.constraintsConsidered` | array[string] | 本次路径规划考虑的约束条件 |

外部设备驱动方接收后自行驱动智能设备执行。

---

## 五、轮询获取最新调度方案

外部平台通过持续轮询该接口，获取当前事件的最新 dispatch plan。当携带嫌疑人最新位置时，本系统会基于该位置重新预测并生成新 plan。

### 5.1 接口说明

**方法**：`GET`  
**路径**：`/dispatch/plan/latest`  
**调用方**：外部平台

> **未来扩展**：本接口当前为纯轮询模式，后续可扩展为 Webhook 推送（本系统在 plan 更新时主动回调外部平台），以降低轮询频率。

### 5.2 入参

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `eventId` | string/int | 是 | 嫌疑人事件 ID |
| `suspectLng` | float | 否 | 嫌疑人最新经度；携带时触发重新预测与调度 |
| `suspectLat` | float | 否 | 嫌疑人最新纬度；携带时触发重新预测与调度 |
| `taskId` | string | 否 | 链路追踪用任务 ID |

### 5.3 出参

整体响应结构见本文档“四、调度方案输出方式”。关键字段补充如下：

| 字段 | 类型 | 说明 |
|---|---|---|
| `planId` | string | 本次 plan 唯一标识 |
| `planVersion` | int | 单调递增版本号，外部平台据此判断 plan 是否更新 |
| `planUpdatedAt` | string | ISO-8601 时间戳，plan 最后生成时间 |
| `captureFeasible` | bool | 当前是否可拦截；`false` 时见 `reason` |
| `reason` | string | `captureFeasible=false` 时的原因说明 |
| `targetPoint` | object | 嫌疑人目标点 `{ lng, lat }` |
| `resources` | array[object] | 被调度资源列表，每个资源含 `plannedPath` 和 `explanation` |
| `summary` | object | 整体调度摘要，如总资源数、最早 ETA 等 |

### 5.4 缓存与 304

- 响应头返回 `ETag`，值为 `planVersion` 或 plan 内容哈希；
- 外部平台下次请求可携带 `If-None-Match`；
- 若 plan 未变化，本系统返回 `304 Not Modified`，不触发重算。

### 5.5 不可行响应

当无法生成有效 plan 时，仍返回 HTTP 200：

```json
{
  "planId": "plan_002",
  "planVersion": 2,
  "planUpdatedAt": "2026-07-07T10:00:00Z",
  "captureFeasible": false,
  "reason": "无可达资源在嫌疑人预计逃逸路径上完成拦截",
  "targetPoint": { "lng": 87.18, "lat": 43.92 },
  "resources": [],
  "summary": {}
}
```

### 5.6 超时与 SLA

| 项 | 约定 |
|---|---|
| 接口超时 | 10 秒（真实实现可调整） |
| P95 目标 | 3 秒 |
| 轮询频率 | 由外部平台控制，建议 1~2 秒；未变化时可用 304 减少开销 |
| 限流 | 当前不限流，依赖外部平台自控频率和位置偏差阈值 |

### 5.7 位置更新扩展（未来）

若后续外部平台希望主动推送嫌疑人位置，而非每次轮询都带位置参数，可新增：

- `POST /suspect/events/{id}/position`：外部平台上报嫌疑人最新位置；
- 本系统收到位置后，按内部阈值决定是否重新生成 plan；
- `GET /dispatch/plan/latest` 退化为纯查询接口。

## 六、确认执行方案

外部平台在拿到 `/dispatch/plan/latest` 返回的 planned plan 后，如果决定执行，调用该接口进行确认。本系统会校验原 plan 有效性，并基于外部回传的嫌疑人最新位置重新预测目标点。

### 6.1 接口说明

**方法**：`POST`  
**路径**：`/dispatch/confirm`  
**调用方**：外部平台（告警平台）

### 6.2 入参

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `planId` | string | 是 | 待确认的 planned plan ID |
| `eventId` | string/int | 是 | 嫌疑人事件 ID |
| `confirmedDeviceIds` | array[string] | 是 | 外部确认参与执行的设备 ID 列表 |
| `latestSuspectPos` | {lng, lat} | 是 | 嫌疑人最新位置 |
| `taskId` | string | 否 | 链路追踪 ID |

### 6.3 出参

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | int | 200 成功，其他为错误码 |
| `message` | string | 提示信息 |
| `data.status` | string | `confirmed` / `invalid` / `expired` |
| `data.expectedPoint` | {lng, lat, confidence} | 基于最新位置重新预测的目标点 |
| `data.confirmedDevices` | array[object] | 已确认设备列表（含设备平台一致的 ID） |
| `data.reason` | string | 当 `status != confirmed` 时的原因 |

### 6.4 处理流程

```text
接收确认请求
  -> 查询原 planned plan
  -> 校验 plan 与设备是否仍有效
  -> 获取嫌疑人最新位置
  -> 重新预测期望点
  -> 返回 confirmed + expectedPoint
```

---

## 七、轮询调度智能设备

外部告警平台**每分钟轮询一次**该接口，携带嫌疑人最新位置。本系统每次重新预测目标点，并沿用已确认设备调用智能设备外部平台接口下发目标点。

### 7.1 接口说明

**方法**：`POST`  
**路径**：`/dispatch/dispatch`  
**调用方**：外部平台（告警平台）

### 7.2 入参

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `eventId` | string/int | 是 | 嫌疑人事件 ID |
| `latestSuspectPos` | {lng, lat} | 是 | 嫌疑人最新位置 |
| `planId` | string | 否 | 原 confirmed plan ID；为空时使用该事件最新 confirmed plan |
| `confirmedDeviceIds` | array[string] | 否 | 指定设备；为空时沿用已确认设备 |
| `taskId` | string | 否 | 链路追踪 ID |
| `clientRequestId` | string | 否 | 用于幂等去重，建议外部平台每次生成唯一值 |

### 7.3 出参

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | int | 200 成功 |
| `message` | string | 提示信息 |
| `data.dispatchId` | string | 本次下发唯一标识 |
| `data.status` | string | `dispatched` / `pending` / `failed` |
| `data.targetPoint` | {lng, lat} | 本次下发的目标点 |
| `data.devices` | array[object] | 已下发设备列表，含设备平台 ID 和下发结果 |
| `data.reason` | string | `failed` 时的原因 |

### 7.4 设备平台调用接口

本系统内部会调用智能设备外部平台的可控设备控制接口：

**方法**：`POST`  
**URL**：`http://192.168.0.33:5284/Remote/send`（示例，实际以设备平台部署地址为准）  
**Content-Type**：`application/json`

#### 入参

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `requester` | string | 是 | 发起方，固定填 `"指挥中心"` |
| `orderType` | int | 是 | 指令类型，固定填 `1`（指派设备至异常点） |
| `deviceID` | string | 是 | 设备平台侧设备 ID，与 `patrol_resources` 中的外部设备 ID 一致 |
| `longitude` | double | 是 | 目标点经度 |
| `latitude` | double | 是 | 目标点纬度 |
| `elevation` | double | 否 | 目标点高程，默认 `0` |

#### 报文示例

```json
{
  "requester": "指挥中心",
  "orderType": 1,
  "deviceID": "DOG_2604_002",
  "longitude": 87.18,
  "latitude": 43.92,
  "elevation": 0
}
```

#### 响应处理

- 当前设备平台暂无明确响应报文，**默认 HTTP 200 视为下发成功，其他视为失败**；
- 未来设备平台补充响应字段后，本系统可解析 `code` / `message` / `taskId` 等字段做精细判断。

### 7.5 幂等与超时

| 项 | 约定 |
|---|---|
| 轮询频率 | 外部平台每分钟一次 |
| 幂等 | 同一 `eventId` + 同一分钟内相同 `latestSuspectPos`，返回上一次结果，不重复调用设备平台 |
| 设备平台超时 | 3 秒；超时返回 `status: pending`，外部平台下次轮询可查询最终结果 |
| 设备不可用时 | 返回 `failed` + `reason: device_unavailable`，不自动重新分配其他设备 |

### 7.6 处理流程

```text
接收 dispatch 请求
  -> 查询已确认的 plan / 设备
  -> 基于 latestSuspectPos 重新预测期望点
  -> 遍历 confirmedDeviceIds
       -> 调用 POST /Remote/send 下发目标点
       -> 记录每台设备的下发结果
  -> 返回 dispatched / pending / failed
```

---

## 八、调用时序（简化）

```text
外部平台                    本系统                    第三方数据库/设备平台
   |                         |                              |
   | POST /external/suspect/events                       |
   |------------------------>|                              |
   |                         | READ patrol_cameras          |
   |                         |----------------------------->|
   |                         | GENERATE boundary from cameras |
   |                         | READ special_areas (可选)    |
   |                         |----------------------------->|
   |                         | POST /prediction/...         |
   |                         | 内部调度计算                 |
   |                         |                              |
   |  直接接收 dispatch plan                            |
   |<------------------------|                              |
   |                         |                              |
   | POST /dispatch/confirm  |                              |
   |------------------------>|                              |
   |                         | 校验 plan + 重新预测目标点    |
   |<------------------------| 返回 confirmed / expectedPoint|
   |                         |                              |
   | POST /dispatch/dispatch |                              |
   |------------------------>|                              |
   |                         | POST /Remote/send            |
   |                         |----------------------------->|
   |                         | 设备平台返回 200（默认成功）  |
   |<------------------------| 返回 dispatched / failed      |
```

---

## 九、注意事项

1. **环境数据必须提前就绪**：摄像头、边境线、特殊区域是轨迹补全、预测和调度的基础约束，第三方需保证数据完整且坐标系一致（默认 WGS84 / 经纬度）。
2. **坐标系**：如无特殊说明，所有 `lng` / `lat` 均为经纬度，接口可通过 `coord_system` 协商。
3. **调度方案字段**：当前输出字段为 `plannedPath`，具体字段名以实际接口版本为准。
4. **智能设备获取**：本系统内部通过 `resources_available` 获取可用资源，第三方无需关心设备注册/发现接口。
