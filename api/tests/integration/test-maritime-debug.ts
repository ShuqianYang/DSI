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

const region = "东海";
const SEA_TO_AIR_REGION: Record<string, string> = {
  "东海": "中国东部",
  "黄海": "中国东部",
  "渤海": "中国东部",
  "南海": "中国东部",
  "台湾海峡": "中国东部",
  "北部湾": "中国东部",
};
const airRegion = SEA_TO_AIR_REGION[region] || region;

const allVessels = getAisEntitiesInRegion(region);
const allAircrafts = getAdsEntitiesInRegion(airRegion);
const highRiskVessels = getAisHighRiskEntities(region);
const highRiskAircrafts = getAdsHighRiskEntities(airRegion);
const vesselAnomalies = getAisAnomalies(region);
const aircraftAnomalies = getAdsAnomalies(airRegion);

console.log("allVessels:", allVessels.length);
console.log("allAircrafts:", allAircrafts.length);
console.log("highRiskVessels:", highRiskVessels.length);
console.log("highRiskAircrafts:", highRiskAircrafts.length);
console.log("vesselAnomalies:", vesselAnomalies.length);
console.log("aircraftAnomalies:", aircraftAnomalies.length);

// 模拟合并逻辑
const parsedVessels: typeof highRiskVessels = [];
const parsedAircrafts: typeof highRiskAircrafts = [];

const existingVesselIds = new Set(parsedVessels.map((v) => v.id));
for (const v of highRiskVessels) {
  if (!existingVesselIds.has(v.id)) {
    parsedVessels.push({ ...v, reason: `本地风险筛查标记为 ${v.riskLevel} / ${v.status}` });
  }
}

const existingAircraftIds = new Set(parsedAircrafts.map((a) => a.id));
for (const a of highRiskAircrafts) {
  if (!existingAircraftIds.has(a.id)) {
    parsedAircrafts.push({ ...a, reason: `本地风险筛查标记为 ${a.riskLevel} / ${a.status}` });
  }
}

console.log("merged vessels:", parsedVessels.length);
console.log("merged aircrafts:", parsedAircrafts.length);
