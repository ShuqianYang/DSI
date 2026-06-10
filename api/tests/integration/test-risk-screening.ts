import {
  getAisHighRiskEntities,
  getAisAnomalies,
  getAisTrajectoriesByIds,
  updateAisPositions,
} from "../../src/data/aisDataStore.js";
import {
  getAdsHighRiskEntities,
  getAdsAnomalies,
  getAdsTrajectoriesByIds,
  updateAdsPositions,
} from "../../src/data/adsDataStore.js";

console.log("=== AIS Risk Screening Test ===");

// 1. 高危实体
const highRiskShips = getAisHighRiskEntities("东海");
console.log(`东海高危船舶: ${highRiskShips.length} 艘`);
if (highRiskShips.length > 0) {
  console.log("样本:", JSON.stringify(highRiskShips[0], null, 2));
}

// 2. 异常检测
let anomalies = getAisAnomalies("东海");
console.log(`\n东海异常总数: ${anomalies.length}`);

const clustering = anomalies.filter((a) => a.type === "clustering");
const speedAnomalies = anomalies.filter((a) => a.type === "speed");
const boundaryAnomalies = anomalies.filter((a) => a.type === "boundary");
console.log(`  - 聚集异常: ${clustering.length}`);
console.log(`  - 速度异常: ${speedAnomalies.length}`);
console.log(`  - 边界逼近: ${boundaryAnomalies.length}`);

if (clustering.length > 0) {
  console.log("聚集样本:", JSON.stringify(clustering[0], null, 2));
}
if (speedAnomalies.length > 0) {
  console.log("速度异常样本:", JSON.stringify(speedAnomalies[0], null, 2));
}

// 3. 按 ID 获取轨迹
if (highRiskShips.length > 0) {
  const ids = highRiskShips.slice(0, 3).map((s) => s.id);
  const trajs = getAisTrajectoriesByIds(ids);
  console.log(`\n高危船舶轨迹数: ${trajs.length}`);
  if (trajs.length > 0) {
    console.log(`轨迹 ${trajs[0].id} 点数: ${trajs[0].points.length}`);
  }
}

console.log("\n=== ADS Risk Screening Test ===");

// 4. 飞机高危
const highRiskAcs = getAdsHighRiskEntities("中国东部");
console.log(`中国东部高危飞机: ${highRiskAcs.length} 架`);
if (highRiskAcs.length > 0) {
  console.log("样本:", JSON.stringify(highRiskAcs[0], null, 2));
}

// 5. 飞机异常
let acAnomalies = getAdsAnomalies("中国东部");
console.log(`\n中国东部异常总数: ${acAnomalies.length}`);

const acClustering = acAnomalies.filter((a) => a.type === "clustering");
const acSpeed = acAnomalies.filter((a) => a.type === "speed");
const acBoundary = acAnomalies.filter((a) => a.type === "boundary");
console.log(`  - 聚集异常: ${acClustering.length}`);
console.log(`  - 速度异常: ${acSpeed.length}`);
console.log(`  - 边界逼近: ${acBoundary.length}`);

if (acClustering.length > 0) {
  console.log("聚集样本:", JSON.stringify(acClustering[0], null, 2));
}

// 6. 飞机轨迹
if (highRiskAcs.length > 0) {
  const ids = highRiskAcs.slice(0, 3).map((a) => a.id);
  const trajs = getAdsTrajectoriesByIds(ids);
  console.log(`\n高危飞机轨迹数: ${trajs.length}`);
  if (trajs.length > 0) {
    console.log(`轨迹 ${trajs[0].id} 点数: ${trajs[0].points.length}`);
  }
}

console.log("\n=== All risk screening tests passed ===");
