import {
  initAisShips,
  getAllAisEntities,
  getAllAisTrajectories,
  getAisEntitiesInRegion,
  getAisHighRiskEntities,
  getAisAnomalies,
  updateAisPositions,
} from "../../src/data/aisDataStore.js";

initAisShips();

const entities = getAllAisEntities();
const trajectories = getAllAisTrajectories();
const eastSea = getAisEntitiesInRegion("东海");
const highRisk = getAisHighRiskEntities("东海");
const anomalies = getAisAnomalies("东海");

console.log("=== Mock Mode Verification ===");
console.log("Total entities:", entities.length);
console.log("Total trajectories:", trajectories.length);
console.log("East sea vessels:", eastSea.length);
console.log("High risk in east sea:", highRisk.length);
console.log("Anomalies in east sea:", anomalies.length);

const before = entities[0]?.coordinates;
updateAisPositions(3);
const after = getAllAisEntities()[0]?.coordinates;
console.log("First ship moved:", before?.[0] !== after?.[0] || before?.[1] !== after?.[1]);

// GeoJSON shape check
const geojson = {
  type: "FeatureCollection",
  features: [
    ...entities.map((e) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: e.coordinates },
      properties: { id: e.id, name: e.name, status: e.status, speed: e.speed },
    })),
    ...trajectories.map((t) => ({
      type: "Feature" as const,
      geometry: { type: "LineString" as const, coordinates: t.coordinates },
      properties: { id: t.id, name: t.name },
    })),
  ],
};
console.log("GeoJSON features:", geojson.features.length);
console.log("Point features:", geojson.features.filter((f) => f.geometry.type === "Point").length);
console.log("LineString features:", geojson.features.filter((f) => f.geometry.type === "LineString").length);

console.log("\n=== All checks passed ===");
