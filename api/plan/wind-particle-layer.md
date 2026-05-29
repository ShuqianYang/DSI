# `wind-particle-layer` 实现计划（windy 风格风层粒子动画）

> **Status（2026-05-12）**：Phase 1–3 已完成（后端数据通道通），Phase 4 spike 失败（`cesium-wind-layer@0.10.1` 在 `cesium@1.140 + Next 16 + React 19` 下 silent render fail）。
> 后续工作交接给专业 cesium 开发者——**接手必读**：[`wind-particle-handoff.md`](./wind-particle-handoff.md)
> Phase 4 装的 `cesium-wind-layer` 包 + spike 文件已撤回；pnpm.overrides 也回退。

> 父背景：[`weather-fetch-openmeteo.md`](./weather-fetch-openmeteo.md)（单点气象数据）
> 升级路径：把当前"油膜中心一个 marker + hover 文字"的回显方式，升级为"100 点网格风场 + Cesium 粒子流动画"，视觉对齐 windy.com。
> 范围：**只 scope 到风层**（wind）。洋流层（current）数据通道已经在 `weather-fetch.ts` 取了，本计划暂不画粒子；待风层跑通后再开二期增量。

---

## Goal

让 `subtask-3 获取气象数据` 在油污溯源链路里产出：

1. **网格数据**：Open-Meteo 拉取以**油膜中心 ±0.5°**为 bbox 的 **10×10 = 100 点**风场数据（`wind_speed_10m`, `wind_direction_10m`），换算成 `u/v` 分量传给前端。
2. **粒子动画**：CesiumMap 收到 `gisData.windField` 后，挂一层 `cesium-wind-layer`（或同类现成库）粒子流动画，3000 粒子 / 蓝→绿→红颜色编码 / 30 帧 fade trail。
3. **生命周期**：跟事件生命周期绑定——subtask-3 完成时自动出现，事件被关闭时一起移除。无独立用户开关（保留升级空间）。
4. **失败兜底**：网格请求失败或部分点 null 时，用"东海典型"均匀场 mock 网格（风 3.2 m/s 东北，复制 100 份）继续画粒子；`dataSource` 标 `mock-fallback`。

---

## 已确认的设计决策（grill 出来）

| # | 决策 | 选定值 |
|---|---|---|
| Q1 | 物理量 | **a. 只画风**（起步），洋流二期 |
| Q2 | 覆盖范围 | **a. 油膜中心 ±0.5°（约 100×100 km）** |
| Q3a | 数据网格 | **b. 10×10 = 100 点**（双线性插值后视觉丝滑） |
| Q4 | 前端实现 | **L1. 现成库 `cesium-wind-layer` 起步**；不行降级 Canvas 2D（L2） |
| Q5 | 触发与控制 | **a. 跟事件生命周期**（无独立开关） |
| Q6 | 地图布局 | **a. 只有粒子层**（无 marker，数值在事件卡片 + RightPanel） |
| Q7 | 失败兜底 | **a. 永远画**（mock 网格兜底） |
| Q8 | 数据刷新 | **a. 拉一次静态**（不轮询） |
| Q9 | 粒子样式 | **默认值**：3000 粒子、蓝→绿→红、30 帧 fade、speed factor 0.2、60 帧重生 |

---

## Architecture 速览

```
satellite (action-2)
  └─ result.data.oilSpill.{centerLng, centerLat}
       │
       ▼
weather-fetch (action-3) ── 改造 ──→ 网格化 100 点
  ├─ pickCoord(context) 拿油膜中心 (lng0, lat0)
  ├─ 构造 10×10 网格坐标列表（±0.5° 均匀分布）
  ├─ Open-Meteo `forecast?latitude=l1,l2,...&longitude=g1,g2,...&hourly=wind_speed_10m,wind_direction_10m`
  │  （单次请求多坐标 batch；Open-Meteo 文档允许 100+ 坐标 list）
  ├─ 失败 / 部分 null → mock 均匀场（speed=3.2，dir=45° 即东北）
  ├─ 把 (speed, direction) → (u, v) 矢量分量
  │     u =  speed × sin((direction + 180) × π/180)
  │     v =  speed × cos((direction + 180) × π/180)
  │   （气象学风向是"来自"角度，+180 转为"流向"，再分解 u/v）
  └─ 返回 ActionResult.data.gisData.windField = {
       bbox, grid: { rows, cols }, u: number[100], v: number[100],
       speed: number[100], timestamp, source
     }
       │
       ▼ SSE step_update.gisData （executor 已支持 nested-first 提取）
       ▼
useTaskChat / page.tsx onGisDataRequest
       │
       ▼
activeGisDataList push → CesiumMap eventGisDataList +1
       │
       ▼
CesiumMap 新增 useEffect:
  - 收到带 windField 的 gisData → 创建 / 复用 wind-layer Primitive
  - eventGisDataList 减少（事件关闭）→ 移除对应 wind-layer
```

