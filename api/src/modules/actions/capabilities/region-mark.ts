import type { Action, ActionResult } from "@datasourceintelligence/shared";
import type { Capability } from "../types.js";

// ==================== 区域标记能力（Mock） ====================
// 东海边界由前端按 china.geojson 同样方式加载 public/geo/eastern_china_sea.geojson

export const EAST_CHINA_SEA_REGION_ID = "region-east-china-sea";

const EAST_CHINA_SEA = {
  name: "中国东海",
  bounds: {
    north: 33.5,
    south: 23.0,
    east: 128.5,
    west: 119.5,
  },
  outline: [] as [number, number][],
  center: [125.21708986497, 29.13089135213] as [number, number],
  cameraAltitude: 2527078,
  labelText: (b: { west: number; east: number; south: number; north: number }) =>
    `中国东海\n东经 ${b.west}°–${b.east}° / 北纬 ${b.south}°–${b.north}°`,
  boundaryDescription:
    "北起长江口北岸到韩国济州岛一线，南至广东省南澳岛与台湾岛南端鹅銮鼻一线",
};

// 广西柳州市柳南区（地震评估场景）
const LIUZHOU = {
  name: "广西柳州市柳南区",
  bounds: {
    north: 24.42,
    south: 24.34,
    east: 109.32,
    west: 109.20,
  },
  outline: [
    [109.20, 24.34],
    [109.32, 24.34],
    [109.32, 24.42],
    [109.20, 24.42],
    [109.20, 24.34],
  ] as [number, number][],
  center: [109.261081, 24.383662] as [number, number],
  cameraAltitude: 27101,
  labelText: (_b: { west: number; east: number; south: number; north: number }) =>
    "柳州市柳南区\n震中 109.26°E, 24.38°N",
  boundaryDescription: "广西柳州市柳南区评估区域",
};

// 湖南石门县（暴雨洪涝评估场景）
const SHIMEN = {
  name: "湖南石门县",
  bounds: {
    north: 30.05,
    south: 29.55,
    east: 111.25,
    west: 110.65,
  },
  outline: [
    [110.65, 29.55],
    [111.25, 29.55],
    [111.25, 30.05],
    [110.65, 30.05],
    [110.65, 29.55],
  ] as [number, number][],
  center: [110.958958, 29.798961] as [number, number],
  cameraAltitude: 153131,
  labelText: (_b: { west: number; east: number; south: number; north: number }) =>
    "湖南石门县\n张家渡大桥 110.96°E, 29.80°N",
  boundaryDescription: "湖南石门县澧水/渫水流域洪涝评估区域",
};

const REGION_PRESETS: Record<string, typeof EAST_CHINA_SEA> = {
  "中国东海": EAST_CHINA_SEA,
  "东海": EAST_CHINA_SEA,
  "柳州": LIUZHOU,
  "柳州市": LIUZHOU,
  "柳南区": LIUZHOU,
  "广西柳州市柳南区": LIUZHOU,
  "石门": SHIMEN,
  "石门县": SHIMEN,
  "湖南石门": SHIMEN,
  "湖南石门县": SHIMEN,
};

