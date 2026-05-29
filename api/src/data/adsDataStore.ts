import { startOpenSkyPolling, stopOpenSkyPolling, onAircraftUpdate, type RawAircraftUpdate } from "./openSkyClient.js";

// ==================== 民航空域定义 ====================
const AIR_ZONES: {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
  name: string;
}[] = [
  { minLng: 100.0, maxLng: 122.0, minLat: 20.0, maxLat: 45.0, name: "中国东部空域" },
  { minLng: 70.0, maxLng: 95.0, minLat: 8.0, maxLat: 35.0, name: "南亚空域" },
  { minLng: 35.0, maxLng: 60.0, minLat: 25.0, maxLat: 42.0, name: "中东空域" },
  { minLng: 125.0, maxLng: 145.0, minLat: 30.0, maxLat: 45.0, name: "日本空域" },
  { minLng: -10.0, maxLng: 25.0, minLat: 35.0, maxLat: 60.0, name: "西欧空域" },
  { minLng: 25.0, maxLng: 50.0, minLat: 40.0, maxLat: 65.0, name: "东欧空域" },
  { minLng: -125.0, maxLng: -95.0, minLat: 25.0, maxLat: 50.0, name: "美国西部空域" },
  { minLng: -95.0, maxLng: -65.0, minLat: 25.0, maxLat: 50.0, name: "美国东部空域" },
  { minLng: 115.0, maxLng: 155.0, minLat: -38.0, maxLat: -15.0, name: "澳洲空域" },
  { minLng: -80.0, maxLng: -35.0, minLat: -35.0, maxLat: 5.0, name: "南美空域" },
  { minLng: -10.0, maxLng: 40.0, minLat: -35.0, maxLat: 5.0, name: "非洲空域" },
  { minLng: 165.0, maxLng: 180.0, minLat: -45.0, maxLat: -30.0, name: "新西兰空域" },
];

const AIRLINES = [
  { code: "CA", name: "国航" }, { code: "MU", name: "东航" },
  { code: "CZ", name: "南航" }, { code: "HU", name: "海航" },
  { code: "MF", name: "厦航" }, { code: "3U", name: "川航" },
  { code: "ZH", name: "深航" }, { code: "SC", name: "山航" },
  { code: "JL", name: "日航" }, { code: "NH", name: "全日空" },
  { code: "KE", name: "大韩" }, { code: "OZ", name: "韩亚" },
  { code: "CX", name: "国泰" }, { code: "SQ", name: "新航" },
  { code: "MH", name: "马航" }, { code: "TG", name: "泰航" },
  { code: "UA", name: "美联航" }, { code: "AA", name: "美航" },
  { code: "BA", name: "英航" }, { code: "LH", name: "汉莎" },
];

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateFlightName(index: number): string {
  const airline = AIRLINES[index % AIRLINES.length];
  const flightNum = String(randInt(1001, 9999));
  return `${airline.code}${flightNum}`;
}

// ==================== 内部状态 ====================
interface AircraftState {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  altitude: number;
  status: "normal" | "warning" | "danger";
  riskLevel: "low" | "medium" | "high";
  importance: "high" | "medium" | "low";
  trajectory: [number, number][];
  zoneIndex: number;
  lastUpdated: number;
  dataSource: "real" | "mock";
}

let aircraftStates: AircraftState[] = [];
let initialized = false;
let useRealData = false;
let unsubscribeAircraftUpdate: (() => void) | null = null;

const MAX_AIRCRAFT_COUNT = 5000;
const AIRCRAFT_STALE_THRESHOLD_MS = 900_000; // 15 分钟（覆盖 OpenSky 10 分钟 poll 间隔 + 缓冲）
const DR_STALE_THRESHOLD_MS = 30_000; // 30 秒（航位推算）

function mapStatusToRiskLevel(
  status: "normal" | "warning" | "danger"
): "low" | "medium" | "high" {
  if (status === "danger") return "high";
  if (status === "warning") return "medium";
  return "low";
}

