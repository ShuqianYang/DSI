import { v4 as uuidv4 } from "uuid";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import type { Action, ActionResult } from "@datasourceintelligence/shared";
import type { Capability } from "../types.js";

// ==================== 地震灾后评估能力（接入真实 geojson 分析结果） ====================
//
// 优先读取 earthquake.geojson 真实分析结果，失败时回退到 mock 数据。
// 接收震前/震后卫星影像结果（通过 context），输出损毁评估 GIS 数据。
// 前端通过 compareMode: "side-by-side" 识别双 viewer 分屏对比模式。

const EPICENTER_LNG = 109.26;
const EPICENTER_LAT = 24.38;

// 地震影像切片实际覆盖范围（WGS84）
const LIUZHOU_RECT = {
  west: 109.25894741025947,
  south: 24.36555725731195,
  east: 109.26069621053718,
  north: 24.366585886456956,
};
const centerLng = (LIUZHOU_RECT.west + LIUZHOU_RECT.east) / 2;
const centerLat = (LIUZHOU_RECT.south + LIUZHOU_RECT.north) / 2;

// severity → 展示映射
const SEVERITY_MAP: Record<string, { level: string; name: string }> = {
  high: { level: "severe", name: "重度损毁" },
  medium: { level: "moderate", name: "中度损毁" },
  low: { level: "light", name: "轻度损毁" },
  none: { level: "none", name: "无显著损毁" },
};

// 多边形外接矩形中心
function getPolygonCenter(coords: [number, number][]): [number, number] {
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return [
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  ];
}

// 读取真实 geojson 分析结果，失败时回退到 mock
function loadDamageZones(): Array<{
  id: string;
  level: string;
  name: string;
  areaKm2: number;
  color: string;
  description: string;
  coordinates: [number, number][];
  labelPosition: [number, number];
}> {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const geojsonPath = path.join(__dirname, "../../../../earthquake.geojson");
    const raw = JSON.parse(readFileSync(geojsonPath, "utf-8"));
    const features = raw.features || [];

    return features.map((f: any) => {
      const props = f.properties || {};
      const mapped = SEVERITY_MAP[props.severity] || SEVERITY_MAP.low;
      const coords = (f.geometry?.coordinates?.[0] || []) as [number, number][];
      return {
        id: props.id || uuidv4(),
        level: mapped.level,
        name: `${mapped.name} (${props.label || ""})`,
        areaKm2: 0,
        color: "#DC2626",
        description: props.description || "",
        coordinates: coords,
        labelPosition: getPolygonCenter(coords),
      };
    });
  } catch (e) {
    console.warn("[EarthquakeEvaluation] 读取 earthquake.geojson 失败，回退 mock:", e);
    return [
      {
        id: "dmg-severe-1",
        level: "severe",
        name: "重度损毁区",
        areaKm2: 2.1,
        color: "#DC2626",
        description: "房屋大量损毁，道路中断，山体滑坡",
        coordinates: [
          [109.245, 24.365],
          [109.265, 24.365],
          [109.265, 24.385],
          [109.255, 24.395],
          [109.245, 24.385],
          [109.245, 24.365],
        ],
        labelPosition: [109.255, 24.375],
      },
      {
        id: "dmg-moderate-1",
        level: "moderate",
        name: "中度损毁区",
        areaKm2: 4.8,
        color: "#F59E0B",
        description: "部分建筑受损，墙体裂缝，设施损坏",
        coordinates: [
          [109.225, 24.345],
          [109.285, 24.345],
          [109.285, 24.405],
          [109.265, 24.415],
          [109.245, 24.405],
          [109.225, 24.395],
          [109.225, 24.345],
        ],
        labelPosition: [109.255, 24.38],
      },
      {
        id: "dmg-light-1",
        level: "light",
        name: "轻度损毁区",
        areaKm2: 5.6,
        color: "#FACC15",
        description: "轻微震感，个别房屋掉瓦，设施轻微损坏",
        coordinates: [
          [109.205, 24.335],
          [109.295, 24.335],
          [109.315, 24.355],
          [109.315, 24.415],
          [109.295, 24.425],
          [109.275, 24.415],
          [109.225, 24.415],
          [109.205, 24.405],
          [109.205, 24.335],
        ],
        labelPosition: [109.26, 24.38],
      },
    ];
  }
}

const DAMAGE_ZONES = loadDamageZones();

