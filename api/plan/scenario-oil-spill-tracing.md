# 船舶非法排污溯源场景 — Capability 实现计划

> 目标：为"船舶非法排污溯源"场景实现 7 个子任务对应的 capability，所有数据写死（Mock）。

---

## 一、7 个子任务与 Capability 映射

| # | 子任务 | Capability | 当前状态 | 核心输出 |
|---|--------|-----------|---------|---------|
| 1 | 标记中国东海区域 | `region-mark` | 未实现 | 东海边界多边形 + GIS region |
| 2 | 天基遥感影像获取 + AI 油膜识别 | `satellite` | 已存在，需扩展 | SAR影像元数据 + 油膜区域/中心点 |
| 3 | 获取气象数据 | `weather-fetch` | 未实现 | 风速/风向/洋流数据 |
| 4 | 油膜漂移反推 | `oil-drift` | 未实现 | 漂移路径 + 排污原点 + 时间区间 |
| 5 | 获取 AIS 轨迹数据 | `ais-fetch` | 未实现 | 区域内全部船舶轨迹 |
| 6 | 匹配时空范围内途经船舶 | `ais-match-suspects` | 未实现 | 8艘匹配船舶 |
| 7 | 嫌疑船舶优先级排序 | `ais-suspect-ranking` | 未实现 | 5艘嫌疑船分级排序 |

---

## 二、DependsOn 依赖链

```
region-mark --► satellite --┬--► oil-drift --► ais-match-suspects --► ais-suspect-ranking
                            │                   ▲
weather-fetch --------------┘                   │
                                                │
ais-fetch --------------------------------------┘
```

- `satellite` 依赖 `region-mark`：获取东海区域边界作为查询范围
- `oil-drift` 依赖 `satellite`：获取油膜轮廓/中心点作为反推终点
- `oil-drift` 依赖 `weather-fetch`：获取气象参数代入扩散模型
- `ais-match-suspects` 依赖 `oil-drift`：获取排污原点+时间区间作为时空匹配条件
- `ais-match-suspects` 依赖 `ais-fetch`：获取 AIS 数据库进行筛选
- `ais-suspect-ranking` 依赖 `ais-match-suspects`：获取匹配结果进行打分排序

> Executor 中 `context[depActionId]` 传递前置步骤的 `result.data`。

---

## 三、各 Capability 详细设计

### 3.1 `region-mark` — 区域标记

**文件**：`api/src/modules/actions/capabilities/region-mark.ts`（新建）

**输入参数**（`action.params`）：
- `region` (string): 区域名称，如"中国东海"

**返回数据结构**：
```typescript
data: {
  regionName: "中国东海",
  bounds: { north: 33.0, south: 23.0, east: 128.0, west: 120.0 },
  boundaryDescription: "北起长江口北岸到韩国济州岛一线，南至广东省南澳岛与台湾岛南端鹅銮鼻一线",
  gisData: {
    type: "region",
    regions: [{
      id: "region-east-china-sea",
      name: "中国东海",
      type: "monitor",
      coordinates: [
        [120.0, 33.0], [128.0, 33.0], [128.0, 23.0],
        [120.0, 23.0], [120.0, 33.0]
      ]
    }]
  }
}
```

**GIS 效果**：东海区域边界多边形（蓝色框线，需前端配合）

---

### 3.2 `satellite` — 扩展油膜识别分支

**文件**：`api/src/modules/actions/capabilities/satellite.ts`（修改）

**新增分支条件**：当 `query.includes("油膜") || query.includes("油污") || params.detectOilSpill === true` 时走油膜识别分支。

**输入参数**：
- 通过 `context[regionMarkActionId]` 读取区域边界

