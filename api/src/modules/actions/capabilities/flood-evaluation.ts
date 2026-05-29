import { v4 as uuidv4 } from "uuid";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import type { Action, ActionResult } from "@datasourceintelligence/shared";
import type { Capability } from "../types.js";

// ==================== 洪涝灾后评估能力（接入真实 geojson 分析结果） ====================
//
// 优先读取 flood.geojson 真实分析结果，失败时回退到 mock 数据。
// 接收暴雨前/暴雨后卫星影像结果（通过 context），输出洪涝评估 GIS 数据。
// 前端通过 compareMode: "side-by-side" 识别双 viewer 分屏对比模式。

// 张家渡大桥坐标
const BRIDGE_LNG = 110.89457167309149;
const BRIDGE_LAT = 29.881490688312095;

// 石门县影像切片实际覆盖范围（WGS84）
const SHIMEN_RECT = {
  west: 110.89344101467812,
  south: 29.880513149375275,
  east: 110.89603739300453,
  north: 29.88216900048024,
};
const centerLng = 110.894662;
const centerLat = 29.881476;

// severity → 展示映射（洪涝场景：蓝色为主色调）
const SEVERITY_MAP: Record<string, { level: string; name: string; color: string }> = {
  high: { level: "severe", name: "重度损毁", color: "#DC2626" },
  medium: { level: "moderate", name: "中度受损", color: "#2563EB" },
  none: { level: "none", name: "未受灾", color: "#22C55E" },
};

// label → 中文名称映射
const LABEL_NAME_MAP: Record<string, string> = {
  bridge_washout: "桥梁主体冲毁",
  bridge_debris_in_water: "桥面碎片漂流",
  approach_road_cut: "桥头连接处冲断",
  road_overtopped: "道路淹没",
  new_inundation_area: "新增淹没区",
  building_exposure_flood_edge: "建筑临水风险",
  high_turbidity_floodwater: "高浊度洪水覆盖",
  unaffected_road_negative_sample: "未受灾道路",
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

// 判断 polygon 大致面积（用外接矩形近似，km²）
function estimateAreaKm2(coords: [number, number][]): number {
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  const dLng = Math.max(...lngs) - Math.min(...lngs);
  const dLat = Math.max(...lats) - Math.min(...lats);
  // 1° ≈ 111km（纬度），经度需按纬度修正
  const latAvg = (Math.max(...lats) + Math.min(...lats)) / 2;
  const kmPerLng = 111 * Math.cos((latAvg * Math.PI) / 180);
  const kmPerLat = 111;
  return Math.round(dLng * kmPerLng * dLat * kmPerLat * 1000) / 1000;
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
    const geojsonPath = path.join(__dirname, "../../../../flood.geojson");
    const raw = JSON.parse(readFileSync(geojsonPath, "utf-8"));
    const features = raw.features || [];

    return features.map((f: any) => {
      const props = f.properties || {};
      const mapped = SEVERITY_MAP[props.severity] || SEVERITY_MAP.medium;
      const coords = (f.geometry?.coordinates?.[0] || []) as [number, number][];
      const label = props.label || "";
      return {
        id: props.id || uuidv4(),
        level: mapped.level,
        name: LABEL_NAME_MAP[label] || label,
        areaKm2: estimateAreaKm2(coords),
        color: mapped.color,
        description: props.description || "",
        coordinates: coords,
        labelPosition: getPolygonCenter(coords),
      };
    });
  } catch (e) {
    console.warn("[FloodEvaluation] 读取 flood.geojson 失败，回退 mock:", e);
    return [
      {
        id: "flood-severe-1",
        level: "severe",
        name: "桥梁主体冲毁",
        areaKm2: 0.02,
        color: "#DC2626",
        description: "桥梁主体冲毁区，灾前桥面连续，灾后中段断裂并出现大面积缺失。",
        coordinates: [
          [110.89362111, 29.88177776],
          [110.89362111, 29.88108361],
          [110.89500184, 29.88108361],
          [110.89500184, 29.88177776],
          [110.89362111, 29.88177776],
        ],
        labelPosition: [110.894311, 29.881431],
      },
      {
        id: "flood-moderate-1",
        level: "moderate",
        name: "高浊度洪水覆盖",
        areaKm2: 0.15,
        color: "#2563EB",
        description: "灾后水体由深绿色变为大面积浑黄色，说明洪水携带泥沙并覆盖原河面及部分岸滩。",
        coordinates: [
          [110.89368114, 29.882169],
          [110.89368114, 29.88075547],
          [110.89513691, 29.88075547],
          [110.89513691, 29.882169],
          [110.89368114, 29.882169],
        ],
        labelPosition: [110.894409, 29.881462],
      },
    ];
  }
}

const DAMAGE_ZONES = loadDamageZones();

