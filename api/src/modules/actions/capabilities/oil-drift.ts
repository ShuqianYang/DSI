import type { Action, ActionResult } from "@datasourceintelligence/shared";
import type { Capability } from "../types.js";

// 油污漂移反推（Mock 半动态）
// - 油膜中心从 context（satellite.data.oilSpill.centerLng/Lat）取，回退默认东海中心
// - 风/洋流参数从 context（weather-fetch.data）取，回退默认 mock
// - 排污原点 = 油膜中心东北偏北 ~3.5 km（按 mock 数据约定的固定偏移）
// - 漂移路径：5 点线性插值（起点 = 排污原点，终点 = 油膜中心）
// - 仅推送 entity（排污原点）+ trajectory（漂移路径）；status: "danger" 自然渲染为红
// 详见：api/plan/oil-spill-mock-data.md §2 + api/plan/scenario-oil-spill-tracing.md §3.4

const DEFAULT_OIL_CENTER = { lat: 30.2561, lng: 123.0125 }; // 东海油膜默认中心（已东移 +0.5°）
const ORIGIN_OFFSET_LNG = 0.025; // 排污原点相对油膜中心：东偏 ~2.4 km
const ORIGIN_OFFSET_LAT = 0.02; // 排污原点相对油膜中心：北偏 ~2.2 km
const DRIFT_PATH_POINTS = 5;
const ORIGIN_RADIUS_DEG = 0.002; // 排污原点 region 半径，约 200 m
const ORIGIN_RING_POINTS = 16; // 圆形多边形边数

// 从 context 中找 satellite 推送的油膜中心
function pickOilCenter(context: Record<string, unknown> | undefined): { lat: number; lng: number } {
  if (!context) return { ...DEFAULT_OIL_CENTER };
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
  return { ...DEFAULT_OIL_CENTER };
}

// 从 context 中找 weather-fetch 推送的风/洋流
function pickWeather(context: Record<string, unknown> | undefined): {
  windSpeed: number;
  windDirection: string;
  currentSpeed: number;
  currentDirection: string;
} {
  const defaults = {
    windSpeed: 3.2,
    windDirection: "东北",
    currentSpeed: 0.8,
    currentDirection: "东南",
  };
  if (!context) return defaults;
  for (const value of Object.values(context)) {
    const v = value as Record<string, unknown> | undefined;
    if (typeof v?.windSpeed === "number" && typeof v?.currentSpeed === "number") {
      return {
        windSpeed: v.windSpeed as number,
        windDirection: (v.windDirection as string) || defaults.windDirection,
        currentSpeed: v.currentSpeed as number,
        currentDirection: (v.currentDirection as string) || defaults.currentDirection,
      };
    }
  }
  return defaults;
}

// 度数 → DMS 简记（如 "东经123°02′15″"）
function toDMS(deg: number, isLng: boolean): string {
  const absDeg = Math.abs(deg);
  const d = Math.floor(absDeg);
  const minDec = (absDeg - d) * 60;
  const m = Math.floor(minDec);
  const s = Math.round((minDec - m) * 60);
  const prefix = isLng ? (deg >= 0 ? "东经" : "西经") : deg >= 0 ? "北纬" : "南纬";
  return `${prefix}${d}°${String(m).padStart(2, "0")}′${String(s).padStart(2, "0")}″`;
}

/** 气象「来自」方位 → 风流去向（度，顺时针自真北） */
function compassWindToFlowDeg(windDirection: string): number {
  const key = windDirection.replace(/风$/, "").trim();
  const fromDeg: Record<string, number> = {
    北: 0,
    东北: 45,
    东: 90,
    东南: 135,
    南: 180,
    西南: 225,
    西: 270,
    西北: 315,
  };
  return ((fromDeg[key] ?? 45) + 180) % 360;
}

// 在 (lng, lat) 周围生成 N 边形圆环（半径以度为单位，纬度方向 ×cos(lat) 补偿地球曲率）
function buildCircle(
  centerLng: number,
  centerLat: number,
  radiusDeg: number,
  points: number
): [number, number][] {
  const ring: [number, number][] = [];
  const latScale = Math.cos((centerLat * Math.PI) / 180);
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    ring.push([
      +(centerLng + radiusDeg * Math.cos(angle)).toFixed(5),
      +(centerLat + radiusDeg * Math.sin(angle) * latScale).toFixed(5),
    ]);
  }
  ring.push(ring[0]); // 闭合
  return ring;
}