function computeZoneIndex(lat: number, lng: number): number {
  for (let i = 0; i < AIR_ZONES.length; i++) {
    const z = AIR_ZONES[i];
    if (lng >= z.minLng && lng <= z.maxLng && lat >= z.minLat && lat <= z.maxLat) {
      return i;
    }
  }
  return -1;
}

// ==================== Mock 数据生成 ====================
function generateMockAircrafts(count: number): void {
  const aircraftsPerZone = Math.floor(count / AIR_ZONES.length);
  const extra = count - aircraftsPerZone * AIR_ZONES.length;
  const newStates: AircraftState[] = [];

  AIR_ZONES.forEach((zone, zoneIdx) => {
    const zoneCount = aircraftsPerZone + (zoneIdx < extra ? 1 : 0);
    for (let i = 0; i < zoneCount; i++) {
      const globalIndex = newStates.length;
      const lng = randFloat(zone.minLng, zone.maxLng);
      const lat = randFloat(zone.minLat, zone.maxLat);

      const importanceRoll = Math.random();
      const importance =
        importanceRoll < 0.1 ? "high" : importanceRoll < 0.4 ? "medium" : "low";

      const statusRoll = Math.random();
      const status =
        statusRoll < 0.05 ? "danger" : statusRoll < 0.2 ? "warning" : "normal";

      const heading = randFloat(0, 360);
      const speed = randFloat(400, 950);
      const altitude = randFloat(6000, 12500);

      const historyLength = randInt(20, 40);
      const trajectory: [number, number][] = [];
      let curLng = lng;
      let curLat = lat;
      for (let h = 0; h < historyLength; h++) {
        trajectory.unshift([curLng, curLat]);
        const distKm = speed / 60;
        const backHeading = (heading + 180) % 360;
        const dLat = distKm / 111;
        const dLng =
          (distKm / (111 * Math.cos((curLat * Math.PI) / 180))) *
          Math.sin((backHeading * Math.PI) / 180);
        curLat += dLat * Math.cos((backHeading * Math.PI) / 180);
        curLng += dLng;
      }

      newStates.push({
        id: `ads-ac-${String(globalIndex).padStart(4, "0")}`,
        name: generateFlightName(globalIndex),
        type: "aircraft",
        lat: parseFloat(lat.toFixed(4)),
        lng: parseFloat(lng.toFixed(4)),
        heading,
        speed,
        altitude,
        status,
        riskLevel: mapStatusToRiskLevel(status),
        importance,
        trajectory,
        zoneIndex: zoneIdx,
        lastUpdated: Date.now(),
        dataSource: "mock",
      });
    }
  });

  aircraftStates = newStates;
}

// ==================== 真实数据处理 ====================
function handleRealAircraftUpdate(update: RawAircraftUpdate): void {
  const now = Date.now();
  const existing = aircraftStates.find((s) => s.id === update.icao24);
  const coords: [number, number] = [update.lng, update.lat];

  if (existing) {
    existing.lat = update.lat;
    existing.lng = update.lng;
    existing.speed = update.speed;
    existing.heading = update.heading;
    existing.altitude = update.altitude;
    existing.trajectory.push(coords);
    if (existing.trajectory.length > 50) existing.trajectory.shift();
    existing.lastUpdated = now;
    existing.zoneIndex = computeZoneIndex(update.lat, update.lng);
    deriveAircraftStatus(existing);
  } else {
    aircraftStates.push({
      id: update.icao24,
      name: update.callsign || `ICAO-${update.icao24}`,
      type: "aircraft",
      lat: update.lat,
      lng: update.lng,
      heading: update.heading,
      speed: update.speed,
      altitude: update.altitude,
      status: "normal",
      riskLevel: "low",
      importance: "low",
      trajectory: [coords],
      zoneIndex: computeZoneIndex(update.lat, update.lng),
      lastUpdated: now,
      dataSource: "real",
    });
  }
}

