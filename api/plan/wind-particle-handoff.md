# Wind Field Handoff — 数据已就绪，等接粒子渲染

> 对接对象：要在 Cesium 上画风层粒子动画的前端工程师
> 状态：**后端数据通道全通**（Phase 1–3 已完成），**前端粒子渲染需要重新做**（cesium-wind-layer 在本项目环境下 silent fail，详见 §7）
> 父计划：[`wind-particle-layer.md`](./wind-particle-layer.md)（包含完整设计决策与 grill 记录）

---

## 1. 你能拿到什么

后端会在 SSE `step_update` 事件里**实时推送** 100 点（10×10 网格）风场数据，覆盖东海油膜中心 ±0.5° 范围。每次"油污溯源"任务 subtask-3 完成时触发一次推送；事件回放（点击事件卡片）时也会再推一次。

数据已经做过：
- ✅ 网格化坐标生成（row-major，纬度外层、经度内层）
- ✅ Open-Meteo `forecast` API 真数据拉取（`wind_speed_10m` / `wind_direction_10m`）
- ✅ 气象"来自"角度 → `u/v` 矢量分量换算（含 +180 反转）
- ✅ 失败兜底：网络/部分点 null 时回退 mock 网格（均匀 3.2 m/s 东北风）
- ✅ Shared zod schema（`WindField`）+ TypeScript 类型
- ✅ SSE step_update 链路把 gisData 实时推到前端 `eventGisDataList`

你只需要写"拿到数据后画粒子"的那一段。

---

## 2. 数据 schema

源文件：`packages/shared/src/types/maritime.ts`

```ts
// zod schema
export const WindField = z.object({
  bbox: z.object({
    west: z.number(),
    south: z.number(),
    east: z.number(),
    north: z.number(),
  }),
  grid: z.object({
    rows: z.number().int(),    // 10
    cols: z.number().int(),    // 10
  }),
  u: z.array(z.number()),      // 长度 rows*cols = 100，row-major
  v: z.array(z.number()),      // 长度 100
  speed: z.array(z.number()),  // 长度 100，m/s
  timestamp: z.string().optional(),
  source: z.enum(["open-meteo", "mock-fallback"]),
});
export type WindField = z.infer<typeof WindField>;

// GisData 上的位置
export const GisData = z.object({
  type: z.enum(["entity", "trajectory", "region", "image", "wind-field"]),
  // ... 其他字段
  windField: WindField.optional(),
  // ... 其他字段
});
```

### 字段语义

| 字段 | 含义 | 单位 | 备注 |
|---|---|---|---|
| `bbox.west/south/east/north` | 网格地理边界 | WGS84 度 | 油膜中心 ±0.5°，约 100×100 km |
| `grid.rows` | 纬度方向点数 | — | 当前 10 |
| `grid.cols` | 经度方向点数 | — | 当前 10 |
| `u[i]` | 该点风的 **东西** 分量（+ = 向东） | m/s | 已经从 wind_direction +180 转过 |
| `v[i]` | 该点风的 **南北** 分量（+ = 向北） | m/s | 已经从 wind_direction +180 转过 |
| `speed[i]` | 该点合风速标量 | m/s | = √(u² + v²)（或直接来自 API） |
| `timestamp` | 数据生成时刻 ISO 8601 | — | 可选 |
| `source` | `"open-meteo"` = 真数据；`"mock-fallback"` = 网络失败回退 | — | 必填 |

### Row-major 索引约定

`u/v/speed` 都是 row-major，第 `i` 个点的地理坐标：

```ts
const r = Math.floor(i / grid.cols);   // 0..rows-1，从南到北
const c = i % grid.cols;               // 0..cols-1，从西到东
const lat = bbox.south + (bbox.north - bbox.south) * r / (grid.rows - 1);
const lng = bbox.west  + (bbox.east  - bbox.west)  * c / (grid.cols - 1);
```

如果你用的库期望"image"形态的 `Float32Array`（width × height），直接：

```ts
const uArr = new Float32Array(windField.u);
const vArr = new Float32Array(windField.v);
// width = grid.cols, height = grid.rows
```