export const oilDriftCapability: Capability = {
  name: "oil-drift",
  description:
    "油污漂移反推：结合油膜中心与气象参数，反推排污原点 + 漂移路径 + 时间窗",

  execute: async (
    _action: Action,
    context?: Record<string, unknown>
  ): Promise<ActionResult> => {
    const start = Date.now();
    const oilCenter = pickOilCenter(context);
    const weather = pickWeather(context);

    // 排污原点：油膜中心东北偏北 ~3.5 km
    const originLng = +(oilCenter.lng + ORIGIN_OFFSET_LNG).toFixed(4);
    const originLat = +(oilCenter.lat + ORIGIN_OFFSET_LAT).toFixed(4);

    // 5 点漂移路径线性插值（起点 = 排污原点，终点 = 油膜中心）
    const driftPath: [number, number][] = [];
    for (let i = 0; i < DRIFT_PATH_POINTS; i++) {
      const t = i / (DRIFT_PATH_POINTS - 1);
      driftPath.push([
        +(originLng - ORIGIN_OFFSET_LNG * t).toFixed(4),
        +(originLat - ORIGIN_OFFSET_LAT * t).toFixed(4),
      ]);
    }

    // 漂移路径长度：经度 1° ≈ 96 km @ 30°N，纬度 1° ≈ 111 km
    const driftPathLengthKm =
      Math.round(
        Math.sqrt(
          Math.pow(ORIGIN_OFFSET_LNG * 96, 2) +
            Math.pow(ORIGIN_OFFSET_LAT * 111, 2)
        ) * 10
      ) / 10;

    const originLngDMS = toDMS(originLng, true);
    const originLatDMS = toDMS(originLat, false);

    const description =
      `油污漂移反推完成。` +
      `排污原点 ${originLngDMS}, ${originLatDMS} | ` +
      `漂移 ${driftPathLengthKm} km | ` +
      `时间窗 近72h内10:00-12:00 | ` +
      `气象输入 风 ${weather.windSpeed}m/s ${weather.windDirection}风 / 洋流 ${weather.currentSpeed}m/s ${weather.currentDirection}向`;

    return {
      success: true,
      data: {
        message: description,
        driftPathLengthKm,
        driftPath,
        pollutionOrigin: {
          lng: originLng,
          lat: originLat,
          lngDMS: originLngDMS,
          latDMS: originLatDMS,
          timeRange: "近72小时内10:00-12:00（UTC+8）",
          confidence: "误差≤2小时",
        },
        weatherInput: weather,
        gisData: {
          type: "trajectory" as const,
          trajectories: [
            {
              id: "drift-path",
              name: "油污漂移溯源路径",
              type: "route" as const,
              coordinates: driftPath,
              status: "history" as const,
            },
          ],
          // 排污原点用 region 而非 entity（语义：找到一片排污区域，不是一个 marker）
          regions: [
            {
              id: "pollution-origin-area",
              name: "排污原点",
              type: "monitor" as const,
              coordinates: buildCircle(
                originLng,
                originLat,
                ORIGIN_RADIUS_DEG,
                ORIGIN_RING_POINTS
              ),
              style: {
                fill: true,
                fillColor: "rgba(220, 38, 38, 0.4)",
                outlineColor: "#dc2626",
                outlineWidth: 3,
                // 前端排污原点沿风向扩散动画（见 oilSpillDiffusionEffect.ts）
                diffusion: {
                  windFlowDeg: compassWindToFlowDeg(weather.windDirection),
                  windSpeed: weather.windSpeed,
                },
              } as {
                fill: boolean;
                fillColor: string;
                outlineColor: string;
                outlineWidth: number;
                diffusion: { windFlowDeg: number; windSpeed: number };
              },
              label: {
                text: `排污原点\n${originLngDMS}\n${originLatDMS}`,
                position: [originLng, originLat + 0.003] as [number, number],
              },
            },
          ],
          cameraView: {
            type: "point" as const,
            lng: 123.035275,
            lat: 30.271615,
            altitude: 7968,
          },
        },
      },
      metadata: {
        capability: "oil-drift",
        executionTime: Date.now() - start,
        mock: true,
        oilCenter,
        originOffset: { lng: ORIGIN_OFFSET_LNG, lat: ORIGIN_OFFSET_LAT },
      },
    };
  },
};
