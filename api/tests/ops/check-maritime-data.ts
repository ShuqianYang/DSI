import {
  getAisEntitiesInRegion,
  getAisHighRiskEntities,
  getAisAnomalies,
} from "../../src/data/aisDataStore.js";
import {
  getAdsEntitiesInRegion,
  getAdsHighRiskEntities,
  getAdsAnomalies,
} from "../../src/data/adsDataStore.js";

console.log("=== AIS (船舶) ===");
const vessels = getAisEntitiesInRegion("东海");
console.log(`Total vessels in 东海: ${vessels.length}`);
console.log(`Danger: ${vessels.filter(v => v.status === "danger").length}`);
console.log(`Warning: ${vessels.filter(v => v.status === "warning").length}`);
console.log(`Normal: ${vessels.filter(v => v.status === "normal").length}`);

const highRiskVessels = getAisHighRiskEntities("东海");
console.log(`High risk vessels: ${highRiskVessels.length}`);
if (highRiskVessels.length > 0) {
  console.log("First high-risk vessel:", highRiskVessels[0]);
}

const vesselAnomalies = getAisAnomalies("东海");
console.log(`Vessel anomalies: ${vesselAnomalies.length}`);

console.log("\n=== ADS (飞机) ===");
const aircrafts = getAdsEntitiesInRegion("中国东部");
console.log(`Total aircrafts in 中国东部: ${aircrafts.length}`);
console.log(`Danger: ${aircrafts.filter(a => a.status === "danger").length}`);
console.log(`Warning: ${aircrafts.filter(a => a.status === "warning").length}`);
console.log(`Normal: ${aircrafts.filter(a => a.status === "normal").length}`);

const highRiskAircrafts = getAdsHighRiskEntities("中国东部");
console.log(`High risk aircrafts: ${highRiskAircrafts.length}`);
if (highRiskAircrafts.length > 0) {
  console.log("First high-risk aircraft:", highRiskAircrafts[0]);
}

const aircraftAnomalies = getAdsAnomalies("中国东部");
console.log(`Aircraft anomalies: ${aircraftAnomalies.length}`);