**返回数据结构**：
```typescript
data: {
  responseType: "oil_spill_detection",
  imageCount: 32,
  resolution: "0.8-1m",
  cloudCover: "<8%",
  satelliteType: "SAR",
  oilSpill: {
    areaKm2: 0.3,
    centerLng: 122.5125,   // 东经122°30′45″
    centerLat: 30.2561,    // 北纬30°15′22″
    outline: [
      [122.50, 30.25], [122.52, 30.25], [122.53, 30.26],
      [122.51, 30.27], [122.49, 30.26], [122.50, 30.25]
    ]
  },
  gisData: {
    type: "entity",
    entities: [{
      id: "oil-spill-center",
      name: "油膜中心点",
      type: "base",
      coordinates: [122.5125, 30.2561],
      importance: "high",
      status: "warning",
      description: "疑似油膜区域中心 | 面积: 0.3km² | 天基信息服务系统推送"
    }],
    regions: [{
      id: "oil-spill-area",
      name: "疑似油膜区域",
      type: "monitor",
      coordinates: [/* 油膜轮廓多边形 */]
    }]
  }
}
```

**GIS 效果**：SAR影像叠加 + 油膜区域黄色半透明填充 + 油膜中心点标注

---

### 3.3 `weather-fetch` — 气象数据

**文件**：`api/src/modules/actions/capabilities/weather-fetch.ts`（新建）

**输入参数**：
- `region` (string): 区域名称
- 通过 `context` 读取油膜中心点坐标（可选，用于定位气象数据重点片区）

**返回数据结构**：
```typescript
data: {
  recordCount: 144,
  windSpeed: 3.2,           // m/s
  windDirection: "东北",
  currentDirection: "东南",
  currentSpeed: 0.8,        // m/s
  period: "近72小时",
  region: "东海油膜片区",
  // 无 gisData，纯文本数据
}
```

---

### 3.4 `oil-drift` — 油膜漂移反推

**文件**：`api/src/modules/actions/capabilities/oil-drift.ts`（新建）

**输入参数**（通过 `context` 读取前置结果）：
- `context[satelliteActionId]` → `oilSpill.centerLng/Lat`, `oilSpill.outline`
- `context[weatherActionId]` → `windSpeed`, `windDirection`, `currentSpeed`, `currentDirection`

**返回数据结构**：
```typescript
data: {
  driftPathLengthKm: 3.5,
  driftPath: [
    [122.5125, 30.2561],  // 油膜中心（终点）
    [122.49, 30.265],
    [122.47, 30.275],
    [122.46, 30.285],
    [122.4528, 30.2939]   // 排污原点（起点）
  ],
  pollutionOrigin: {
    lng: 122.4528,         // 东经122°27′10″
    lat: 30.2939,          // 北纬30°17′38″
    timeRange: "近72小时内10:00-12:00",
    confidence: "误差≤2小时"
  },
  gisData: {
    type: "trajectory",
    trajectories: [{
      id: "drift-path",
      name: "油污漂移溯源路径",
      type: "route",
      coordinates: [/* 漂移路径点数组 */],
      status: "history"
    }],
    entities: [{
      id: "pollution-origin",
      name: "排污原点",
      type: "base",
      coordinates: [122.4528, 30.2939],
      importance: "high",
      status: "danger",
      description: "油污漂移反推排污原点 | 时间: 近72h内10:00-12:00"
    }]
  }
}
```

**GIS 效果**：橙色虚线溯源路径 + 排污原点红色圆点高亮

---

### 3.5 `ais-fetch` — AIS 轨迹数据

**文件**：`api/src/modules/actions/capabilities/ais-fetch.ts`（新建）

**输入参数**：
- `region` (string): 区域名称
- 通过 `context[regionMarkActionId]` 读取区域边界

**实现方式**：复用 `aisDataStore.ts` 中已有的数据生成逻辑，限定在东海区域范围内生成 157 艘船舶 + 2863 条轨迹记录。

**返回数据结构**：
```typescript
data: {
  recordCount: 2863,
  vesselCount: 157,
  region: "中国东海",
  vessels: [
    { mmsi: "413567890", name: "远洋货轮01", type: "货轮", ... },
    // ... 157艘
  ],
  trajectories: [
    { mmsi: "413567890", points: [[lng,lat], ...] },
    // ...
  ]
}
```

> 本 capability 不写 `gisData`，GIS 数据由 `ais-match-suspects` 和 `ais-suspect-ranking` 统一输出，避免地图上先显示全部 157 艘再过滤的闪烁问题。

