# `weather-fetch` Capability 实现计划（方案 B + Open-Meteo）

> 父计划：[`scenario-oil-spill-tracing.md`](./scenario-oil-spill-tracing.md) 3.3 节
> 本计划替代父计划 3.3 节的"无 gisData，纯文本数据"：改成接 Open-Meteo 真数据 + 地图上一个气象 entity 回显。

---

## Goal

让 `subtask-3 获取气象数据` 在油污溯源链路里产出：
1. **真实数据**：从 Open-Meteo 拉东海油膜中心点的实时风 + 洋流，失败时回退到写死 mock，不阻塞下游 `oil-drift`。
2. **地图回显**：在油膜中心点位置追加一个 `type:"base"` entity（方案 B），hover 弹出风速/风向/洋流参数。
3. **事件卡片**：左侧 events 列表里有一条"获取气象数据"，content 是 markdown 表格。

---

## Architecture 速览

```
satellite (action-2)
  └─ result.data.oilSpill.{centerLng, centerLat}
       │
       ▼
weather-fetch (action-3)
  ├─ 读 context["action-2"].oilSpill.centerLng/Lat
  ├─ ┌── Open-Meteo Marine API  (洋流)
  │   │   GET https://marine-api.open-meteo.com/v1/marine?
  │   │     latitude=..&longitude=..&hourly=ocean_current_velocity,ocean_current_direction
  │   │     &past_days=3&forecast_days=0
  │   └── Open-Meteo Forecast API (风)
  │       GET https://api.open-meteo.com/v1/forecast?
  │         latitude=..&longitude=..&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m
  │         &past_days=3&forecast_days=0
  ├─ Promise.all + 5s 超时；失败 → mock 兜底
  ├─ 取最新可用时刻索引（数组末尾）
  └─ 返回:
       data: { windSpeed, windDirection, currentSpeed, currentDirection,
               period, region, dataSource: "open-meteo" | "mock-fallback",
               gisData: { type:"entity", entities:[{ id:"weather-marker", ... }] } }
```

---

## Ordered Phases（逐 phase 可独立验证）

### Phase 1 — 创建 `weather-fetch.ts` capability

**文件**：`api/src/modules/actions/capabilities/weather-fetch.ts`（新建）

**内容要点**：

```ts
// 模块顶部
import type { Action, ActionResult } from "@datasourceintelligence/shared";
import type { Capability } from "../types.js";

const MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const REQUEST_TIMEOUT_MS = 5000;

// 0-360° → 中文方位
function degToCompass(deg: number): string {
  const dirs = ["北","东北","东","东南","南","西南","西","西北"];
  return dirs[Math.round(((deg % 360) / 45)) % 8];
}

// 带超时的 fetch
async function fetchWithTimeout(url: string, ms: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { signal: ctrl.signal }).then(r => r.json()); }
  finally { clearTimeout(t); }
}

// 从 context 找上游 satellite 的油膜中心点
function pickCoord(ctx: Record<string, unknown> | undefined): { lat: number; lng: number } {
  for (const v of Object.values(ctx || {})) {
    const data = v as Record<string, unknown> | undefined;
    const oil = (data?.data as Record<string, unknown> | undefined)?.oilSpill
             ?? (data as Record<string, unknown> | undefined)?.oilSpill;
    if (oil && typeof (oil as any).centerLat === "number") {
      return { lat: (oil as any).centerLat, lng: (oil as any).centerLng };
    }
  }
  return { lat: 30.2561, lng: 122.5125 }; // 东海油膜默认中心
}

export const weatherFetchCapability: Capability = {
  name: "weather-fetch",
  description: "气象数据：拉取指定海域近 72h 风 + 洋流（Open-Meteo），失败回退 mock",
  execute: async (action, context): Promise<ActionResult> => {
    const start = Date.now();
    const { lat, lng } = pickCoord(context);
    const regionName = (action.params as { region?: string }).region || "东海油膜片区";

    let windSpeed = 3.2, windDir = "东北", curSpeed = 0.8, curDir = "东南";
    let dataSource = "mock-fallback" as "open-meteo" | "mock-fallback";

    try {
      const marineQ = new URLSearchParams({
        latitude: String(lat), longitude: String(lng),
        hourly: "ocean_current_velocity,ocean_current_direction",
        past_days: "3", forecast_days: "0", timezone: "Asia/Shanghai",
      });
      const forecastQ = new URLSearchParams({
        latitude: String(lat), longitude: String(lng),
        hourly: "wind_speed_10m,wind_direction_10m",
        past_days: "3", forecast_days: "0", timezone: "Asia/Shanghai",
      });

      const [marine, forecast] = await Promise.all([
        fetchWithTimeout(`${MARINE_URL}?${marineQ}`, REQUEST_TIMEOUT_MS),
        fetchWithTimeout(`${FORECAST_URL}?${forecastQ}`, REQUEST_TIMEOUT_MS),
      ]);

      // Open-Meteo 返回结构：hourly.time[], hourly.<param>[] 长度对齐
      const last = (arr: number[]) => arr[arr.length - 1];
      windSpeed  = +last(forecast.hourly.wind_speed_10m).toFixed(1);
      windDir    = degToCompass(last(forecast.hourly.wind_direction_10m));
      curSpeed   = +last(marine.hourly.ocean_current_velocity).toFixed(2);
      curDir     = degToCompass(last(marine.hourly.ocean_current_direction));
      dataSource = "open-meteo";
    } catch (err) {
      console.warn("[weather-fetch] Open-Meteo failed, falling back to mock:", (err as Error).message);
    }

    const description =
      `风 ${windSpeed} m/s · ${windDir}风 | 洋流 ${curSpeed} m/s · ${curDir}向 | 数据源: ${dataSource}`;

    return {
      success: true,
      data: {
        windSpeed, windDirection: windDir,
        currentSpeed: curSpeed, currentDirection: curDir,
        period: "近72小时", region: regionName,
        dataSource,
        gisData: {
          type: "entity" as const,
          entities: [{
            id: "weather-marker",
            name: "油膜区气象参数",
            type: "base" as const,
            coordinates: [lng, lat] as [number, number],
            importance: "medium" as const,
            status: "normal" as const,
            description,
          }],
        },
      },
      metadata: {
        capability: "weather-fetch",
        executionTime: Date.now() - start,
        mock: dataSource === "mock-fallback",
        dataSource,
      },
    };
  },
};
```

