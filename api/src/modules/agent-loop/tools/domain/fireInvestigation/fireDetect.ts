import { z } from "zod";
import type { ToolDefinition } from "../../_shared/types.js";
import {
  BURNED_AREA_HECTARES,
  CONFIDENCE,
  FIRE_CENTER_LAT,
  FIRE_CENTER_LNG,
  FIRE_RECT,
  FIRE_TYPE,
  OVERLAY_META,
} from "./mockData.js";

const InputSchema = z.strictObject({
  region: z.string().trim().min(1).default("Kensai"),
});

type FireDetectInput = z.infer<typeof InputSchema>;

export function buildFireDetectMockTool(): ToolDefinition {
  return {
    name: "FireDetectMock",
    aliases: ["fire-detect"],
    description:
      "Deterministic mock fire detection for the Kensai demo. Returns the fire center point, burned-area polygon, and overlay metadata for post-fire imagery and burn mask.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute(input) {
      const parsed = input as FireDetectInput;
      const regionName = parsed.region;

      const summary =
        `检测到火灾活动，位于 ${regionName}（约 ${FIRE_CENTER_LNG.toFixed(3)}°E, ${FIRE_CENTER_LAT.toFixed(3)}°N）。` +
        `基于卫星遥感影像分析，烧毁区域约 ${BURNED_AREA_HECTARES} 公顷，` +
        `主要集中于边境管段地带。火灾类型推测为${FIRE_TYPE}。` +
        `建议持续监测火情蔓延趋势。`;

      return {
        summary,
        region: regionName,
        fireDetected: true,
        confidence: CONFIDENCE,
        fireType: FIRE_TYPE,
        burnedAreaHectares: BURNED_AREA_HECTARES,
        centerCoordinates: [FIRE_CENTER_LNG, FIRE_CENTER_LAT],
        gisData: {
          type: "entity" as const,
          entities: [
            {
              id: "fire-center-001",
              name: `${regionName} 火灾中心`,
              type: "fire",
              coordinates: [FIRE_CENTER_LNG, FIRE_CENTER_LAT] as [number, number],
              importance: "high",
              status: "danger",
              imageUrl: "/cesium/Assets/Images/fire-point.png",
              description: `遥感检测到的活跃火点 | 置信度: 高 | 烧毁面积: ~${BURNED_AREA_HECTARES} 公顷`,
            },
          ],
          regions: [
            {
              id: "fire-region-001",
              name: `${regionName} 烧毁区域`,
              type: "burned",
              coordinates: [
                [FIRE_RECT.west, FIRE_RECT.south],
                [FIRE_RECT.east, FIRE_RECT.south],
                [FIRE_RECT.east, FIRE_RECT.north],
                [FIRE_RECT.west, FIRE_RECT.north],
                [FIRE_RECT.west, FIRE_RECT.south],
              ] as [number, number][],
            },
          ],
          cameraView: {
            type: "point" as const,
            lng: FIRE_CENTER_LNG,
            lat: FIRE_CENTER_LAT,
            altitude: 30_000,
          },
        },
        overlayMeta: OVERLAY_META,
        metadata: { capability: "fire-detection", mock: true },
      };
    },
  };
}
