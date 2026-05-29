# 柳州地震灾后评估 — 实施计划

## 一、概要

将 `api/plan/earthquake.md` 的 8 子任务流程落地为 5 个写死 action 的即时服务，Planner + Router 完全写死（不走 Dify），对标现有火情研判的实现方式。

**入口**：用户即时提问含"地震""震后评估"关键词，不走订阅触发。
**参考提问**：
> 对柳州柳南区 5.2 级地震做灾后评估，先查询中国地震台网中心、广西地震局官网获取地震基础信息，先获取震前最新历史影像，再提交天基信息服务需求获取震后最新影像，自动对比识别损毁情况并完成灾后评估。

---

## 二、5-Action 依赖图

```
action-1 (news) ──────────────────────────────────────────┐
    查询官网地震基础信息                                   │
    柳州 5.2 级 / 109.26°E, 24.38°N / 深度 8km           │
                                                           │
action-2 (region-mark) ────────────────────────────────────┤
    依据震中参数定位柳州柳南区                               │  依赖 action-1
    红色五角星标记震中                                      │
                                                           │
action-3 (satellite: history) ─────────────────────────────┤
    查询天基历史影像（震前）                                 │  依赖 action-2
    返回 pre-earthquake overlay                             │
                                                           │
action-4 (satellite: demand+callback) ──────────────────────┤
    提报震后应急成像需求 → 阻塞等回调                        │  依赖 action-2
    返回 post-earthquake overlay                            │
    （内部复用 fireScenario 的提报+回调机制，改参数）        │
                                                           │
action-5 (earthquake-evaluation) ───────────────────────────┘
    写死损毁评估结果 + GIS 数据                              │  依赖 action-3, action-4
    两张影像 overlay + 损毁图斑 + 分级渲染                   │
```

---

## 三、逐文件改动清单

### 1. 新增 `api/src/modules/actions/capabilities/earthquake-evaluation.ts`

**职责**：汇总震前/震后影像结果，输出写死的损毁评估 GIS 数据。

**输入**（通过 context，依赖 action-3 和 action-4 的结果）：
- `context[action-3-id]` → 震前影像 URL、覆盖范围
- `context[action-4-id]` → 震后影像 URL、覆盖范围

**输出 data 结构**：
```ts
{
  summary: {
    location: "广西柳州市柳南区",
    magnitude: "5.2",
    epicenter: [109.26, 24.38],
    depthKm: 8,
    assessmentTime: "2026-05-19Txx:xx:xxZ",
    buildingsDamaged: 127,
    roadsInterrupted: 8,
    landslidesDetected: 3,
    totalAffectedAreaKm2: 12.5,
  },
  damageZones: [
    { level: "severe",  areaKm2: 2.1,  color: "#DC2626", description: "房屋大量损毁，道路中断" },
    { level: "moderate", areaKm2: 4.8,  color: "#F59E0B", description: "部分建筑受损，墙体裂缝" },
    { level: "light",    areaKm2: 5.6,  color: "#FACC15", description: "轻微震感，个别房屋掉瓦" },
  ],
  gisData: {
    type: "earthquake",
    // 两张影像 overlay（用于分屏对比）
    imageOverlays: [
      { id: "pre-eq",  url: "/local-tiles/pre_earthquake.png",  rectangle: {...}, label: "震前影像" },
      { id: "post-eq", url: "/local-tiles/post_earthquake.png", rectangle: {...}, label: "震后影像" },
    ],
    // 损毁图斑 polygons
    damagePolygons: [
      { id: "dmg-severe-1",   level: "severe",   coordinates: [...], label: "重度损毁区 2.1km²" },
      { id: "dmg-moderate-1", level: "moderate", coordinates: [...], label: "中度损毁区 4.8km²" },
      { id: "dmg-light-1",    level: "light",    coordinates: [...], label: "轻度损毁区 5.6km²" },
    ],
    // 震中标记
    entities: [
      { id: "epicenter", name: "震中", type: "earthquake", coordinates: [109.26, 24.38], importance: "high", status: "danger" },
    ],
    cameraView: { type: "point", lng: 109.26, lat: 24.38, altitude: 15000 },
    // 前端分屏对比标记
    compareMode: "side-by-side", // 提示前端启用双 viewer 模式
  },
}
```

**Mock 数据**：全部写死柳州柳南区固定坐标和固定损毁统计。

---

### 2. 修改 `api/src/modules/actions/capabilities/region-mark.ts`

**改动**：从"只支持东海"改为"参数化支持多个区域"。

**新增区域 preset**：
```ts
const REGION_PRESETS: Record<string, RegionPreset> = {
  "中国东海": EAST_CHINA_SEA,
  "东海": EAST_CHINA_SEA,
  "柳州": {
    name: "广西柳州市柳南区",
    bounds: { north: 24.42, south: 24.34, east: 109.32, west: 109.20 },
    outline: [...], // 闭合 polygon
    center: [109.26, 24.38],
    cameraAltitude: 15000,
    labelText: "柳州市柳南区\n震中 109.26°E, 24.38°N",
  },
  // 后续可扩展
};
```

**execute 逻辑**：根据 `params.region` 匹配 preset，未匹配则回退到东海。

---

### 3. 修改 `api/src/modules/actions/capabilities/satellite.ts`

**改动**：在现有 `fireScenario === true` 分支旁边，新增 `earthquakeScenario === true` 分支。

**分支逻辑**：