**单独可验证**：临时脚本 `api/scripts/test-weather-fetch.ts`
```ts
import { weatherFetchCapability } from "../src/modules/actions/capabilities/weather-fetch.js";
weatherFetchCapability.execute({
  id: "t", type: "weather-fetch", name: "test", description: "",
  params: { region: "东海" },
}, {}).then(r => console.log(JSON.stringify(r, null, 2)));
```
`tsx api/scripts/test-weather-fetch.ts` 看输出。

---

### Phase 2 — 注册到 registry

**文件**：`api/src/modules/actions/registry.ts`

```diff
 import { regionMarkCapability } from "./capabilities/region-mark.js";
+import { weatherFetchCapability } from "./capabilities/weather-fetch.js";
 ...
 registerCapability("region-mark", regionMarkCapability);
+registerCapability("weather-fetch", weatherFetchCapability);
```

**验证**：API 重启后 `getCapability("weather-fetch")` 不为 undefined（可在 `health` 路由临时打一行 log）。

---

### Phase 3 — `writeDisplayData` 增 case

**文件**：`api/src/modules/executor/service.ts`（在 `case "region-mark":` 后插入）

```ts
case "weather-fetch": {
  const w = data as {
    windSpeed?: number; windDirection?: string;
    currentSpeed?: number; currentDirection?: string;
    period?: string; region?: string; dataSource?: string;
  };
  const gis = (data as Record<string, unknown>).gisData as Record<string, unknown> | undefined;

  const content =
`**气象参数（${w.period || "近72小时"} · ${w.region || "—"}）**

| 项 | 值 |
|---|---|
| 风速 | ${w.windSpeed} m/s |
| 风向 | ${w.windDirection}风 |
| 洋流速度 | ${w.currentSpeed} m/s |
| 洋流方向 | ${w.currentDirection}向 |
| 数据源 | ${w.dataSource || "mock-fallback"} |`;

  await db.insert(events).values({
    taskId: jobTaskId,
    taskName: action.name,
    title: `气象数据获取完成（${w.region || "东海油膜片区"}）`,
    content,
    status: "success",
    gisData: gis ? gis : undefined,
    agentTaskId,
  });
  break;
}
```

**验证**：跑一遍完整 query，DB 里 `events` 表新增一条 `taskName = "获取气象数据"`，content 是上面那个 markdown 表格，`gisData.entities[0].id === "weather-marker"`。

---

### Phase 4 — 修写死 router 的 action-3 参数

**文件**：`api/src/modules/router/service.ts`（`buildOilSpillTracingActions` 内 action-3）