---

## Ordered Phases

### Phase 1 — shared schema 加 `WindField` 类型

**文件**：`packages/shared/src/types/maritime.ts`（或对等 schema 位置）

```diff
+export const WindField = z.object({
+  bbox: z.object({ west: z.number(), south: z.number(), east: z.number(), north: z.number() }),
+  grid: z.object({ rows: z.number().int(), cols: z.number().int() }),
+  u: z.array(z.number()),          // east-west 分量，length = rows*cols
+  v: z.array(z.number()),          // north-south 分量
+  speed: z.array(z.number()),      // m/s, 可选展示
+  timestamp: z.string().optional(),
+  source: z.enum(["open-meteo", "mock-fallback"]),
+});
+
 export const GisData = z.object({
   type: z.enum(["entity", "region", "wind-field"]),  // 加 "wind-field"
   entities: z.array(Entity).optional(),
   trajectories: z.array(Trajectory).optional(),
   regions: z.array(Region).optional(),
+  windField: WindField.optional(),
   imageOverlays: z.array(ImageOverlay).optional(),
 });
```

**验证**：`pnpm --filter @datasourceintelligence/shared build` 0 错；下游推导出来的 TS 类型可见 `gisData.windField`。

---

### Phase 2 — 后端 `weather-fetch.ts` 扩 100 网格

**文件**：`api/src/modules/actions/capabilities/weather-fetch.ts`

要点：

```ts
const GRID = 10;            // 10×10 网格
const HALF_SPAN_DEG = 0.5;  // ±0.5°，约 100×100 km

function buildGrid(center: { lat: number; lng: number }) {
  const lats: number[] = [];
  const lngs: number[] = [];
  for (let r = 0; r < GRID; r++) {
    const lat = center.lat - HALF_SPAN_DEG + (2 * HALF_SPAN_DEG * r) / (GRID - 1);
    for (let c = 0; c < GRID; c++) {
      const lng = center.lng - HALF_SPAN_DEG + (2 * HALF_SPAN_DEG * c) / (GRID - 1);
      lats.push(lat);
      lngs.push(lng);
    }
  }
  return { lats, lngs };  // length = 100，row-major
}

function dirSpeedToUV(speed: number, dirDeg: number) {
  // 风向 = "来自"角度；转成 "流向" 角度后再分解
  const flowDeg = (dirDeg + 180) % 360;
  const rad = (flowDeg * Math.PI) / 180;
  return { u: speed * Math.sin(rad), v: speed * Math.cos(rad) };
}

// Open-Meteo 支持坐标 list 批量查询（用逗号分隔）
const url = `${FORECAST_URL}?latitude=${lats.join(",")}&longitude=${lngs.join(",")}&hourly=wind_speed_10m,wind_direction_10m&past_days=3&forecast_days=0&timezone=Asia/Shanghai`;

// 响应是数组（每个 location 一份 hourly），按顺序对应 lats/lngs
const arr = forecast as Array<{ hourly?: { wind_speed_10m?: number[]; wind_direction_10m?: number[] } }>;

const u: number[] = [];
const v: number[] = [];
const speed: number[] = [];
let allValid = true;
for (let i = 0; i < 100; i++) {
  const ws = lastFinite(arr[i]?.hourly?.wind_speed_10m);
  const wd = lastFinite(arr[i]?.hourly?.wind_direction_10m);
  if (ws == null || wd == null) { allValid = false; break; }
  const { u: ui, v: vi } = dirSpeedToUV(ws, wd);
  u.push(ui); v.push(vi); speed.push(ws);
}

if (!allValid) {
  // mock 兜底：100 点均匀场，风 3.2 m/s 东北（45°）
  const { u: u0, v: v0 } = dirSpeedToUV(3.2, 45);
  u.length = 0; v.length = 0; speed.length = 0;
  for (let i = 0; i < 100; i++) { u.push(u0); v.push(v0); speed.push(3.2); }
  source = "mock-fallback";
}
```