export const regionMarkCapability: Capability = {
  name: "region-mark",
  description: "区域标记：在GIS地图上框选并标记指定海域/区域范围，生成标准化区域边界图层",

  execute: async (
    action: Action,
    _context?: Record<string, unknown>
  ): Promise<ActionResult> => {
    const startTime = Date.now();
    const params = action.params as { region?: string; query?: string };
    const regionName = params.region || "中国东海";

    console.log(`[RegionMark] Marking region: ${regionName}`);

    // 参数化匹配区域 preset，未匹配回退东海
    let preset = EAST_CHINA_SEA;
    const searchKey = Object.keys(REGION_PRESETS).find((k) => regionName.includes(k));
    if (searchKey) {
      preset = REGION_PRESETS[searchKey];
      console.log(`[RegionMark] Matched preset: ${preset.name}`);
    } else {
      console.log(`[RegionMark] No preset match for "${regionName}", fallback to 东海`);
    }

    const isEastChinaSea = preset.name === "中国东海";
    const isEarthquake = preset.name.includes("柳州");
    const isFlood = preset.name.includes("石门");
    const [epicenterLng, epicenterLat] = preset.center;

    const assessmentRegion = {
      id: isEastChinaSea
        ? EAST_CHINA_SEA_REGION_ID
        : isEarthquake
          ? "region-earthquake-assessment"
          : isFlood
            ? "region-flood-assessment"
            : `region-${preset.name.replace(/\s+/g, "-").toLowerCase()}`,
      name: preset.name,
      type: "monitor" as const,
      coordinates: preset.outline,
      style: isEarthquake
        ? {
            fill: true,
            fillColor: "rgba(220, 38, 38, 0.08)",
            outlineColor: "#DC2626",
            outlineWidth: 2,
            effect: "lightWall" as const,
          }
        : isFlood
          ? {
              fill: true,
              fillColor: "rgba(37, 99, 235, 0.12)",
              outlineColor: "#2563EB",
              outlineWidth: 2,
              effect: "lightWall" as const,
            }
          : {
              fill: false,
              outlineColor: "#0064FF",
              outlineWidth: 4,
            },
      label: {
        text: preset.labelText(preset.bounds),
        position: [
          (preset.bounds.west + preset.bounds.east) / 2,
          (preset.bounds.south + preset.bounds.north) / 2,
        ] as [number, number],
      },
    };

    const epicenterHighlightRegion = isEarthquake
      ? {
          id: "region-earthquake-epicenter",
          name: "震中影响区",
          type: "monitor" as const,
          coordinates: [
            [epicenterLng - 0.03, epicenterLat - 0.03],
            [epicenterLng + 0.03, epicenterLat - 0.03],
            [epicenterLng + 0.03, epicenterLat + 0.03],
            [epicenterLng - 0.03, epicenterLat + 0.03],
            [epicenterLng - 0.03, epicenterLat - 0.03],
          ] as [number, number][],
          style: {
            fill: true,
            fillColor: "rgba(255, 68, 68, 0.22)",
            outlineColor: "#FF4444",
            outlineWidth: 3,
          },
          label: {
            text: "震中 109.26°E, 24.38°N",
            position: [epicenterLng, epicenterLat] as [number, number],
          },
        }
      : null;

    const data = {
      regionName: preset.name,
      bounds: preset.bounds,
      boundaryDescription: preset.name.includes("石门")
        ? `湖南石门县澧水/渫水流域洪涝评估区域，张家渡大桥坐标 ${preset.center[0]}°E, ${preset.center[1]}°N`
        : preset.name.includes("柳州")
          ? `广西柳州市柳南区评估区域，震中坐标 ${preset.center[0]}°E, ${preset.center[1]}°N`
          : preset.boundaryDescription,
      coordinateSystem: "WGS84",
      gisData: {
        type: "region" as const,
        regions: epicenterHighlightRegion
          ? [assessmentRegion, epicenterHighlightRegion]
          : [assessmentRegion],
        entities: isEarthquake
          ? [
              {
                id: "earthquake-epicenter",
                name: "震中",
                type: "earthquake" as const,
                coordinates: [epicenterLng, epicenterLat] as [number, number],
                importance: "high" as const,
                status: "danger" as const,
                color: "#FF4444",
                size: 24,
                description: "发震时刻: 2026-05-18 00:21:04 | 震级: 5.2 | 深度: 8km",
              },
            ]
          : undefined,
        eventName: isEarthquake
          ? "earthquake-region-mark"
          : isFlood
            ? "flood-region-mark"
            : undefined,
        highlightDurationMs: isEarthquake ? 8000 : undefined,
        transientRegionIds: isEarthquake ? ["region-earthquake-epicenter"] : undefined,
        transientEntityIds: isEarthquake ? ["earthquake-epicenter"] : undefined,
        cameraView: {
          type: "point",
          lng: preset.center[0],
          lat: preset.center[1],
          altitude: preset.cameraAltitude,
        },
      },
    };

    return {
      success: true,
      data,
      metadata: {
        capability: "region-mark",
        executionTime: Date.now() - startTime,
        mock: true,
        region: regionName,
      },
    };
  },
};