把 `params.bbox` 那个 `"INFER:..."` 字符串占位换成正经字段（capability 自己会从 context 取，不再依赖 bbox）：

```diff
 params: {
-  bbox: "INFER:focus around oilFilmCenter from action-2",
+  region: "东海油膜片区",
   timeRange: { from: "...", to: "..." },
   vars: ["wind", "current"],
 },
```

> 备注：capability 已经能从 context["action-2"].data.oilSpill 拿到中心点，`region` 字段只是给 UI 看的标签；`vars / timeRange` 留着不动以保持 router 标准回复结构。

---

### Phase 5 — 端到端冒烟

1. API 重启确认 `weather-fetch` 已注册。
2. 浏览器先 ping 两个 Open-Meteo URL 看是否能直连（贴在 plan 文档 Architecture 节那两条 URL，替换经纬度）。
3. 提问写死的那条油污 query，观察：
   - SSE step 流：`subtask-3` 状态 running → completed，耗时大约几百毫秒（含网络）。
   - DB：`task_steps` 第 3 条 `status="completed"`，`result.data.dataSource === "open-meteo"`（如果国内访问通）。
   - DB：`events` 表新增"气象数据获取完成"。
   - 前端地图：油膜中心点 `122.5125, 30.2561` 旁边出现一个 type:"base" 图标，hover 描述行能看到真实风/流值。
4. 模拟失败：临时把 MARINE_URL 改成 `https://invalid.invalid/v1/marine`，重跑，确认 `dataSource === "mock-fallback"` 且不卡住下游。

---

## Validation 矩阵

| 项 | 通过条件 |
|---|---|
| `tsc --noEmit` | weather-fetch.ts 0 错；executor case 改动 0 错 |
| 单 capability | `test-weather-fetch.ts` 输出含 `gisData.entities[0]` |
| Registry | `[Capabilities] registered: weather-fetch` 日志可见 |
| Open-Meteo 联通 | `dataSource: "open-meteo"`、风速非默认 3.2 |
| 失败回退 | 断网/坏 URL 时 `dataSource: "mock-fallback"`，链路继续 |
| 地图回显 | Cesium 地图 122.51,30.26 处显示 base entity |
| 下游不受影响 | `oil-drift / ais-* `（尚未实现）依旧按原逻辑跑（目前会因为没注册而失败，这是父计划 3.4–3.7 的事，不在本计划范围） |

---

## Open Questions / Risks

1. **Open-Meteo 国内访问稳定性**：Cloudflare CDN 大概率通；如果你机器测试时通畅，我们就走真实；若不稳定，5s 超时 + mock 回退已经兜底。
2. **`past_days=3` 边界**：洋流数据可能没那么"实时"，最近一两小时可能未填，所以取 `arr[arr.length - 1]` 之前可以加 `find(v => Number.isFinite(v))` 反向找最新非 null 值；现在简单实现没做这个，必要时 Phase 1 内加 6 行。
3. **`fetch` polyfill**：项目 Node 版本若 ≥ 18，原生 `fetch` 可用；若 <18 需 `undici` 或 `node-fetch`。开干 Phase 1 前先确认 `package.json` 的 engines / 实际运行版本。
4. **CC BY 4.0 attribution**：Open-Meteo 要求标注。本期 demo 不投产，但 Phase 5 之后可以在前端 footer 加一行"气象数据由 Open-Meteo 提供"以备后续。
5. **Entity 视觉**：方案 B 用默认 `type:"base"` 图标，跟 satellite 推出来的"油膜中心点"图标可能撞色重叠。要不要给气象 entity 单独配一张 `imageUrl: "/satellite/weather-marker.png"` 图标？这是 Phase 1 的小决定，需要的话 phase 1 同步加 `imageUrl` 字段并要求你提供（或我们暂用占位 PNG）。
6. **失败兜底的"static mock"** 的内容跟父计划 3.3 完全一致（windSpeed=3.2 等），保持向后兼容；后期想换值不影响接口。

---

## 执行顺序总结

| Phase | 改动文件 | 是否阻塞下一 phase |
|---|---|---|
| 1 | `capabilities/weather-fetch.ts`（新建）+ 测试脚本 | 否（可独立测）|
| 2 | `registry.ts`（追加 2 行） | 是 |
| 3 | `executor/service.ts` `writeDisplayData`（加 case） | 是（否则 events 表不出来）|
| 4 | `router/service.ts`（改 action-3 params 一处）| 否（清理工作）|
| 5 | 端到端冒烟 + 失败回退验证 | — |

每步完成你确认后再开下一步。
