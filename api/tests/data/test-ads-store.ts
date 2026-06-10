import { initAdsAircrafts, getAllAdsEntities, getAdsEntitiesInRegion, getAdsHighRiskEntities, getAdsAnomalies, updateAdsPositions } from '../../src/data/adsDataStore.js';

initAdsAircrafts();
const all = getAllAdsEntities();
console.log('Mock aircrafts:', all.length);

const eastChina = getAdsEntitiesInRegion('中国东部空域');
console.log('East China airspace:', eastChina.length);

const highRisk = getAdsHighRiskEntities('中国东部空域');
console.log('High risk:', highRisk.length);

const anomalies = getAdsAnomalies('中国东部空域');
console.log('Anomalies:', anomalies.length);

updateAdsPositions(3);
const after = getAllAdsEntities();
console.log('After update:', after[0]?.coordinates);
