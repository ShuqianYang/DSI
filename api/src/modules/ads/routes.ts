import { Router } from "express";
import { asyncHandler } from "../../middleware/errorHandler.js";
import { getAllAdsEntities, getAllAdsTrajectories } from "../../data/adsDataStore.js";

const router = Router();

router.get("/data", asyncHandler(async (_req, res) => {
  const entities = getAllAdsEntities();
  const trajectories = getAllAdsTrajectories();

  res.json({
    entities,
    trajectories,
    timestamp: new Date().toISOString(),
    count: entities.length,
  });
}));

router.get("/geojson", asyncHandler(async (_req, res) => {
  const entities = getAllAdsEntities();
  const trajectories = getAllAdsTrajectories();

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

export default router;