export const floodEvaluationCapability: Capability = {
  name: "flood-evaluation",
  description: "洪涝灾后评估：暴雨前后影像对比、淹没识别、灾情统计评估与GIS回显",

  execute: async (
    action: Action,
    context?: Record<string, unknown>
  ): Promise<ActionResult> => {
    const startTime = Date.now();
    const params = action.params as {
      region?: string;
      query?: string;
    };
    const regionName = params.region || "湖南石门县";

    console.log(`[FloodEvaluation] Executing for region: ${regionName}`);

    // 从 context 中提取前序 satellite 步骤的结果
    const contextEntries = Object.entries(context || {});
    let preImageUrl = "/local-tiles/pre_flood.png";
    let postImageUrl = "/local-tiles/post_flood.png";
    let preImageRect = { ...SHIMEN_RECT };
    let postImageRect = { ...SHIMEN_RECT };

    for (const [, value] of contextEntries) {
      const v = value as Record<string, unknown> | undefined;
      if (!v) continue;

      // 匹配洪水前影像结果（responseType = pre_flood）
      const nestedData = v.data as Record<string, unknown> | undefined;
      const responseType = nestedData?.responseType as string | undefined;
      const gisData = (nestedData?.gisData ?? v.gisData) as Record<string, unknown> | undefined;
      const overlays = gisData?.imageOverlays as Array<{
        id?: string;
        url?: string;
        rectangle?: { west: number; south: number; east: number; north: number };
      }> | undefined;

      if (responseType === "pre_flood" && overlays?.length) {
        preImageUrl = overlays[0].url || preImageUrl;
        if (overlays[0].rectangle) preImageRect = overlays[0].rectangle;
      }
      if (responseType === "post_flood" && overlays?.length) {
        postImageUrl = overlays[0].url || postImageUrl;
        if (overlays[0].rectangle) postImageRect = overlays[0].rectangle;
      }
    }

    const assessmentId = uuidv4();
    const now = new Date().toISOString();

    // 从 geojson 特征推导统计
    const highCount = DAMAGE_ZONES.filter((z) => z.level === "severe").length;
    const mediumCount = DAMAGE_ZONES.filter((z) => z.level === "moderate").length;
    const totalFloodedArea = DAMAGE_ZONES.filter((z) => z.level !== "none").reduce((sum, z) => sum + (z.areaKm2 || 0), 0);

    const summary = {
      location: regionName,
      eventTime: "2026-05-17~05-18",
      assessmentTime: now,
      dataSource: "国家气象信息中心、湖南省气象局、水利部水文信息官网",
      floodedAreaKm2: Math.round(totalFloodedArea * 1000) / 1000,
      bridgesDamaged: DAMAGE_ZONES.filter(
        (z) => z.name.includes("桥梁") || z.name.includes("桥面")
      ).length,
      roadsInterrupted: DAMAGE_ZONES.filter(
        (z) => z.name.includes("道路") || z.name.includes("桥头")
      ).length,
      housesFlooded: DAMAGE_ZONES.filter((z) => z.name.includes("建筑")).length,
    };

    // 构建损毁/淹没区域 polygon GIS 数据
    const damageRegions = DAMAGE_ZONES.map((zone) => ({
      id: zone.id,
      name: zone.name,
      type: "damage" as const,
      coordinates: zone.coordinates,
      style: {
        fill: false,
        fillOpacity: 0,
        outlineColor: zone.color,
        outlineWidth: zone.level === "severe" ? 3 : 2,
      },
      label: {
        text: zone.name,
        position: zone.labelPosition,
      },
    }));

    const gisData = {
      type: "flood" as const,
      // 暴雨前/暴雨后两张影像 overlay
      imageOverlays: [
        {
          id: "pre-flood-imagery",
          url: preImageUrl,
          rectangle: preImageRect,
          alpha: 0.9,
          tileWidth: 691,
          tileHeight: 502,
          label: "暴雨前影像",
        },
        {
          id: "post-flood-imagery",
          url: postImageUrl,
          rectangle: postImageRect,
          alpha: 0.9,
          tileWidth: 691,
          tileHeight: 502,
          label: "暴雨后影像",
        },
      ],
      // 淹没/损毁区域 polygon
      regions: damageRegions,
      // 张家渡大桥标记
      entities: [
        {
          id: "zhangjiadu-bridge",
          name: "张家渡大桥",
          type: "damage",
          coordinates: [BRIDGE_LNG, BRIDGE_LAT] as [number, number],
          importance: "high",
          status: "danger",
          description: "因洪水冲击发生结构性坍塌",
        },
      ],
      // cameraView 与 satellite pre/post 保持一致
      cameraView: {
        type: "point" as const,
        lng: centerLng,
        lat: centerLat,
        altitude: 666,
      },
      // 前端分屏对比提示
      compareMode: "side-by-side" as const,
      compareConfig: {
        leftLabel: "暴雨前影像",
        rightLabel: "暴雨后影像",
        leftOverlayId: "pre-flood-imagery",
        rightOverlayId: "post-flood-imagery",
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
        capability: "flood-evaluation",
        executionTime: Date.now() - startTime,
        source: "geojson",
        region: regionName,
      },
    };
  },
};