注意常见库要求 **Y 轴翻转**——OpenGL/WebGL 纹理 Y 朝上，而我们的 `r=0` 对应**南端**（最低纬度）。如果库假设 `r=0` 是顶部（北端），需要 `flipY: true` 或者自己上下翻一遍。我们目前是"南端 → 北端"递增。

---

## 3. 风向数学（已做完，仅供 verify）

源文件：`api/src/modules/actions/capabilities/weather-fetch.ts:81-87`

气象学风向是 **"来自"** 角度（0° = 北风 = 风从北边吹来）。库里通常期望矢量是**流向**——所以做了 `(dir + 180) % 360` 反转，然后分解：

```ts
function dirSpeedToUV(speed: number, dirDeg: number): { u: number; v: number } {
  const flowDeg = (dirDeg + 180) % 360;     // "来自" → "流向"
  const rad = (flowDeg * Math.PI) / 180;
  return {
    u: speed * Math.sin(rad),               // 向东分量
    v: speed * Math.cos(rad),               // 向北分量
  };
}
```

**Sanity check**：东北风（dirDeg=45，"来自东北"）的 u/v 都应该是负值（风向西南流）。Phase 2 实测 `u[0..4] = [-3.10, -4.79, -5.71, -6.38, -7.73]`——符号正确。

---

## 4. JSON 样本

下面是一份**真实**的 weather-fetch 返回（你可以拿来 mock 测试）：

```json
{
  "success": true,
  "data": {
    "windSpeed": 17,
    "windDirection": "南",
    "currentSpeed": 0.12,
    "currentDirection": "东",
    "period": "近72小时",
    "region": "中国东海",
    "dataSource": "open-meteo",
    "description": "风 17 m/s · 南风 | 洋流 0.12 m/s · 东向 | 数据源: open-meteo",
    "gisData": {
      "type": "wind-field",
      "windField": {
        "bbox": {
          "west": 122.5125,
          "east": 123.5125,
          "south": 29.7561,
          "north": 30.7561
        },
        "grid": { "rows": 10, "cols": 10 },
        "u": [-3.10, -4.79, -5.71, -6.38, -7.73, "... 95 more"],
        "v": [/* 100 numbers */],
        "speed": [/* 100 numbers */],
        "timestamp": "2026-05-12T03:14:00.000Z",
        "source": "open-meteo"
      }
    }
  },
  "metadata": {
    "capability": "weather-fetch",
    "executionTime": 401,
    "mock": false,
    "dataSource": "open-meteo",
    "coord": { "lat": 30.2561, "lng": 123.0125 },
    "bbox": { "west": 122.5125, "east": 123.5125, "south": 29.7561, "north": 30.7561 },
    "grid": "10x10"
  }
}
```

要拿 100 个真实数字自己跑：

```bash
npx tsx api/scripts/test-weather-fetch.ts
```

---

## 5. 数据流（前后端）

```
satellite (subtask-2)
  └─ result.data.oilSpill.{centerLng, centerLat}  → 写入 context
       │
       ▼
weather-fetch (subtask-3)
  ├─ pickCoord(context) 拿油膜中心
  ├─ buildGrid(center) 生成 100 点 lats/lngs
  ├─ Open-Meteo batch 一次请求拿 100 点 hourly 数组
  ├─ lastFinite 取每点最新非 null 风速/风向
  ├─ dirSpeedToUV 转 u/v
  └─ 返回 result.data.gisData.windField
       │
       ▼
executor/service.ts:171-174  publishStepUpdate + notifyTaskUpdate
  └─ Redis pub → SSE step_update message 带 `gisData` 字段
       │
       ▼ (浏览器 SSE)
useTaskChat.ts:327-331  data.type === "step_update" + data.gisData
  └─ onGisDataRequest(data.gisData) callback
       │
       ▼
page.tsx:54-63  setGisData → useEffect → setActiveGisDataList((prev) => [...prev, { ...gisData, eventId }])
       │
       ▼
CesiumMap.tsx eventGisDataList prop  ← 你要在这接管渲染
```

---

## 6. 你需要写的部分

### 位置

