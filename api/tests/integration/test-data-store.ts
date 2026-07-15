import { getAisEntitiesInRegion, getAisTrajectoriesInRegion, getAisStats, updateAisPositions } from "../../src/data/aisDataStore.js";
import { getAdsEntitiesInRegion, getAdsTrajectoriesInRegion, getAdsStats, updateAdsPositions } from "../../src/data/adsDataStore.js";

console.log("=== AIS Data Store Test ===");

// 1. 获取东海船舶
const donghaiShips = getAisEntitiesInRegion("东海");
console.log(`东海船舶数量: ${donghaiShips.length}`);
if (donghaiShips.length > 0) {
  console.log("样本船舶:", JSON.stringify(donghaiShips[0], null, 2));
}

// 2. 获取黄海船舶
const huanghaiShips = getAisEntitiesInRegion("黄海");
console.log(`黄海船舶数量: ${huanghaiShips.length}`);

// 3. 带 limit
const limited = getAisEntitiesInRegion("东海", 5);
console.log(`东海限制5艘: ${limited.length}`);

// 4. 更新位置
updateAisPositions(60);
const donghaiAfter = getAisEntitiesInRegion("东海", 3);
console.log("更新后样本:", JSON.stringify(donghaiAfter[0], null, 2));

// 5. 轨迹
const trajectories = getAisTrajectoriesInRegion("东海", 3);
console.log(`东海轨迹数量: ${trajectories.length}`);
if (trajectories.length > 0) {
  console.log(`轨迹点数: ${trajectories[0].points.length}`);
}

// 6. 统计
console.log("AIS统计:", getAisStats());

console.log("\n=== ADS Data Store Test ===");

// 7. 获取中国东部空域飞机
const chinaEast = getAdsEntitiesInRegion("中国东部");
console.log(`中国东部空域飞机数量: ${chinaEast.length}`);
if (chinaEast.length > 0) {
  console.log("样本飞机:", JSON.stringify(chinaEast[0], null, 2));
}

// 8. 更新位置
updateAdsPositions(60);
const chinaEastAfter = getAdsEntitiesInRegion("中国东部", 3);
console.log("更新后样本:", JSON.stringify(chinaEastAfter[0], null, 2));

// 9. 统计
console.log("ADS统计:", getAdsStats());

console.log("\n=== All tests passed ===");