**注意**：Open-Meteo 在 batch 模式下返回的是数组而非单对象，需要先用一个真实 URL 验证响应 shape；如果不是数组，要回退到"100 次单点请求"（仍可控，但慢）。

返回 schema：

```ts
return {
  success: true,
  data: {
    // 现有的单点平均值（取 100 个点的均值，给事件卡片文字用）
    windSpeed: avg(speed).toFixed(1),
    windDirection: degToCompass(avgDir),
    currentSpeed: ...,  // 洋流单点仍保留
    currentDirection: ...,
    period: "近72小时",
    region: regionName,
    dataSource: source,
    gisData: {
      type: "wind-field" as const,
      windField: {
        bbox: { west: center.lng - 0.5, east: center.lng + 0.5, south: center.lat - 0.5, north: center.lat + 0.5 },
        grid: { rows: GRID, cols: GRID },
        u, v, speed,
        timestamp: new Date().toISOString(),
        source,
      },
    },
  },
  metadata: { ... },
};
```

**单独可验证**：

- 改 `api/scripts/test-weather-fetch.ts`：打印 `result.data.gisData.windField.u.slice(0, 5)`，确认有 100 个数；mock 兜底场景把 URL 换成 `https://invalid.invalid` 重跑确认 `source === "mock-fallback"`。

---

### Phase 3 — executor writeDisplayData 透传 windField

**文件**：`api/src/modules/executor/service.ts`

`weather-fetch` 这个 case 已经写过（在 weather-fetch-openmeteo.md Phase 3），只是当时透传的 gisData 是 entity 类型。这次 gisData 改成了 wind-field 类型 + `windField` 字段。**透传逻辑不需要改**（因为整个 `gisData` 对象直接透传给 events 表 / SSE）。

**确认要做的**：

- 现有 case 已经 `gisData: gis ? gis : undefined`——透传层无差别
- step_update 提取链路（之前修过的 nested-first 兼容）也会自动把新 windField 跟着透传给 SSE

**验证**：

- 跑一遍 query，DB `events` 表新增"气象数据获取完成"那条，`gisData.windField.u.length === 100`
- SSE 步骤完成时 `step_update.gisData.windField` 已 carried

---

### Phase 4 — 前端引入风层库 + 类型对齐

**装包**：

```bash
pnpm add cesium-wind-layer
# 或评估的备选：cesium-windy / @cesiumgs/wind-layer
```

> 实际选哪个包要在 Phase 4 第一步 spike：跑一个最小 example 看是否支持 Cesium ≥ 1.95（项目当前版本，需对照 package.json 确认）。如果 spike 不通，立即切到 L2 兜底（自己撸 Canvas 2D）。**spike 时长上限：4 小时**。

**前端 schema 同步**：

`src/types/prd.ts` 或对等位置加 `WindField` interface，与 shared 一致。CesiumMap 的 GisData prop 类型升级。

**spike 验证脚本**：

`src/features/wind-layer/spike.tsx`（临时）—— 在一个独立 demo 路由里跑一遍，传入硬编码的 100 点 u/v，确认能看到粒子流动；不在主流程里激活。

---

### Phase 5 — CesiumMap 集成 wind-layer + 事件生命周期

**文件**：`src/components/cesium/CesiumMap.tsx`

设计与 `syncRegions` / `eventImageOverlays` 平行——增加 `syncWindLayer` useEffect：