---

### 3.6 `ais-match-suspects` — 匹配嫌疑船舶

**文件**：`api/src/modules/actions/capabilities/ais-match-suspects.ts`（新建）

**输入参数**（通过 `context` 读取）：
- `context[oilDriftActionId]` → `pollutionOrigin.lng/lat`, `pollutionOrigin.timeRange`
- `context[aisFetchActionId]` → `vessels`, `trajectories`

**匹配逻辑**（写死）：
- 以排污原点为中心，1km x 1km 范围
- 时间区间：近72小时内 10:00-12:00
- 从 157 艘中筛选出 8 艘匹配船舶

**返回数据结构**：
```typescript
data: {
  matchCriteria: {
    center: [122.4528, 30.2939],
    rangeKm: 1,
    timeRange: "近72小时内10:00-12:00"
  },
  matchedCount: 8,
  vessels: [
    {
      mmsi: "413567890",
      name: "远洋货轮01",
      type: "货轮",
      stayDurationMin: 22,
      matchedAt: [122.453, 30.294]
    },
    // ... 共8艘
  ],
  gisData: {
    type: "entity",
    entities: [/* 8艘匹配船舶点位 */],
    trajectories: [/* 8艘匹配船舶轨迹（深蓝色实线） */]
  }
}
```

**GIS 效果**：非匹配船舶置灰隐藏，8 艘匹配船舶轨迹以深蓝色实线高亮

---

### 3.7 `ais-suspect-ranking` — 嫌疑排序

**文件**：`api/src/modules/actions/capabilities/ais-suspect-ranking.ts`（新建）

**输入参数**（通过 `context` 读取）：
- `context[aisMatchActionId]` → 8 艘匹配船舶数据

**打分逻辑**（写死）：
- 距离排污原点距离（权重 40 分）
- 异常停留时长（权重 30 分）
- 航行异动程度（权重 30 分）
- 总分 100 分，≥80 首要嫌疑，60-79 次要嫌疑，<60 一般嫌疑

**返回数据结构**：
```typescript
data: {
  totalSuspects: 5,
  primary: [{
    mmsi: "413567890",
    name: "远洋货轮01",
    type: "货轮",
    score: 86,
    rank: 1,
    reasons: "距离排污原点最近(40分) | 异常停留22分钟(30分) | 航线偏离(16分)"
  }],
  secondary: [
    { mmsi: "413567891", score: 72, rank: 2 },
    { mmsi: "413567892", score: 68, rank: 3 },
    { mmsi: "413567893", score: 65, rank: 4 }
  ],
  normal: [
    { mmsi: "413567894", score: 45, rank: 5 }
  ],
  gisData: {
    type: "entity",
    entities: [
      // 首要嫌疑: type="ship", status="danger", importance="high" → 红色
      { id: "suspect-1", name: "首要嫌疑-远洋货轮01", type: "ship", importance: "high", status: "danger",
        coordinates: [122.453, 30.294], description: "MMSI: 413567890 | 得分: 86 | 货轮" },
      // 次要嫌疑: status="warning", importance="medium" → 橙色
      { id: "suspect-2", name: "次要嫌疑-货轮02", type: "ship", importance: "medium", status: "warning", ... },
      { id: "suspect-3", name: "次要嫌疑-渔船01", type: "ship", importance: "medium", status: "warning", ... },
      { id: "suspect-4", name: "次要嫌疑-作业船01", type: "ship", importance: "medium", status: "warning", ... },
      // 一般嫌疑: status="normal", importance="low" → 灰色/绿色
      { id: "suspect-5", name: "一般嫌疑-货轮03", type: "ship", importance: "low", status: "normal", ... }
    ],
    trajectories: [
      // 5艘嫌疑船轨迹，按等级着色
      { id: "traj-suspect-1", name: "首要嫌疑轨迹", type: "route", status: "history",
        coordinates: [/* 红色轨迹 */] },
      { id: "traj-suspect-2", name: "次要嫌疑轨迹-1", type: "route", status: "history",
        coordinates: [/* 橙色轨迹 */] },
      // ...
    ]
  }
}
```