function deriveAircraftStatus(ac: AircraftState): void {
  if (ac.speed > 950) {
    ac.status = "warning";
    ac.riskLevel = "medium";
    return;
  }
  if (ac.speed < 300 && ac.altitude > 6000) {
    ac.status = "warning";
    ac.riskLevel = "medium";
    return;
  }

  const zone = AIR_ZONES[ac.zoneIndex];
  if (zone) {
    const margin = 0.5;
    if (
      Math.abs(ac.lat - zone.minLat) < margin ||
      Math.abs(ac.lat - zone.maxLat) < margin ||
      Math.abs(ac.lng - zone.minLng) < margin ||
      Math.abs(ac.lng - zone.maxLng) < margin
    ) {
      ac.status = "warning";
      ac.riskLevel = "medium";
      return;
    }
  }

  ac.status = "normal";
  ac.riskLevel = "low";
}

function cleanupStaleAircraft(): void {
  const now = Date.now();
  const before = aircraftStates.length;
  aircraftStates = aircraftStates.filter((s) => {
    if (s.dataSource !== "real") return true;
    return now - s.lastUpdated < AIRCRAFT_STALE_THRESHOLD_MS;
  });
  if (aircraftStates.length < before) {
    console.log(`[ADS-B] Cleaned up ${before - aircraftStates.length} stale aircraft`);
  }
}

function enforceMaxAircraftCount(): void {
  if (aircraftStates.length <= MAX_AIRCRAFT_COUNT) return;
  const realAircrafts = aircraftStates.filter((s) => s.dataSource === "real");
  if (realAircrafts.length <= MAX_AIRCRAFT_COUNT) return;

  realAircrafts.sort((a, b) => a.lastUpdated - b.lastUpdated);
  const toEvict = realAircrafts.slice(0, realAircrafts.length - MAX_AIRCRAFT_COUNT);
  const evictSet = new Set(toEvict.map((s) => s.id));
  aircraftStates = aircraftStates.filter((s) => !evictSet.has(s.id));
  console.log(`[ADS-B] Evicted ${toEvict.length} aircraft to enforce MAX_AIRCRAFT_COUNT`);
}

// ==================== 初始化 ====================
export function initAdsAircrafts(count: number = 320): void {
  if (initialized && aircraftStates.length > 0) return;

  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;

  if (clientId && clientSecret) {
    useRealData = true;
    unsubscribeAircraftUpdate = onAircraftUpdate(handleRealAircraftUpdate);
    startOpenSkyPolling();
    console.log("[ADS-B] Real-time mode: OpenSky polling enabled");
  } else {
    useRealData = false;
    generateMockAircrafts(count);
    console.log(`[ADS-B] Mock mode: generated ${aircraftStates.length} simulated aircraft`);
  }

  initialized = true;
}