export const earthquakeEvaluationCapability: Capability = {
  name: "earthquake-evaluation",
  description: "地震灾后评估：震前震后影像对比、损毁识别、灾情统计评估与GIS回显",

  execute: async (
    action: Action,
    context?: Record<string, unknown>
  ): Promise<ActionResult> => {
    const startTime = Date.now();
    const params = action.params as {
      region?: string;
      query?: string;
    };
    const regionName = params.region || "广西柳州市柳南区";

    console.log(`[EarthquakeEvaluation] Executing for region: ${regionName}`);

    // 从 context 中提取前序 satellite 步骤的结果
    const contextEntries = Object.entries(context || {});
    let preImageUrl = "/local-tiles/pre_earthquake.png";
    let postImageUrl = "/local-tiles/wenchuan_post.png";
    let preImageRect = { ...LIUZHOU_RECT };
    let postImageRect = { ...LIUZHOU_RECT };

    for (const [, value] of contextEntries) {
      const v = value as Record<string, unknown> | undefined;
      if (!v) continue;

      // 匹配震前影像结果（responseType = pre_earthquake）
      const nestedData = v.data as Record<string, unknown> | undefined;
      const responseType = nestedData?.responseType as string | undefined;
      const gisData = (nestedData?.gisData ?? v.gisData) as Record<string, unknown> | undefined;
      const overlays = gisData?.imageOverlays as Array<{
        id?: string;
        url?: string;
        rectangle?: { west: number; south: number; east: number; north: number };
      }> | undefined;

      if (responseType === "pre_earthquake" && overlays?.length) {
        preImageUrl = overlays[0].url || preImageUrl;
        if (overlays[0].rectangle) preImageRect = overlays[0].rectangle;
      }
      if (responseType === "post_earthquake" && overlays?.length) {
        postImageUrl = overlays[0].url || postImageUrl;
        if (overlays[0].rectangle) postImageRect = overlays[0].rectangle;
      }
    }

    const assessmentId = uuidv4();
    const now = new Date().toISOString();

    // 从 geojson 特征推导统计
    const highCount = DAMAGE_ZONES.filter((z) => z.level === "severe").length;
    const mediumCount = DAMAGE_ZONES.filter((z) => z.level === "moderate").length;

    const summary = {
      location: regionName,
      magnitude: "5.2",
      epicenter: [EPICENTER_LNG, EPICENTER_LAT] as [number, number],
      depthKm: 8,
      assessmentTime: now,
      eventTime: "2026-05-18T00:21:04Z",
      dataSource: "中国地震台网中心、广西壮族自治区地震局",
      buildingsDamaged: highCount + mediumCount,
      roadsInterrupted: DAMAGE_ZONES.filter(
        (z) => z.name.includes("access") || z.name.includes("通道")
      ).length,
      landslidesDetected: DAMAGE_ZONES.filter(
        (z) => z.name.includes("collapse") || z.name.includes("坍塌")
      ).length,
      totalAffectedAreaKm2: 0,
    };

    // 构建损毁区域 polygon GIS 数据 — 红色边框，无填充
    const damageRegions = DAMAGE_ZONES.map((zone) => ({
      id: zone.id,
      name: zone.name,
      type: "damage" as const,
      coordinates: zone.coordinates,
      style: {
        fill: false,
        fillOpacity: 0,
        outlineColor: "#DC2626",
        outlineWidth: 2,
      },
      label: {
        text: zone.name,
        position: zone.labelPosition,
      },
    }));

    const gisData = {
      type: "earthquake" as const,
      // 震前/震后两张影像 overlay
      imageOverlays: [
        {
          id: "pre-earthquake-imagery",
          url: preImageUrl,
          rectangle: preImageRect,
          alpha: 0.9,
          tileWidth: 691,
          tileHeight: 502,
          label: "震前影像",
        },
        {
          id: "post-earthquake-imagery",
          url: postImageUrl,
          rectangle: postImageRect,
          alpha: 0.9,
          tileWidth: 691,
          tileHeight: 502,
          label: "震后影像",
        },
      ],
      // 损毁分级 polygon
      regions: damageRegions,
      // 震中标记
      entities: [
        {
          id: "epicenter",
          name: "震中",
          type: "earthquake",
          coordinates: [EPICENTER_LNG, EPICENTER_LAT] as [number, number],
          importance: "high",
          status: "danger",
          description: "发震时刻: 2026-05-18 00:21:04 | 震级: 5.2 | 深度: 8km",
        },
      ],
      // cameraView 与 satellite pre/post 保持一致（图片中心 @ 2000）
      cameraView: {
        type: "point" as const,
        lng: centerLng,
        lat: centerLat,
        altitude: 500,
      },
      // 前端分屏对比提示
      compareMode: "side-by-side" as const,
      compareConfig: {
        leftLabel: "震前影像",
        rightLabel: "震后影像",
        leftOverlayId: "pre-earthquake-imagery",
        rightOverlayId: "post-earthquake-imagery",
        damageOverlayIds: DAMAGE_ZONES.map((z) => z.id),
      },
    };

    const data = {
      assessmentId,
      timestamp: now,
      summary,
      damageZones: DAMAGE_ZONES.map((z) => ({
        level: z.level,
        name: z.name,
        areaKm2: z.areaKm2,
        color: z.color,
        description: z.description,
      })),
      gisData,
    };

    return {
      success: true,
      data,
      metadata: {
        capability: "earthquake-evaluation",
        executionTime: Date.now() - startTime,
        source: "geojson",
        region: regionName,
      },
    };
  },
};
