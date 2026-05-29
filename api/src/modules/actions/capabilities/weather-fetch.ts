import type { Action, ActionResult } from "@datasourceintelligence/shared";
import type { Capability } from "../types.js";

// 气象数据能力（方案 B + Open-Meteo 真数据，网格风 + 单点洋流）
// - 风：10×10 网格批量查（wind_speed_10m / wind_direction_10m）→ u/v 分量喂给前端粒子层
// - 洋流：单点（ocean_current_velocity / ocean_current_direction）给事件卡片文字
// 失败兜底回原 mock 网格（均匀场）。地图回显改用 gisData.windField，不再输出 weather-marker entity。
// 详见 api/plan/wind-particle-layer.md

const MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const REQUEST_TIMEOUT_MS = 8000;

const DEFAULT_CENTER = { lat: 30.2561, lng: 123.0125 }; // 东海油膜默认中心（已东移 +0.5°）

const GRID = 10; // 10×10 网格
const HALF_SPAN_DEG = 0.5; // ±0.5°，约 100×100 km

// 0–360° → 中文 8 方位
function degToCompass(deg: number): string {
  const dirs = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
  return dirs[Math.round((deg % 360) / 45) % 8];
}

// 从尾部往前找第一个有限数值，规避 Open-Meteo hourly 数组末尾的 null
function lastFinite(arr: Array<number | null> | undefined): number | undefined {
  if (!arr) return undefined;
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

async function fetchWithTimeout(url: string, ms: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// 从 context 中尝试取 satellite 的油膜中心点
function pickCoord(context: Record<string, unknown> | undefined): { lat: number; lng: number } {
  if (!context) return { ...DEFAULT_CENTER };
  for (const value of Object.values(context)) {
    const v = value as Record<string, unknown> | undefined;
    const nested = (v?.data as Record<string, unknown> | undefined) ?? v;
    const oil = (nested as Record<string, unknown> | undefined)?.oilSpill as
      | { centerLat?: number; centerLng?: number }
      | undefined;
    if (oil && typeof oil.centerLat === "number" && typeof oil.centerLng === "number") {
      return { lat: oil.centerLat, lng: oil.centerLng };
    }
  }
  return { ...DEFAULT_CENTER };
}

// 构造 10×10 网格的坐标数组（row-major: 外层纬度变化，内层经度变化）
function buildGrid(center: { lat: number; lng: number }): { lats: number[]; lngs: number[] } {
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
  return { lats, lngs };
}

// 风向（"来自"角度，气象学约定）+ 风速 → 矢量分量 (u: 向东, v: 向北)
function dirSpeedToUV(speed: number, dirDeg: number): { u: number; v: number } {
  // 气象风向是"来自"角度（0=北风=风从北吹向南），+180 转成"流向"，再分解
  const flowDeg = (dirDeg + 180) % 360;
  const rad = (flowDeg * Math.PI) / 180;
  return { u: speed * Math.sin(rad), v: speed * Math.cos(rad) };
}

type HourlyResp = { hourly?: { [key: string]: Array<number | null> | string[] } };

export const weatherFetchCapability: Capability = {
  name: "weather-fetch",
  description:
    "气象数据：风（10×10 网格 u/v，给粒子层）+ 洋流（单点）。Open-Meteo 真数据，失败回退 mock 网格",

  execute: async (action: Action, context?: Record<string, unknown>): Promise<ActionResult> => {
    const start = Date.now();
    const { lat: cLat, lng: cLng } = pickCoord(context);
    const params = action.params as { region?: string };
    const regionName = params.region || "东海油膜片区";

    const bbox = {
      west: cLng - HALF_SPAN_DEG,
      east: cLng + HALF_SPAN_DEG,
      south: cLat - HALF_SPAN_DEG,
      north: cLat + HALF_SPAN_DEG,
    };

    const { lats, lngs } = buildGrid({ lat: cLat, lng: cLng });

    // mock 兜底常量
    const MOCK_WIND_SPEED = 3.2;
    const MOCK_WIND_DIR_DEG = 45; // 东北风（来自）
    const MOCK_CURRENT_SPEED = 0.8;
    const MOCK_CURRENT_DIR_DEG = 135; // 东南向（来自）

    const buildMockGrid = (): { u: number[]; v: number[]; speed: number[] } => {
      const { u, v } = dirSpeedToUV(MOCK_WIND_SPEED, MOCK_WIND_DIR_DEG);
      return {
        u: new Array(GRID * GRID).fill(u),
        v: new Array(GRID * GRID).fill(v),
        speed: new Array(GRID * GRID).fill(MOCK_WIND_SPEED),
      };
    };

    let windSpeedAvg = MOCK_WIND_SPEED;
    let windDirAvg = degToCompass(MOCK_WIND_DIR_DEG);
    let currentSpeed = MOCK_CURRENT_SPEED;
    let currentDir = degToCompass(MOCK_CURRENT_DIR_DEG);
    let dataSource: "open-meteo" | "mock-fallback" = "mock-fallback";

    let gridU: number[] = [];
    let gridV: number[] = [];
    let gridSpeed: number[] = [];

    try {
      // 风：batch 100 点
      const forecastQuery = new URLSearchParams({
        latitude: lats.join(","),
        longitude: lngs.join(","),
        hourly: "wind_speed_10m,wind_direction_10m",
        past_days: "3",
        forecast_days: "0",
        timezone: "Asia/Shanghai",
      });
      // 洋流：单点
      const marineQuery = new URLSearchParams({
        latitude: String(cLat),
        longitude: String(cLng),
        hourly: "ocean_current_velocity,ocean_current_direction",
        past_days: "3",
        forecast_days: "0",
        timezone: "Asia/Shanghai",
      });

      const [forecastRaw, marineRaw] = await Promise.all([
        fetchWithTimeout(`${FORECAST_URL}?${forecastQuery}`, REQUEST_TIMEOUT_MS),
        fetchWithTimeout(`${MARINE_URL}?${marineQuery}`, REQUEST_TIMEOUT_MS),
      ]);

      // 洋流（单点）
      const marine = marineRaw as HourlyResp;
      const cs = lastFinite(
        marine.hourly?.ocean_current_velocity as Array<number | null> | undefined
      );
      const cd = lastFinite(
        marine.hourly?.ocean_current_direction as Array<number | null> | undefined
      );
      if (cs !== undefined && cd !== undefined) {
        currentSpeed = +cs.toFixed(2);
        currentDir = degToCompass(cd);
      }

      // 风网格（multi-location 响应是数组，按 lats/lngs 顺序对齐 — spike 已验证）
      const forecastArr = (
        Array.isArray(forecastRaw) ? forecastRaw : [forecastRaw]
      ) as HourlyResp[];
      let allValid = forecastArr.length === GRID * GRID;
      const us: number[] = [];
      const vs: number[] = [];
      const sps: number[] = [];
      const speedSum = { v: 0, n: 0 };
      const dirVec = { x: 0, y: 0, n: 0 }; // 向量平均（避免角度跨越 360°）

      if (allValid) {
        for (let i = 0; i < GRID * GRID; i++) {
          const ws = lastFinite(
            forecastArr[i]?.hourly?.wind_speed_10m as Array<number | null> | undefined
          );
          const wd = lastFinite(
            forecastArr[i]?.hourly?.wind_direction_10m as Array<number | null> | undefined
          );
          if (ws === undefined || wd === undefined) {
            allValid = false;
            break;
          }
          const { u, v } = dirSpeedToUV(ws, wd);
          us.push(u);
          vs.push(v);
          sps.push(+ws.toFixed(1));
          speedSum.v += ws;
          speedSum.n++;
          const rad = (wd * Math.PI) / 180;
          dirVec.x += Math.sin(rad);
          dirVec.y += Math.cos(rad);
          dirVec.n++;
        }
      }

      if (allValid && us.length === GRID * GRID) {
        gridU = us;
        gridV = vs;
        gridSpeed = sps;
        windSpeedAvg = +(speedSum.v / speedSum.n).toFixed(1);
        const avgDir = (Math.atan2(dirVec.x, dirVec.y) * 180) / Math.PI;
        windDirAvg = degToCompass((avgDir + 360) % 360);
        dataSource = "open-meteo";
      } else {
        console.warn(
          "[weather-fetch] Open-Meteo batch incomplete, falling back to mock grid"
        );
        const mock = buildMockGrid();
        gridU = mock.u;
        gridV = mock.v;
        gridSpeed = mock.speed;
        dataSource = "mock-fallback";
      }
    } catch (err) {
      console.warn(
        "[weather-fetch] Open-Meteo request failed, falling back to mock grid:",
        (err as Error).message
      );
      const mock = buildMockGrid();
      gridU = mock.u;
      gridV = mock.v;
      gridSpeed = mock.speed;
      dataSource = "mock-fallback";
    }

    // 强制写死风向为东北→西南（来自东北 45°，流向西南 225°）
    console.log(`[weather-fetch] BEFORE override: dataSource=${dataSource}, windSpeedAvg=${windSpeedAvg}, windDirAvg=${windDirAvg}, gridU[0]=${gridU[0]?.toFixed(2)}, gridV[0]=${gridV[0]?.toFixed(2)}`);
    const { u: forcedU, v: forcedV } = dirSpeedToUV(MOCK_WIND_SPEED, MOCK_WIND_DIR_DEG);
    gridU = new Array(GRID * GRID).fill(forcedU);
    gridV = new Array(GRID * GRID).fill(forcedV);
    gridSpeed = new Array(GRID * GRID).fill(MOCK_WIND_SPEED);
    windSpeedAvg = MOCK_WIND_SPEED;
    windDirAvg = degToCompass(MOCK_WIND_DIR_DEG);
    console.log(`[weather-fetch] AFTER override: windSpeedAvg=${windSpeedAvg}, windDirAvg=${windDirAvg}, forcedU=${forcedU.toFixed(2)}, forcedV=${forcedV.toFixed(2)}`);

    const description =
      `风 ${windSpeedAvg} m/s · ${windDirAvg}风 | ` +
      `洋流 ${currentSpeed} m/s · ${currentDir}向 | ` +
      `数据源: ${dataSource}`;

    return {
      success: true,
      data: {
        windSpeed: windSpeedAvg,
        windDirection: windDirAvg,
        currentSpeed,
        currentDirection: currentDir,
        period: "近72小时",
        region: regionName,
        dataSource,
        description,
        gisData: {
          type: "wind-field" as const,
          windField: {
            bbox,
            grid: { rows: GRID, cols: GRID },
            u: gridU,
            v: gridV,
            speed: gridSpeed,
            timestamp: new Date().toISOString(),
            source: dataSource,
          },
        },
      },
      metadata: {
        capability: "weather-fetch",
        executionTime: Date.now() - start,
        mock: dataSource === "mock-fallback",
        dataSource,
        coord: { lat: cLat, lng: cLng },
        bbox,
        grid: `${GRID}x${GRID}`,
      },
    };
  },
};