`src/components/cesium/CesiumMap.tsx` —— 跟现有 `syncRegions`（line 898）、`eventImageOverlays`（line 1093）平行，新增 `syncWindLayer` useEffect。

### 生命周期

- **新增**：每次 `eventGisDataList` 里出现新的带 `windField` 的 gisData（按 `eventId` 唯一标识），创建一个粒子层实例
- **保留**：`eventGisDataList` 里仍存在 → 粒子层留着
- **移除**：用户关闭事件 → `eventGisDataList` 里某条 `eventId` 消失 → 销毁对应粒子层
- **多事件并存**：不同 `eventId` 各挂一层（如果库不支持多实例，按 `eventId` 切换显示也可）

### 推荐骨架

```ts
const windLayersRef = useRef<Map<string, /* YourWindLayer */>>(new Map());

useEffect(() => {
  const viewer = viewerRef.current;
  if (!viewer || viewer.isDestroyed()) return;

  // 1. 当前应当显示的 eventIds
  const wanted = new Set<string>();
  for (const gis of eventGisDataList) {
    if (gis.windField && gis.eventId) wanted.add(gis.eventId);
  }

  // 2. 移除不再要的
  for (const [eventId, layer] of windLayersRef.current.entries()) {
    if (!wanted.has(eventId)) {
      layer.destroy();
      windLayersRef.current.delete(eventId);
    }
  }

  // 3. 新增
  for (const gis of eventGisDataList) {
    if (!gis.windField || !gis.eventId) continue;
    if (windLayersRef.current.has(gis.eventId)) continue;

    const wf = gis.windField;
    const layer = new YourWindLayer(viewer, {
      bounds: wf.bbox,
      width: wf.grid.cols,
      height: wf.grid.rows,
      u: new Float32Array(wf.u),
      v: new Float32Array(wf.v),
      // 视觉默认值（grill 已确认）
      particleCount: 3000,
      colors: ['#3366ff', '#33ff66', '#ff3300'],   // 蓝→绿→红
      speedFactor: 1.0,
      lifeSpan: 60,                                 // 帧
    });
    windLayersRef.current.set(gis.eventId, layer);
  }
}, [eventGisDataList]);

// 卸载清理
useEffect(() => () => {
  for (const layer of windLayersRef.current.values()) layer.destroy();
  windLayersRef.current.clear();
}, []);
```

### 视觉规范（来自 grill）

| 参数 | 期望值 | 备注 |
|---|---|---|
| 粒子数量 | 3000（性能不够降到 1000） | windy.com 量级 |
| 颜色编码 | 蓝（弱）→ 绿（中）→ 红（强） | 速度映射 |
| 尾迹长度 | 30 帧 | windy 默认值 |
| 速度系数 | 1.0 起步 | 视觉太慢/太快再调 |
| 生命周期 | 60 帧重生 | 防粒子飞太远脱离视野 |

---

## 7. 已 spike 但失败的方案（**避雷**）

**`cesium-wind-layer@0.10.1`** 在本项目环境（cesium@1.140.0 + Next.js 16 + React 19）下 **silent render fail**。

实测的诊断证据全部"看起来正常"：

| 指标 | 实测值 | 含义 |
|---|---|---|
| npm peer | OK | `cesium ^1.127.0` 兼容 |
| `@cesium/engine` 单实例 | OK | dual instance 已通过移除 root 直接依赖 + pnpm overrides 修掉 |
| WebGL2 | `enabled: true` | 显式 `contextOptions.requestWebgl2: true` 启用 |
| `layer.add()` | `scene.primitives delta = 4` | primitive 挂上了 |
| `layer.show` | `true` | 可见性 flag OK |
| `layer.zoomTo(0)` | OK | 镜头按库定的视角飞 |
| baseLayer / Ion token / depth test | 都 OK | 黄色 bbox 矩形可见，视野在范围内 |
| Console error | **零错** | 不抛任何东西 |
| **粒子实际渲染** | ❌ 全屏空 | shader pipeline silent fail |

我们的 spike 文件已经撤回（连同 `cesium-wind-layer` 包）。如果你要复现失败现象、对比修复：