**GIS 效果**：首要嫌疑红色闪烁点+红色实线轨迹，次要嫌疑橙色，一般嫌疑黄色

---

## 四、需要修改的已有文件

### 4.1 `api/src/modules/actions/registry.ts`

在文件末尾追加 import 和 register：

```typescript
import { regionMarkCapability } from "./capabilities/region-mark.js";
import { weatherFetchCapability } from "./capabilities/weather-fetch.js";
import { oilDriftCapability } from "./capabilities/oil-drift.js";
import { aisFetchCapability } from "./capabilities/ais-fetch.js";
import { aisMatchSuspectsCapability } from "./capabilities/ais-match-suspects.js";
import { aisSuspectRankingCapability } from "./capabilities/ais-suspect-ranking.js";

registerCapability("region-mark", regionMarkCapability);
registerCapability("weather-fetch", weatherFetchCapability);
registerCapability("oil-drift", oilDriftCapability);
registerCapability("ais-fetch", aisFetchCapability);
registerCapability("ais-match-suspects", aisMatchSuspectsCapability);
registerCapability("ais-suspect-ranking", aisSuspectRankingCapability);
```

### 4.2 `api/src/modules/actions/capabilities/satellite.ts`

在现有分支之前新增油膜识别分支：

```typescript
// 情况0：油膜识别
if (q.includes("油膜") || q.includes("油污") || params.detectOilSpill) {
  // 返回 oil_spill_detection 数据结构（见 3.2）
}
```

### 4.3 `api/src/modules/executor/service.ts`

在 `writeDisplayData` 函数的 `switch (actionType)` 中新增 case：

```typescript
case "region-mark": {
  // 写入 events 表，透传 gisData（regions）
  break;
}
case "weather-fetch": {
  // 写入 events 表，纯文本内容（无 gisData）
  break;
}
case "oil-drift": {
  // 写入 events 表，透传 gisData（trajectories + entities）
  break;
}
case "ais-fetch": {
  // 可选：不写 events 表（数据量大，由后续步骤统一输出 GIS）
  break;
}
case "ais-match-suspects": {
  // 写入 events 表，透传 gisData（entities + trajectories）
  break;
}
case "ais-suspect-ranking": {
  // 写入 events 表，透传 gisData（entities + trajectories）
  break;
}
```

---

## 五、固定坐标参考

| 点位 | 经纬度（度） | 说明 |
|------|-------------|------|
| 东海区域西北角 | 120.0, 33.0 | 区域边界 |
| 东海区域东南角 | 128.0, 23.0 | 区域边界 |
| 油膜中心点 | 122.5125, 30.2561 | 东经122°30′45″, 北纬30°15′22″ |
| 排污原点 | 122.4528, 30.2939 | 东经122°27′10″, 北纬30°17′38″ |

---

## 六、实施顺序建议

按依赖链从叶子到根的顺序实现，每完成一个即可测试：

1. **`region-mark`** — 无依赖，最基础
2. **`weather-fetch`** — 无依赖
3. **`ais-fetch`** — 无依赖
4. **`satellite`**（扩展油膜分支）— 依赖 region-mark
5. **`oil-drift`** — 依赖 satellite + weather-fetch
6. **`ais-match-suspects`** — 依赖 oil-drift + ais-fetch
7. **`ais-suspect-ranking`** — 依赖 ais-match-suspects

同时 `registry.ts` 的注册可以随着每个 capability 的完成逐步追加。

`executor/service.ts` 的 `writeDisplayData` 可以在所有 capability 完成后统一添加。

---

## 七、验证方式

1. 单个 capability 完成后，可通过单元测试或临时调用 `actionsService.execute()` 验证返回数据结构
2. 全部完成后，创建一个场景任务（query: "东海 油污 溯源"），观察：
   - SSE 流中 7 个 step 依次执行
   - `taskSteps` 表中 7 条记录状态均为 completed
   - `events` 表中生成对应 GIS 数据记录
   - 前端地图正确叠加所有图层
