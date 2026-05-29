import { v4 as uuidv4 } from "uuid";
import type { Action, ActionResult } from "@datasourceintelligence/shared";
import type { Capability } from "../types.js";

// ==================== 火灾检测能力（Mock） ====================
//
// 当前为 Mock 实现，返回 Kensai 地区（76.998°E, 43.2635°N，FIRE_RECT 几何中心）的固定火灾数据。
// 后续可接入真实遥感分析服务或 Dify Agent。

const FIRE_CENTER_LNG = 76.998;
const FIRE_CENTER_LAT = 43.2635;
const FIRE_RECT = {
  west: 76.967,
  south: 43.241,
  east: 77.029,
  north: 43.286,
};

function generateFireSummary(): string {
  return `检测到火灾活动，位于哈萨克斯坦 Kensai 地区（约 ${FIRE_CENTER_LNG}°E, ${FIRE_CENTER_LAT}°N）。` +
    `基于 Sentinel-2 卫星影像分析，烧毁区域约 1,200 公顷，` +
    `主要集中于河谷地带。火灾类型推测为草原/灌木火灾。` +
    `建议持续监测火情蔓延趋势。`;
}

export const fireCapability: Capability = {
  name: "fire-detector",
  description: "火灾检测与烧毁区域分析：基于卫星遥感数据识别火灾位置、评估烧毁范围",

  execute: async (
    action: Action,
    _context?: Record<string, unknown>
  ): Promise<ActionResult> => {
    const startTime = Date.now();
    const params = action.params as {
      region?: string;
      query?: string;
      bbox?: [number, number, number, number];
      fromScenario?: boolean;
    };
    const query = params.query || "火灾检测";

    console.log(`[FireDetector] Executing with query: ${query}`);

    // demo 阶段：overlay PNG（fire.png / fire_mask）固定对应 Kensai 坐标，
    // 因此 GIS 数据坐标始终保持 Kensai，只把文字标签换成传入的 regionName。
    const regionName = params.region || "Kensai";
    const [west, south, east, north] = [
      FIRE_RECT.west,
      FIRE_RECT.south,
      FIRE_RECT.east,
      FIRE_RECT.north,
    ];
    const centerLng = FIRE_CENTER_LNG;
    const centerLat = FIRE_CENTER_LAT;
    const burnedAreaHectares = 1200;

    const summary =
      `检测到火灾活动，位于 ${regionName}（约 ${centerLng.toFixed(3)}°E, ${centerLat.toFixed(3)}°N）。` +
      `基于卫星遥感影像分析，烧毁区域约 ${burnedAreaHectares} 公顷，` +
      `主要集中于边境管段地带。火灾类型推测为草原/灌木火灾。` +
      `建议持续监测火情蔓延趋势。`;

    const gisData = {
      type: "fire" as const,
      entities: [
        {
          id: "fire-center-001",
          name: `${regionName} 火灾中心`,
          type: "fire",
          coordinates: [centerLng, centerLat] as [number, number],
          importance: "high",
          status: "danger",
          imageUrl: "/cesium/Assets/Images/fire-point.png",
          description: `遥感检测到的活跃火点 | 置信度: 高 | 烧毁面积: ~${burnedAreaHectares} 公顷`,
        },
      ],
      regions: [
        {
          id: "fire-region-001",
          name: `${regionName} 烧毁区域`,
          type: "burned",
          coordinates: [
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south],
          ] as [number, number][],
        },
      ],
    };

    const data = {
      region: regionName,
      analysisId: uuidv4(),
      timestamp: new Date().toISOString(),
      summary: {
        fireDetected: true,
        location: regionName,
        centerCoordinates: [centerLng, centerLat],
        burnedAreaHectares,
        confidence: "high",
        fireType: "草原/灌木火灾",
        riskAssessment: summary,
      },
      gisData,
      overlayMeta: {
        postFireImageUrl: "/local-tiles/fire.png",
        maskImageUrl: "/local-tiles/fire_mask_on_truecolor.png",
        rectangle: { west, south, east, north },
      },
    };

    return {
      success: true,
      data,
      metadata: {
        capability: "fire-detector",
        executionTime: Date.now() - startTime,
        source: "mock",
      },
    };
  },
};
