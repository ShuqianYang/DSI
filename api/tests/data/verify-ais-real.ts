import {
  initAisShips,
  getAllAisEntities,
  getAisEntitiesInRegion,
  getAisHighRiskEntities,
  getAisAnomalies,
  updateAisPositions,
} from "../../src/data/aisDataStore.js";
import { stopAISStream, getConnectionStatus } from "../../src/data/aisStreamClient.js";

// 设置真实模式环境变量
process.env.AISSTREAM_API_KEY = "60c81f80800c63233b611d93088dfb558acc6f9d";

initAisShips();

console.log("=== Real Mode Verification ===");
console.log("Connection status:", getConnectionStatus());

// 等待 WebSocket 连接和数据接收
await new Promise((r) => setTimeout(r, 5000));

console.log("Connection status after 5s:", getConnectionStatus());

const entities = getAllAisEntities();
console.log("Real entities received:", entities.length);

if (entities.length > 0) {
  const first = entities[0];
  console.log("First real vessel:", first.id, first.name, first.coordinates);
  console.log("Description:", first.description);
  console.log("Is real data marker:", first.description?.includes("AIS实时信号"));

  const eastSea = getAisEntitiesInRegion("东海");
  console.log("East sea real vessels:", eastSea.length);

  const highRisk = getAisHighRiskEntities("东海");
  console.log("High risk in east sea:", highRisk.length);

  const anomalies = getAisAnomalies("东海");
  console.log("Anomalies in east sea:", anomalies.length);

  // 测试航位推算
  await new Promise((r) => setTimeout(r, 3000));
  updateAisPositions(3);
  const afterDR = getAllAisEntities().find((e) => e.id === first.id);
  console.log("After dead reckoning:", afterDR?.coordinates);
}

// 再等等看是否有更多数据
await new Promise((r) => setTimeout(r, 5000));
console.log("Total entities after 10s:", getAllAisEntities().length);

stopAISStream();
console.log("\n=== Real mode test complete ===");