// ==================== 实时位置更新 ====================
export function updateAdsPositions(dtSeconds: number = 1): void {
  if (!initialized || aircraftStates.length === 0) {
    initAdsAircrafts();
    return;
  }

  if (useRealData) {
    const now = Date.now();
    aircraftStates.forEach((ac) => {
      if (ac.dataSource !== "real") return;
      const staleMs = now - ac.lastUpdated;
      if (staleMs > DR_STALE_THRESHOLD_MS && ac.speed > 10) {
        const dtHours = staleMs / 3600000;
        const distanceKm = ac.speed * dtHours;
        const rad = (ac.heading * Math.PI) / 180;
        const dLat = (distanceKm * Math.cos(rad)) / 111;
        const dLng =
          (distanceKm * Math.sin(rad)) / (111 * Math.cos((ac.lat * Math.PI) / 180));
        ac.lat += dLat;
        ac.lng += dLng;
        ac.lat = parseFloat(ac.lat.toFixed(4));
        ac.lng = parseFloat(ac.lng.toFixed(4));
        ac.zoneIndex = computeZoneIndex(ac.lat, ac.lng);
      }
    });
    cleanupStaleAircraft();
    enforceMaxAircraftCount();
  } else {
    aircraftStates.forEach((ac) => {
      const zone = AIR_ZONES[ac.zoneIndex];

      const dtHours = dtSeconds / 3600;
      const distanceKm = ac.speed * dtHours;

      const rad = (ac.heading * Math.PI) / 180;
      const dLat = (distanceKm * Math.cos(rad)) / 111;
      const dLng =
        (distanceKm * Math.sin(rad)) / (111 * Math.cos((ac.lat * Math.PI) / 180));

      let newLat = ac.lat + dLat;
      let newLng = ac.lng + dLng;

      const margin = 0.5;
      let headingChanged = false;

      if (newLat < zone.minLat + margin || newLat > zone.maxLat - margin) {
        ac.heading = randFloat(0, 360);
        headingChanged = true;
      }
      if (newLng < zone.minLng + margin || newLng > zone.maxLng - margin) {
        ac.heading = randFloat(0, 360);
        headingChanged = true;
      }

      if (headingChanged) {
        const rad2 = (ac.heading * Math.PI) / 180;
        const dLat2 = (distanceKm * Math.cos(rad2)) / 111;
        const dLng2 =
          (distanceKm * Math.sin(rad2)) / (111 * Math.cos((ac.lat * Math.PI) / 180));
        newLat = ac.lat + dLat2;
        newLng = ac.lng + dLng2;
      }

      if (Math.random() < 0.01) {
        ac.heading = (ac.heading + randFloat(-20, 20)) % 360;
        if (ac.heading < 0) ac.heading += 360;
      }

      if (Math.random() < 0.03) {
        ac.speed = Math.max(350, Math.min(1000, ac.speed + randFloat(-30, 30)));
      }

      if (Math.random() < 0.02) {
        ac.altitude = Math.max(
          3000,
          Math.min(13000, ac.altitude + randFloat(-200, 200))
        );
      }

      newLat = Math.max(zone.minLat, Math.min(zone.maxLat, newLat));
      newLng = Math.max(zone.minLng, Math.min(zone.maxLng, newLng));

      ac.lat = parseFloat(newLat.toFixed(4));
      ac.lng = parseFloat(newLng.toFixed(4));

      ac.trajectory.push([ac.lng, ac.lat]);
      if (ac.trajectory.length > 50) {
        ac.trajectory.shift();
      }
    });
  }
}

// ==================== 空域匹配 ====================
function matchZones(region: string): number[] {
  const normalized = region.trim();
  const matched: number[] = [];
  for (let i = 0; i < AIR_ZONES.length; i++) {
    if (AIR_ZONES[i].name.includes(normalized) || normalized.includes(AIR_ZONES[i].name)) {
      matched.push(i);
    }
  }
  return matched;
}

// ==================== 对外接口 ====================
export interface AdsEntity {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  altitude: number;
  speed: number;
  heading: number;
  status: "normal" | "warning" | "danger";
  riskLevel: "low" | "medium" | "high";
}

export function getAdsEntitiesInRegion(
  region: string,
  limit?: number
): AdsEntity[] {
  if (!initialized) initAdsAircrafts();

  const zoneIndices = matchZones(region);
  let results = aircraftStates
    .filter((s) => zoneIndices.includes(s.zoneIndex))
    .map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      lat: s.lat,
      lng: s.lng,
      altitude: Math.round(s.altitude),
      speed: Math.round(s.speed),
      heading: Math.round(s.heading),
      status: s.status,
      riskLevel: s.riskLevel,
    }));

  if (limit && limit > 0) {
    results = results.slice(0, limit);
  }

  return results;
}

export interface AdsTrajectory {
  id: string;
  name: string;
  points: { lat: number; lng: number }[];
}

export function getAdsTrajectoriesInRegion(
  region: string,
  limit?: number
): AdsTrajectory[] {
  if (!initialized) initAdsAircrafts();

  const zoneIndices = matchZones(region);
  let results = aircraftStates
    .filter((s) => zoneIndices.includes(s.zoneIndex) && s.trajectory.length >= 2)
    .map((s) => ({
      id: s.id,
      name: `${s.name}_飞行轨迹`,
      points: s.trajectory.slice(-30).map(([lng, lat]) => ({ lat, lng })),
    }));

  if (limit && limit > 0) {
    results = results.slice(0, limit);
  }

  return results;
}