```
if (params.fireScenario === true) {
  // 保持现有火情提报+回调不变
}

if (params.earthquakeScenario === true) {
  const phase = params.phase; // "pre" | "post"

  if (phase === "pre") {
    // ① 震前历史影像查询
    // 模拟查询天基历史数据，返回固定震前影像
    // 返回结构同 fire_imaging，但 responseType = "pre_earthquake"
    // overlay 用 /local-tiles/pre_earthquake.png
  }

  if (phase === "post") {
    // ② 震后应急需求提报 + 阻塞等回调
    // 复用 fireScenario 的提报逻辑，改需求参数：
    //   - requirementName: "柳州柳南区 5.2 级地震震后应急成像需求"
    //   - targetType: "地震"
    //   - algorithm: "灾后评估"
    //   - areaBounds: Point(109.26, 24.38)
    // 回调等待超时后回退到 /local-tiles/post_earthquake.png
    // 返回 responseType = "post_earthquake"
  }
}
```

**注意**：`earthquakeScenario` 分支里 `phase=post` 的提报+回调机制与火情完全一致，只是需求参数不同。

---

### 4. 修改 `api/src/modules/planner/service.ts`

**新增**：

```ts
// 地震灾后评估关键词
const EARTHQUAKE_KEYWORDS = ["地震", "震后", "震中", "灾后评估"];
function isEarthquakeQuery(query: string): boolean { ... }

// 地震评估写死 plan
function buildEarthquakePlan(query: string): Plan {
  // 5 个 step + scenario metadata
  // subtasks: [news, region-mark, satellite(pre), satellite(post), earthquake-evaluation]
  // mainTask.name: "柳州柳南区 5.2 级地震灾后智能评估"
  // finalEvent.type: "地震灾后评估"
}
```

**在 generatePlan 入口处加分支**（优先级在油污溯源之后，订阅触发火情之前）：
```ts
if (isEarthquakeQuery(query)) {
  return buildEarthquakePlan(query);
}
```

---

### 5. 修改 `api/src/modules/router/service.ts`

**新增**：

```ts
function isEarthquakeQuery(query: string): boolean { ... }
function buildEarthquakeActions(queryText?: string): Action[] {
  // 5 个 action：
  //   action-1: type=news, params={query:"柳州 5.2 级地震", earthquakeScenario:true}
  //   action-2: type=region-mark, params={region:"柳州"}, dependsOn=["action-1"]
  //   action-3: type=satellite, params={earthquakeScenario:true, phase:"pre", region:"柳州"}, dependsOn=["action-2"]
  //   action-4: type=satellite, params={earthquakeScenario:true, phase:"post", region:"柳州"}, dependsOn=["action-2"]
  //   action-5: type=earthquake-evaluation, dependsOn=["action-3","action-4"]
}
```

**在 decideActions 入口处加分支**：
```ts
if (isEarthquakeQuery(queryText)) {
  return buildEarthquakeActions(queryText);
}
```

**注意**：`action-3` 和 `action-4` 都依赖 `action-2`（region-mark），但 `action-3` 和 `action-4` 之间无依赖，理论上可以并行。不过为了 demo 节奏（每步 10s），保持串行也可以接受。如果要并行，需要 Executor 支持并行执行（当前是 for 循环串行）。

---

### 6. 修改 `api/src/modules/actions/registry.ts`

```ts
import { earthquakeEvaluationCapability } from "./capabilities/earthquake-evaluation.js";
registerCapability("earthquake-evaluation", earthquakeEvaluationCapability);
```

---

### 7. 修改 `api/src/modules/executor/service.ts`

在 `writeDisplayData` switch 中新增 `case "earthquake-evaluation":` 分支，将结果写入 `events` 表。

---

## 四、GIS 数据设计要点

### region-mark（柳州）
- 蓝色粗实线闭合 polygon 框选柳南区
- camera flyTo 震中上空 15km

### satellite(pre)
- 加载 `/local-tiles/pre_earthquake.png` 作为 overlay
- responseType = "pre_earthquake"

### satellite(post)
- 加载 `/local-tiles/post_earthquake.png` 作为 overlay（mock，或真实回调回来的影像）
- responseType = "post_earthquake"

### earthquake-evaluation
- `imageOverlays` 包含两张图，带 `label: "震前影像" / "震后影像"`
- `damagePolygons` 三个 level 的 polygon，按颜色渲染
- `entities` 震中红色脉冲标记
- `compareMode: "side-by-side"` 作为前端提示

**前端需要做的（不在本计划范围，但需知会）**：
- 识别 `compareMode: "side-by-side"` 时启用双 viewer 布局
- 支持两张 `imageOverlays` 分别绑定到左/右 viewer
- 损毁图斑叠加在右侧（震后）viewer

---

## 五、Mock 素材清单

| 文件 | 用途 | 状态 |
|---|---|---|
| `/local-tiles/pre_earthquake.png` | 震前影像 mock | 待放入 public/local-tiles/ |
| `/local-tiles/post_earthquake.png` | 震后影像 mock | 待放入 public/local-tiles/ |

可以复用现有的 `fire.png` 或 `fire_mask_on_truecolor.png` 作为占位图，或准备两张不同的卫星图。

---

## 六、实现顺序建议

1. **region-mark 参数化**（改动最小，先打基础）
2. **satellite.ts 加 earthquakeScenario 分支**（核心基础设施）
3. **新增 earthquake-evaluation capability**（新文件，独立）
4. **Planner 写死 plan**（配置层面）
5. **Router 写死 actions**（配置层面）
6. **registry.ts 注册 + executor writeDisplayData**（收尾）
7. **端到端测试**

每步均可独立验证，符合你"由我指挥依次实现"的要求。