```ts
const windLayersRef = useRef<Map<string, WindLayer>>(new Map());  // eventId -> layer instance

useEffect(() => {
  const viewer = viewerRef.current;
  if (!viewer || viewer.isDestroyed()) return;

  // 1. 找到当前所有应当显示的风层
  const wanted = new Set<string>();
  for (const gis of eventGisDataList) {
    if (gis.windField && gis.eventId) wanted.add(gis.eventId);
  }

  // 2. 移除不再需要的
  for (const [eventId, layer] of windLayersRef.current.entries()) {
    if (!wanted.has(eventId)) {
      layer.destroy();        // cesium-wind-layer 的 API
      windLayersRef.current.delete(eventId);
    }
  }

  // 3. 新增需要的
  for (const gis of eventGisDataList) {
    if (!gis.windField || !gis.eventId) continue;
    if (windLayersRef.current.has(gis.eventId)) continue;

    const wf = gis.windField;
    const layer = new WindLayer(viewer, {
      // 数据：u/v 数组 + bbox + grid
      data: {
        u: { array: new Float32Array(wf.u), min: Math.min(...wf.u), max: Math.max(...wf.u) },
        v: { array: new Float32Array(wf.v), min: Math.min(...wf.v), max: Math.max(...wf.v) },
        width: wf.grid.cols,
        height: wf.grid.rows,
        bounds: wf.bbox,
      },
      // 视觉默认值
      particlesCount: 3000,
      colors: ['#3366ff', '#33ff66', '#ff3300'],  // 蓝→绿→红
      fadeOpacity: 0.96,
      speedFactor: 0.2,
      dropRate: 0.003,        // 1/60 ~ 60 帧重生
      lineWidth: 1.5,
    });

    windLayersRef.current.set(gis.eventId, layer);
  }
}, [eventGisDataList]);

// 卸载时清理所有 layer
useEffect(() => {
  return () => {
    for (const layer of windLayersRef.current.values()) layer.destroy();
    windLayersRef.current.clear();
  };
}, []);
```

> `WindLayer` 类的精确 API 取决于 Phase 4 spike 的选包结果——上面代码是示意，真实 API 可能不一样，按 library 文档调。

**验证**：

- subtask-3 完成 → eventGisDataList +1 (with windField) → syncWindLayer effect 创建 layer → 地图上出现粒子流
- 用户关闭事件 → eventGisDataList -1 → syncWindLayer 移除对应 layer → 粒子流消失
- 切换底图样式（深色/浅色）→ 粒子层不应被清掉（要确认 `viewer.imageryLayers.removeAll` 不误伤粒子层；如果误伤要把粒子层挂到 `viewer.scene.primitives` 而非 `imageryLayers`）

---

### Phase 6 — 端到端冒烟

| 检查 | 通过条件 |
|---|---|
| `tsc --noEmit` | 0 新错（pre-existing 错允许保留） |
| spike demo | 硬编码 u/v 网格能跑出 3000 粒子流动 |
| Open-Meteo batch 联通 | `dataSource: "open-meteo"`，u/v 长度 100，非全 0 |
| Mock 兜底 | 临时把 FORECAST_URL 换成 `https://invalid.invalid` 重跑，确认 `dataSource: "mock-fallback"` 且粒子层仍画 |
| 实时执行链路 | subtask-3 完成那一瞬，地图油膜区域附近出现粒子流（不需要等任务整体结束） |
| 事件回放 | 关闭事件后再点开 → 粒子层重新挂载，行为一致 |
| 事件关闭清场 | 关闭事件 → windLayersRef 清空，地图无残留粒子 |
| 多事件并存 | 同时打开"东海油污"两个不同 task 的事件回放 → 两层粒子叠加不会互相崩溃（理论上 layer instance 隔离，但要测） |
| 性能 | 3000 粒子下 60fps 稳；4K 屏可能掉到 30fps 是可接受底线 |
| 与现有元素共存 | 蓝东海框 + 黄红油膜框 + SAR PNG + 粒子层 同屏不打架（粒子层应在最上层渲染） |

---

## Validation 矩阵