// ==================== 风险筛选与异常检测 ====================

/** 计算两点间距离（公里），使用 haversine 公式 */
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface AdsAnomaly {
  entityId: string;
  entityName: string;
  type: "clustering" | "speed" | "boundary" | "altitude";
  severity: "warning" | "danger";
  description: string;
  relatedIds?: string[];
  lat: number;
  lng: number;
}

/** 获取高危实体（riskLevel=high 或 status=danger） */
export function getAdsHighRiskEntities(
  region: string,
  limit?: number
): AdsEntity[] {
  if (!initialized) initAdsAircrafts();

  const zoneIndices = matchZones(region);
  let results = aircraftStates
    .filter(
      (s) =>
        zoneIndices.includes(s.zoneIndex) &&
        s.status !== "normal"
    )
    .map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      lat: s.lat,
      lng: s.lng,
      altitude: Math.round(s.altitude),
      speed: Math.round(s.speed),
      heading: Math.round(s.heading),
      status: s.status,
      riskLevel: s.riskLevel,
    }));

  if (limit && limit > 0) {
    results = results.slice(0, limit);
  }

  return results;
}

/** 检测异常行为 */
export function getAdsAnomalies(region: string): AdsAnomaly[] {
  if (!initialized) initAdsAircrafts();

  const zoneIndices = matchZones(region);
  const regionAircrafts = aircraftStates.filter((s) =>
    zoneIndices.includes(s.zoneIndex)
  );
  const anomalies: AdsAnomaly[] = [];

  // 1. 聚集异常：两机距离 < 20km
  const CLUSTER_THRESHOLD_KM = 20;
  const clustered = new Set<string>();
  for (let i = 0; i < regionAircrafts.length; i++) {
    for (let j = i + 1; j < regionAircrafts.length; j++) {
      const a = regionAircrafts[i];
      const b = regionAircrafts[j];
      const dist = distanceKm(a.lat, a.lng, b.lat, b.lng);
      if (dist < CLUSTER_THRESHOLD_KM) {
        if (!clustered.has(a.id)) {
          clustered.add(a.id);
          anomalies.push({
            entityId: a.id,
            entityName: a.name,
            type: "clustering",
            severity: dist < 10 ? "danger" : "warning",
            description: `与 ${b.name} 距离过近（${dist.toFixed(1)} 公里），存在空中交通冲突风险`,
            relatedIds: [b.id],
            lat: a.lat,
            lng: a.lng,
          });
        }
        if (!clustered.has(b.id)) {
          clustered.add(b.id);
          anomalies.push({
            entityId: b.id,
            entityName: b.name,
            type: "clustering",
            severity: dist < 10 ? "danger" : "warning",
            description: `与 ${a.name} 距离过近（${dist.toFixed(1)} 公里），存在空中交通冲突风险`,
            relatedIds: [a.id],
            lat: b.lat,
            lng: b.lng,
          });
        }
      }
    }
  }

  // 2. 速度异常
  for (const ac of regionAircrafts) {
    if (ac.speed > 950) {
      anomalies.push({
        entityId: ac.id,
        entityName: ac.name,
        type: "speed",
        severity: "warning",
        description: `航速异常过快（${Math.round(ac.speed)} km/h），超出民航巡航速度范围`,
        lat: ac.lat,
        lng: ac.lng,
      });
    } else if (ac.speed < 300 && ac.altitude > 6000) {
      anomalies.push({
        entityId: ac.id,
        entityName: ac.name,
        type: "speed",
        severity: "warning",
        description: `巡航阶段航速过低（${Math.round(ac.speed)} km/h），疑似引擎故障或等待指令`,
        lat: ac.lat,
        lng: ac.lng,
      });
    }
  }

  // 3. 边界逼近
  const BOUNDARY_MARGIN = 0.5;
  for (const ac of regionAircrafts) {
    const zone = AIR_ZONES[ac.zoneIndex];
    if (!zone) continue;
    const distToEdgeLat = Math.min(
      Math.abs(ac.lat - zone.minLat),
      Math.abs(ac.lat - zone.maxLat)
    );
    const distToEdgeLng = Math.min(
      Math.abs(ac.lng - zone.minLng),
      Math.abs(ac.lng - zone.maxLng)
    );
    if (distToEdgeLat < BOUNDARY_MARGIN || distToEdgeLng < BOUNDARY_MARGIN) {
      anomalies.push({
        entityId: ac.id,
        entityName: ac.name,
        type: "boundary",
        severity: "warning",
        description: `靠近空域边缘（lat 距边界 ${distToEdgeLat.toFixed(2)}°, lng 距边界 ${distToEdgeLng.toFixed(2)}°），存在偏离航线风险`,
        lat: ac.lat,
        lng: ac.lng,
      });
    }
  }

  return anomalies;
}

