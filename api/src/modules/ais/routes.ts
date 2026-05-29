import { Router } from "express";
import { asyncHandler } from "../../middleware/errorHandler.js";
import {
  getAllAisEntities,
  getAllAisTrajectories,
  getAisEntityById,
  importShipdtShips,
} from "../../data/aisDataStore.js";
import { queryViewport, registerCache } from "../../data/shipdtGridManager.js";
import { getCache, setCache } from "../../data/shipdtCache.js";

// 注册缓存到网格管理器
registerCache(getCache, setCache);

const router = Router();

router.get("/data", asyncHandler(async (_req, res) => {
  const entities = getAllAisEntities();
  const trajectories = getAllAisTrajectories();

  res.json({
    entities,
    trajectories,
    timestamp: new Date().toISOString(),
    count: entities.length,
  });
}));

router.get("/geojson", asyncHandler(async (_req, res) => {
  const entities = getAllAisEntities();
  const trajectories = getAllAisTrajectories();

  const featureCollection: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [
      ...entities.map((e) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: e.coordinates,
        },
        properties: {
          id: e.id,
          name: e.name,
          type: e.type,
          importance: e.importance,
          status: e.status,
          description: e.description,
          speed: e.speed,
          heading: e.heading,
        },
      })),
      ...trajectories.map((t) => ({
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: t.coordinates,
        },
        properties: {
          id: t.id,
          name: t.name,
          type: t.type,
          status: t.status,
        },
      })),
    ],
  };

  res.json(featureCollection);
}));

// ShipDT 区域查询端点
router.get("/shipdt-area", asyncHandler(async (req, res) => {
  const minLng = parseFloat(req.query.minLng as string);
  const maxLng = parseFloat(req.query.maxLng as string);
  const minLat = parseFloat(req.query.minLat as string);
  const maxLat = parseFloat(req.query.maxLat as string);
  const zoom = parseFloat(req.query.zoom as string) || 5;

  if (
    Number.isNaN(minLng) ||
    Number.isNaN(maxLng) ||
    Number.isNaN(minLat) ||
    Number.isNaN(maxLat)
  ) {
    res.status(400).json({ error: "Invalid bbox parameters" });
    return;
  }

  // 范围校验：单次查询不超过 10°×10°
  if (maxLng - minLng > 10 || maxLat - minLat > 10) {
    res.status(400).json({ error: "Viewport too large (max 10°×10°)" });
    return;
  }

  // zoom < 5（远距）时不调用 ShipDT，直接返回空结果
  if (zoom < 5) {
    res.json({
      status: 0,
      entities: [],
      denseCells: [],
      sourceBreakdown: { aisstream: 0, shipdt: 0, mock: 0 },
      message: "Zoom out < 5: ShipDT data not fetched",
    });
    return;
  }

  // 整体超时 30 秒，避免限流器队列阻塞导致请求无限挂起
  const TIMEOUT_MS = 30_000;
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("ShipDT query timeout")), TIMEOUT_MS);
  });

  const result = await Promise.race([
    queryViewport(minLng, maxLng, minLat, maxLat),
    timeoutPromise,
  ]);

  // 导入 ShipDT 船舶到内存 store
  const { added, skipped } = importShipdtShips(result.ships);

  // 统计数据源分布
  const allEntities = getAllAisEntities();
  const sourceBreakdown = { aisstream: 0, shipdt: 0, mock: 0 };
  for (const e of allEntities) {
    const desc = e.description || "";
    if (desc.includes("AIS实时信号")) sourceBreakdown.aisstream++;
    else if (desc.includes("模拟数据")) sourceBreakdown.mock++;
    else sourceBreakdown.shipdt++;
  }

  // 导入后从 store 获取实际状态（颜色对齐）
  const importedIds = new Set(result.ships.map((s) => String(s.mmsi)));
  const statusMap = new Map<string, "normal" | "warning" | "danger">();
  for (const id of importedIds) {
    const entity = getAisEntityById(id);
    if (entity) statusMap.set(id, entity.status);
  }

  res.json({
    status: 0,
    entities: result.ships.map((s) => {
      const mmsiStr = String(s.mmsi);
      const entityStatus = statusMap.get(mmsiStr) || "normal";
      return {
        id: mmsiStr,
        name: s.name || s.ais_name || `MMSI-${s.mmsi}`,
        type: "ship" as const,
        coordinates: [s.lon / 1_000_000, s.lat / 1_000_000] as [number, number],
        importance: "low" as const,
        status: entityStatus,
        description: `ShipDT | ${s.nationality || ""} | 航速:${s.sog != null ? (s.sog / 100).toFixed(1) : "N/A"}节 | 航向:${s.cog != null ? (s.cog / 100).toFixed(0) : "N/A"}°`,
        speed: s.sog != null ? s.sog / 100 : 0,
        heading: s.cog != null ? s.cog / 100 : 0,
      };
    }),
    denseCells: result.denseCells,
    sourceBreakdown,
    meta: {
      tilesQueried: result.tilesQueried,
      tilesFromCache: result.tilesFromCache,
      shipsAdded: added,
      shipsSkipped: skipped,
    },
  });
}));

export default router;