| 项 | 命令 / 操作 | 通过条件 |
|---|---|---|
| Shared types build | `pnpm --filter @datasourceintelligence/shared build` | 0 错 |
| API tsc | `npx tsc --noEmit -p api/tsconfig.json` | 0 新错（pre-existing 数量不增） |
| 单 capability | `tsx api/scripts/test-weather-fetch.ts` | 输出 `windField.u.length === 100`，speed 平均非 0 |
| Open-Meteo batch 形态 | curl 单点 + batch URL 对比响应 shape | 确认数组结构（如果不是，按"100 次单点拆分"实现） |
| Registry | API 启动日志 | `weather-fetch` 已注册（已在 weather-fetch-openmeteo.md Phase 2 完成）|
| 前端 spike | `src/features/wind-layer/spike.tsx` 独立路由 | 硬编码 u/v 跑出粒子 |
| 实时联动 | 油污 query | subtask-3 完成时地图出现粒子流 |
| 事件清场 | 用户关闭事件 | 粒子层移除，eventGisDataList 同步减少 |
| Pre-existing TS 错 | tsc 总错数 | 不增加（基线对比） |

---

## Open Questions / Risks

1. **Open-Meteo batch API 响应 shape**：文档说支持坐标 list，但 100 个一次没在本项目验证过——可能返回 100 个独立 hourly 对象的数组，也可能是某种合并格式。**Phase 2 第一步要先 curl 一个真实 URL 看响应**；如果 batch 不是数组，要回退到"100 次单点请求 + Promise.all"，仍可控但慢且费 rate limit（100/10000 = 1%）。
2. **cesium-wind-layer 与 Cesium 版本兼容**：项目用的 Cesium 版本要先核对；如果包的最低 Cesium 比项目低很多，可能 API 不匹配。Phase 4 spike 是关键决策点——4 小时跑不通就降级到 L2 Canvas 2D。
3. **粒子层与底图切换**：CesiumMap 在 `currentStyle` 变化时会 `removeAll` imageryLayers——必须确认粒子层不挂在 `imageryLayers`，而是挂在 `scene.primitives`，避免被误伤。
4. **多事件并存**：当前 `eventId` 已经按 `auto-gis-${counter++}` 唯一化，理论上 windLayersRef Map 隔离够用；但 cesium-wind-layer 是否支持多实例并存需要 spike 时确认。
5. **性能上限**：3000 粒子在 30 fps 是 demo 可接受底线；如果掉到 15 fps，需要降到 1000 粒子或者升级到 L3（WindGL 移植）。
6. **AGENTS.md 风格冲突**：项目 AGENTS.md 强调"don't add features beyond what the task requires"——粒子动画属于明确 grill 后的产品需求，但落地时要克制：不要顺手加"洋流粒子"或"用户开关"那些超出 grill 范围的扩展。
7. **CC BY 4.0 attribution**：Open-Meteo 要求归属标注，本期 demo 不投产；上线时记得 footer 加一行（同 weather-fetch-openmeteo.md Risk 4）。
8. **风向数学**：气象学的 `wind_direction_10m` 是"来自"角度（0=北风=风从北吹来），转矢量 `u/v` 时要 `+180` 转成"流向"角度再分解；如果忘掉这一步，粒子会反向流动，肉眼很容易看出来。Phase 2 实现 + Phase 6 冒烟时重点确认。

---

## 执行顺序总结

| Phase | 改动文件 | 阻塞下一 phase？ |
|---|---|---|
| 1 | `packages/shared/src/types/maritime.ts` | 是（前后端依赖类型） |
| 2 | `api/src/modules/actions/capabilities/weather-fetch.ts` + `api/scripts/test-weather-fetch.ts` | 是（spike batch API） |
| 3 | `api/src/modules/executor/service.ts`（确认无须改）| 否 |
| 4 | `package.json` + `src/features/wind-layer/spike.tsx`（临时） | 是（spike 决定 L1/L2） |
| 5 | `src/components/cesium/CesiumMap.tsx` + `src/types/prd.ts` | 是 |
| 6 | 端到端冒烟 | — |

每步完成后由你确认再开下一步，跟 `weather-fetch-openmeteo.md` / `region-mark-unify.md` 一样节奏。

---

## 后续二期（不在本计划范围）

- **洋流粒子层**：复用 windField 整个管线，新增 `currentField` 字段；视觉上和风层颜色错开（蓝→紫→粉）
- **用户开关**：RightPanel 加一个"风层 / 洋流层"toggle，独立于事件流
- **viewport 自适应**：镜头移动时重新拉网格数据，让粒子覆盖范围跟随
- **WindGL 移植（L3）**：粒子数量需求超过 10000 时升级