/** 按 ID 批量获取轨迹 */
export function getAdsTrajectoriesByIds(
  entityIds: string[]
): AdsTrajectory[] {
  if (!initialized) initAdsAircrafts();

  const idSet = new Set(entityIds);
  return aircraftStates
    .filter((s) => idSet.has(s.id) && s.trajectory.length >= 2)
    .map((s) => ({
      id: s.id,
      name: `${s.name}_飞行轨迹`,
      points: s.trajectory.slice(-30).map(([lng, lat]) => ({ lat, lng })),
    }));
}

export function getAdsStats() {
  if (!initialized) return { count: 0, byStatus: {}, byImportance: {} };
  const byStatus: Record<string, number> = {};
  const byImportance: Record<string, number> = {};
  aircraftStates.forEach((s) => {
    byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    byImportance[s.importance] = (byImportance[s.importance] || 0) + 1;
  });
  return { count: aircraftStates.length, byStatus, byImportance };
}

// ==================== 全量数据导出（供前端地图展示） ====================

/** 获取全部飞机实体（前端 Entity 格式），限制 3000 架以保障渲染性能 */
export function getAllAdsEntities(): Array<{
  id: string;
  name: string;
  type: string;
  coordinates: [number, number];
  importance: string;
  status: string;
  description: string;
  speed: number;
  heading: number;
  altitude: number;
}> {
  if (!initialized) initAdsAircrafts();

  const MAX_RENDER_COUNT = 1000;

  // 优先保留 warning/danger，再按最近更新排序取正常飞机
  const prioritized = [...aircraftStates].sort((a, b) => {
    const aScore = (a.status !== "normal" ? 2 : 0) + (a.importance === "high" ? 1 : 0);
    const bScore = (b.status !== "normal" ? 2 : 0) + (b.importance === "high" ? 1 : 0);
    if (bScore !== aScore) return bScore - aScore;
    return b.lastUpdated - a.lastUpdated;
  });

  const selected = prioritized.slice(0, MAX_RENDER_COUNT);

  return selected.map((s) => ({
    id: s.id,
    name: s.name,
    type: "aircraft",
    coordinates: [s.lng, s.lat] as [number, number],
    importance: s.importance,
    status: s.status,
    description: `${s.dataSource === "real" ? "ADS-B实时信号" : "模拟数据"} | 航速:${Math.round(s.speed)}km/h | 航向:${Math.round(s.heading)}° | 高度:${Math.round(s.altitude)}m | 空域:${AIR_ZONES[s.zoneIndex]?.name || "未知空域"}`,
    speed: Math.round(s.speed),
    heading: Math.round(s.heading),
    altitude: Math.round(s.altitude),
  }));
}

/** 获取全部飞机轨迹（前端 Trajectory 格式） */
export function getAllAdsTrajectories(): Array<{
  id: string;
  name: string;
  type: string;
  coordinates: [number, number][];
  status: string;
}> {
  if (!initialized) initAdsAircrafts();

  return aircraftStates
    .filter((s) => s.trajectory.length >= 2)
    .map((s) => ({
      id: `traj-${s.id}`,
      name: `${s.name}_飞行轨迹`,
      type: "route",
      coordinates: s.trajectory.slice(-30),
      status: "realtime",
    }));
}