```bash
# 找到删除 spike 的 commit
git log --diff-filter=D --name-only -- src/features/wind-layer/WindSpikeMap.tsx
# 拉出 spike 文件原内容（替换 <commit> 为该 commit 的父提交 hash）
git show <commit>^:src/features/wind-layer/WindSpikeMap.tsx
git show <commit>^:src/app/wind-spike/page.tsx

# 重新装库
pnpm add cesium-wind-layer
```

Phase 4 spike 时长上限 4h 已经超出，决定降级方案。

**怀疑根因**（未坐实，留给接手者验证）：

1. cesium-wind-layer 内部 shader 对 cesium 1.140 的 `viewer.scene.context` API 兼容性问题
2. React 19 + Next 16 webpack hot reload 导致库内部 WebGL state 错乱
3. Transform feedback / float texture 某种实际不支持的 extension

---

## 8. 备选实现路径

| 路径 | 工作量 | 风险 | 视觉档次 |
|---|---|---|---|
| **A. Canvas 2D 自撸**（L2）| 3-5 天 | 低，windy.com 早期就这么做 | windy 6 成像，~2000 粒子 |
| B. WindGL（Mapbox）shader 移植到 Cesium customPrimitive | 1-2 周 | 高，cesium 内部 API 复杂 | windy 10 成像 |
| C. fork `cesium-wind-layer` 自己 debug shader | 1-2 天 | 极高，shader debug 无底洞 | 顶级（如果修通） |
| D. 静态箭头网格（PolylineCollection）| 1-2 天 | 低 | windy 4 成像，无动画 |
| E. 试别的库（`cesium-windy` / `Cesium-3D-Wind-Field`） | 0.5-1 天 spike | 中，星都不多，maintain 一般 | 不可知 |

**推荐起步顺序**：E 速 spike 30 分钟 → 没救就 A。B/C 是产品级才值得做。D 是 graceful fallback（任何 demo 场景兜底）。

---

## 9. 联调清单

实现后请走一遍：

1. **后端实时推送**：跑 `npx tsx api/scripts/test-weather-fetch.ts`，确认 `windField.u.length === 100` 且 `source === "open-meteo"`（如果你本地能连 Open-Meteo）
2. **SSE 链路通**：在浏览器 console 看到 `[useTaskChat] Received GIS data (step_update):` 带 `windField` 字段
3. **首次渲染**：subtask-3 完成那一瞬地图油膜区域出现粒子流
4. **多事件并存**：触发两次"油污溯源"任务，两层粒子并存不互相崩溃
5. **关闭事件**：关掉事件回放 → 对应粒子层销毁、`windLayersRef` 不残留
6. **底图切换**：用户切换底图样式（深色/浅色）→ 粒子层不应被误清（确认你的实现不挂在 `viewer.imageryLayers`，而是 `viewer.scene.primitives`）
7. **性能**：3000 粒子下 30+ fps 是底线；4K 屏掉到 30 可接受

---

## 10. 参考路径

| 文件 | 用途 |
|---|---|
| `packages/shared/src/types/maritime.ts:90-117` | WindField + GisData zod schema |
| `api/src/modules/actions/capabilities/weather-fetch.ts` | 后端 capability 实现（含 buildGrid / dirSpeedToUV / mock 兜底）|
| `api/src/modules/executor/service.ts:170-174` | step_update SSE 推送链路（gisData 透传）|
| `api/scripts/test-weather-fetch.ts` | 独立测试脚本，能直接拉一份真数据 |
| `src/hooks/useTaskChat.ts:327-331` | 前端 SSE handler 把 gisData 推到 page state |
| `src/app/page.tsx:54-63` | gisData → activeGisDataList 的桥接 |
| `src/components/cesium/CesiumMap.tsx:898` 起 | `syncRegions` —— 你要新增的 `syncWindLayer` 应当与它平行 |
| ~~`src/features/wind-layer/WindSpikeMap.tsx`~~ | 已撤回；如需复现失败现象见 §7 git 命令 |
| `api/plan/wind-particle-layer.md` | 完整设计计划与 grill 决策记录 |

如有疑问直接看上面这些路径——所有 grill 决策与设计取舍都在 plan 文档里固定了。
