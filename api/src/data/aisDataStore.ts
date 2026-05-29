import { startAISStream, stopAISStream, onVesselUpdate, type RawVesselUpdate } from "./aisStreamClient.js";
import { type ShipDTAreaShip } from "./shipdtClient.js";

// ==================== 海域定义 ====================
export const SEA_ZONES: {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
  name: string;
}[] = [
  // ========== 中国近海（原有）==========
  { minLng: 118.0, maxLng: 121.0, minLat: 37.8, maxLat: 40.0, name: "渤海" },
  { minLng: 121.0, maxLng: 126.0, minLat: 33.0, maxLat: 37.5, name: "黄海" },
  { minLng: 123.0, maxLng: 128.0, minLat: 28.0, maxLat: 32.0, name: "东海北部" },
  { minLng: 122.0, maxLng: 127.0, minLat: 24.0, maxLat: 28.0, name: "东海南部" },
  { minLng: 118.5, maxLng: 121.5, minLat: 22.5, maxLat: 25.0, name: "台湾海峡" },
  { minLng: 112.0, maxLng: 118.0, minLat: 16.0, maxLat: 21.5, name: "南海北部" },
  { minLng: 111.0, maxLng: 116.0, minLat: 10.0, maxLat: 16.0, name: "南海南部" },
  { minLng: 106.0, maxLng: 111.0, minLat: 17.0, maxLat: 21.5, name: "北部湾" },
  { minLng: 129.0, maxLng: 135.0, minLat: 34.0, maxLat: 38.0, name: "日本海" },
  { minLng: 125.0, maxLng: 130.0, minLat: 20.0, maxLat: 24.0, name: "菲律宾海" },

  // ========== 东南亚 / 印度洋 ==========
  { minLng: 95.0, maxLng: 105.0, minLat: 0.0, maxLat: 8.0, name: "马六甲海峡" },
  { minLng: 60.0, maxLng: 95.0, minLat: 5.0, maxLat: 25.0, name: "印度洋北部" },
  { minLng: 60.0, maxLng: 95.0, minLat: -5.0, maxLat: 5.0, name: "印度洋中部" },
  { minLng: 80.0, maxLng: 95.0, minLat: 5.0, maxLat: 20.0, name: "孟加拉湾" },
  { minLng: 55.0, maxLng: 70.0, minLat: 10.0, maxLat: 25.0, name: "阿拉伯海" },

  // ========== 中东 ==========
  { minLng: 47.0, maxLng: 57.0, minLat: 24.0, maxLat: 31.0, name: "波斯湾" },
  { minLng: 35.0, maxLng: 45.0, minLat: 12.0, maxLat: 30.0, name: "红海" },
  { minLng: 43.0, maxLng: 50.0, minLat: 11.0, maxLat: 15.0, name: "亚丁湾" },

  // ========== 地中海 / 苏伊士 ==========
  { minLng: 20.0, maxLng: 35.0, minLat: 30.0, maxLat: 37.0, name: "地中海东部" },
  { minLng: -5.0, maxLng: 20.0, minLat: 30.0, maxLat: 42.0, name: "地中海西部" },
  { minLng: 30.0, maxLng: 33.0, minLat: 29.0, maxLat: 32.0, name: "苏伊士运河" },

  // ========== 西太平洋扩展 ==========
  { minLng: 130.0, maxLng: 140.0, minLat: 15.0, maxLat: 24.0, name: "菲律宾海东部" },
  { minLng: 140.0, maxLng: 150.0, minLat: 10.0, maxLat: 20.0, name: "西太平洋" },
  { minLng: 135.0, maxLng: 142.0, minLat: 35.0, maxLat: 52.0, name: "日本海北部" },
  { minLng: 140.0, maxLng: 155.0, minLat: 45.0, maxLat: 62.0, name: "鄂霍次克海" },
];

// 允许通过环境变量动态扩展海域（JSON 数组格式）
const EXTRA_SEA_ZONES: typeof SEA_ZONES = (() => {
  try {
    const raw = process.env.SEA_ZONES_EXTRA;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    console.warn("[AIS] SEA_ZONES_EXTRA 环境变量解析失败，将忽略");
  }
  return [];
})();

if (EXTRA_SEA_ZONES.length > 0) {
  SEA_ZONES.push(...EXTRA_SEA_ZONES);
  console.log(`[AIS] 通过环境变量扩展了 ${EXTRA_SEA_ZONES.length} 个海域`);
}

const SHIP_PREFIXES = [
  "货轮", "集装箱船", "油轮", "LNG船", "散货船", "渔船",
  "科考船", "巡逻艇", "护卫舰", "补给舰", "破冰船", "滚装船", "邮轮",
];
const SHIP_CODES = [
  "HHXC", "YHXY", "DLHY", "JHY", "BH", "QDH", "XM", "ZHS", "SY", "NJ",
  "TK", "LY", "FS", "HZ", "NB", "WZ", "TZ", "WX", "CS", "HEB", "CC",
  "KM", "NN", "GY", "LZ", "XN", "YC", "XZ", "HF", "NT", "YZ", "ZJ",
  "CZ", "JX", "SX", "JH", "QU", "LS", "ZS",
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

function generateShipName(index: number): string {
  const prefix = pick(SHIP_PREFIXES);
  const code = SHIP_CODES[index % SHIP_CODES.length];
  const num = String(randInt(1, 999)).padStart(3, "0");
  return prefix + "_" + code + "_" + num;
}

// ==================== 内部状态 ====================
export interface ShipState {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  status: "normal" | "warning" | "danger";
  riskLevel: "low" | "medium" | "high";
  importance: "high" | "medium" | "low";
  trajectory: [number, number][];
  zoneIndex: number;
  lastUpdated: number;
  dataSource: "real" | "mock" | "shipdt" | "station";
}

let shipStates: ShipState[] = [];
let initialized = false;
let useRealData = false;
let unsubscribeVesselUpdate: (() => void) | null = null;
let stopStationPolling: (() => void) | null = null;

const MAX_VESSEL_COUNT = 2000;
const VESSEL_STALE_THRESHOLD_MS = 600_000; // 10 分钟
const VESSEL_FRESHNESS_THRESHOLD_MS = 120_000; // 2 分钟（异常检测用）
const DR_STALE_THRESHOLD_MS = 30_000; // 30 秒（航位推算）

function mapStatusToRiskLevel(
  status: "normal" | "warning" | "danger"
): "low" | "medium" | "high" {
  if (status === "danger") return "high";
  if (status === "warning") return "medium";
  return "low";
}

export function computeZoneIndex(lat: number, lng: number): number {
  for (let i = 0; i < SEA_ZONES.length; i++) {
    const z = SEA_ZONES[i];
    if (lng >= z.minLng && lng <= z.maxLng && lat >= z.minLat && lat <= z.maxLat) {
      return i;
    }
  }
  return -1;
}

// ==================== Mock 数据生成 ====================
function generateMockShips(count: number): void {
  const shipsPerZone = Math.floor(count / SEA_ZONES.length);
  const extra = count - shipsPerZone * SEA_ZONES.length;
  const newStates: ShipState[] = [];

  SEA_ZONES.forEach((zone, zoneIdx) => {
    const zoneCount = shipsPerZone + (zoneIdx < extra ? 1 : 0);
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
      const speed = randFloat(2, 28);

      const historyLength = randInt(20, 40);
      const trajectory: [number, number][] = [];
      let curLng = lng;
      let curLat = lat;
      for (let h = 0; h < historyLength; h++) {
        trajectory.unshift([curLng, curLat]);
        const dist = (speed * 60) / 3600;
        const backHeading = (heading + 180) % 360;
        const dLat = (dist * Math.cos((backHeading * Math.PI) / 180)) / 60;
        const dLng =
          (dist * Math.sin((backHeading * Math.PI) / 180)) /
          (60 * Math.cos((curLat * Math.PI) / 180));
        curLat += dLat;
        curLng += dLng;
      }

      newStates.push({
        id: "ais-ship-" + String(globalIndex).padStart(4, "0"),
        name: generateShipName(globalIndex),
        type: pick(SHIP_PREFIXES),
        lat: parseFloat(lat.toFixed(6)),
        lng: parseFloat(lng.toFixed(6)),
        heading,
        speed,
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

  shipStates = newStates;
}

// ==================== 真实数据处理 ====================
function handleRealVesselUpdate(update: RawVesselUpdate): void {
  const now = Date.now();
  const existing = shipStates.find((s) => s.id === update.mmsi);
  const coords: [number, number] = [update.lng, update.lat];

  if (existing) {
    existing.lat = update.lat;
    existing.lng = update.lng;
    existing.speed = update.sog;
    existing.heading = update.cog;
    existing.trajectory.push(coords);
    if (existing.trajectory.length > 50) existing.trajectory.shift();
    existing.lastUpdated = now;
    existing.zoneIndex = computeZoneIndex(update.lat, update.lng);
    // 重新推导风险状态
    deriveVesselStatus(existing);
  } else {
    shipStates.push({
      id: update.mmsi,
      name: update.shipName || `MMSI-${update.mmsi}`,
      type: "unknown",
      lat: update.lat,
      lng: update.lng,
      heading: update.cog,
      speed: update.sog,
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

export function deriveVesselStatus(ship: ShipState): void {
  // 速度异常
  if (ship.speed > 25) {
    ship.status = "warning";
    ship.riskLevel = "medium";
    return;
  }
  if (ship.speed < 1) {
    ship.status = "warning";
    ship.riskLevel = "medium";
    return;
  }

  // 边界逼近
  const zone = SEA_ZONES[ship.zoneIndex];
  if (zone) {
    const margin = 0.5;
    if (
      Math.abs(ship.lat - zone.minLat) < margin ||
      Math.abs(ship.lat - zone.maxLat) < margin ||
      Math.abs(ship.lng - zone.minLng) < margin ||
      Math.abs(ship.lng - zone.maxLng) < margin
    ) {
      ship.status = "warning";
      ship.riskLevel = "medium";
      return;
    }
  }

  ship.status = "normal";
  ship.riskLevel = "low";
}

function cleanupStaleVessels(): void {
  const now = Date.now();
  const before = shipStates.length;
  shipStates = shipStates.filter((s) => {
    if (s.dataSource !== "real") return true;
    return now - s.lastUpdated < VESSEL_STALE_THRESHOLD_MS;
  });
  if (shipStates.length < before) {
    console.log(`[AIS] Cleaned up ${before - shipStates.length} stale vessels`);
  }
}

function enforceMaxVesselCount(): void {
  if (shipStates.length <= MAX_VESSEL_COUNT) return;
  // 按 lastUpdated 排序，淘汰最久未更新的真实船舶
  const realVessels = shipStates.filter((s) => s.dataSource === "real");
  if (realVessels.length <= MAX_VESSEL_COUNT) return;

  realVessels.sort((a, b) => a.lastUpdated - b.lastUpdated);
  const toEvict = realVessels.slice(0, realVessels.length - MAX_VESSEL_COUNT);
  const evictSet = new Set(toEvict.map((s) => s.id));
  shipStates = shipStates.filter((s) => !evictSet.has(s.id));
  console.log(`[AIS] Evicted ${toEvict.length} vessels to enforce MAX_VESSEL_COUNT`);
}

// ==================== 初始化 ====================
export function initAisShips(count: number = 320): void {
  if (initialized && shipStates.length > 0) return;

  const apiKey = process.env.AISSTREAM_API_KEY;
  if (apiKey) {
    useRealData = true;
    unsubscribeVesselUpdate = onVesselUpdate(handleRealVesselUpdate);
    startAISStream(apiKey);
    console.log("[AIS] Real-time mode: AISStream WebSocket enabled");
  } else {
    useRealData = false;
    generateMockShips(count);
    console.log(`[AIS] Mock mode: generated ${shipStates.length} simulated ships`);
  }

  // 启动 StationInfo 轮询（与 AISStream/Mock 并行）
  if (!stopStationPolling) {
    import("./stationInfoClient.js")
      .then(({ startStationInfoPolling }) => {
        startStationInfoPolling((ships) => {
          const { added, updated } = importStationInfoShips(ships);
          if (added > 0 || updated > 0) {
            console.log(`[StationInfo] Imported ${added} new, ${updated} updated`);
          }
        });
        stopStationPolling = () => {
          import("./stationInfoClient.js").then(({ stopStationInfoPolling }) => {
            stopStationInfoPolling();
          });
        };
      })
      .catch((err) => {
        console.error("[AIS] Failed to load stationInfoClient:", err);
      });
  }

  initialized = true;
}

// ==================== 实时位置更新 ====================
export function updateAisPositions(dtSeconds: number = 1): void {
  if (!initialized || shipStates.length === 0) {
    initAisShips();
    return;
  }

  if (useRealData) {
    // 真实模式：航位推算 + 清理
    const now = Date.now();
    shipStates.forEach((ship) => {
      if (ship.dataSource !== "real") return;
      const staleMs = now - ship.lastUpdated;
      if (staleMs > DR_STALE_THRESHOLD_MS && ship.speed > 0.5) {
        const dtHours = staleMs / 3600000;
        const distanceNm = ship.speed * dtHours;
        const rad = (ship.heading * Math.PI) / 180;
        const dLat = (distanceNm * Math.cos(rad)) / 60;
        const dLng =
          (distanceNm * Math.sin(rad)) / (60 * Math.cos((ship.lat * Math.PI) / 180));
        ship.lat += dLat;
        ship.lng += dLng;
        ship.lat = parseFloat(ship.lat.toFixed(6));
        ship.lng = parseFloat(ship.lng.toFixed(6));
        ship.zoneIndex = computeZoneIndex(ship.lat, ship.lng);
      }
    });
    cleanupStaleVessels();
    enforceMaxVesselCount();
  } else {
    // Mock 模式：完整模拟
    shipStates.forEach((ship) => {
      const zone = SEA_ZONES[ship.zoneIndex];

      const TIME_SCALE = 30;
      const dtHours = (dtSeconds * TIME_SCALE) / 3600;
      const distanceNm = ship.speed * dtHours;

      const rad = (ship.heading * Math.PI) / 180;
      const dLat = (distanceNm * Math.cos(rad)) / 60;
      const dLng =
        (distanceNm * Math.sin(rad)) / (60 * Math.cos((ship.lat * Math.PI) / 180));

      let newLat = ship.lat + dLat;
      let newLng = ship.lng + dLng;

      const margin = 0.3;
      let headingChanged = false;

      if (newLat < zone.minLat + margin || newLat > zone.maxLat - margin) {
        ship.heading = randFloat(0, 360);
        headingChanged = true;
      }
      if (newLng < zone.minLng + margin || newLng > zone.maxLng - margin) {
        ship.heading = randFloat(0, 360);
        headingChanged = true;
      }

      if (headingChanged) {
        const rad2 = (ship.heading * Math.PI) / 180;
        const dLat2 = (distanceNm * Math.cos(rad2)) / 60;
        const dLng2 =
          (distanceNm * Math.sin(rad2)) / (60 * Math.cos((ship.lat * Math.PI) / 180));
        newLat = ship.lat + dLat2;
        newLng = ship.lng + dLng2;
      }

      if (Math.random() < 0.02) {
        ship.heading = (ship.heading + randFloat(-30, 30)) % 360;
        if (ship.heading < 0) ship.heading += 360;
      }

      if (Math.random() < 0.05) {
        ship.speed = Math.max(2, Math.min(28, ship.speed + randFloat(-2, 2)));
      }

      newLat = Math.max(zone.minLat, Math.min(zone.maxLat, newLat));
      newLng = Math.max(zone.minLng, Math.min(zone.maxLng, newLng));

      ship.lat = parseFloat(newLat.toFixed(6));
      ship.lng = parseFloat(newLng.toFixed(6));

      ship.trajectory.push([ship.lng, ship.lat]);
      if (ship.trajectory.length > 50) {
        ship.trajectory.shift();
      }
    });
  }
}

// ==================== 海域匹配 ====================
function matchZones(region: string): number[] {
  const normalized = region.trim();
  const matched: number[] = [];
  for (let i = 0; i < SEA_ZONES.length; i++) {
    if (SEA_ZONES[i].name.includes(normalized) || normalized.includes(SEA_ZONES[i].name)) {
      matched.push(i);
    }
  }
  return matched;
}

// ==================== 对外接口 ====================
export interface AisEntity {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  status: "normal" | "warning" | "danger";
  riskLevel: "low" | "medium" | "high";
}

export function getAisEntitiesInRegion(
  region: string,
  limit?: number
): AisEntity[] {
  if (!initialized) initAisShips();

  const zoneIndices = matchZones(region);
  let results = shipStates
    .filter((s) => zoneIndices.includes(s.zoneIndex))
    .map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      lat: s.lat,
      lng: s.lng,
      speed: parseFloat(s.speed.toFixed(1)),
      heading: Math.round(s.heading),
      status: s.status,
      riskLevel: s.riskLevel,
    }));

  if (limit && limit > 0) {
    results = results.slice(0, limit);
  }

  return results;
}

/** 按 ID 查询船舶当前状态（用于 ShipDT 数据颜色对齐） */
export function getAisEntityById(id: string): AisEntity | undefined {
  if (!initialized) initAisShips();
  const s = shipStates.find((s) => s.id === id);
  if (!s) return undefined;
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    lat: s.lat,
    lng: s.lng,
    speed: parseFloat(s.speed.toFixed(1)),
    heading: Math.round(s.heading),
    status: s.status,
    riskLevel: s.riskLevel,
  };
}

export interface AisTrajectory {
  id: string;
  name: string;
  points: { lat: number; lng: number }[];
}

export function getAisTrajectoriesInRegion(
  region: string,
  limit?: number
): AisTrajectory[] {
  if (!initialized) initAisShips();

  const zoneIndices = matchZones(region);
  let results = shipStates
    .filter((s) => zoneIndices.includes(s.zoneIndex) && s.trajectory.length >= 2)
    .map((s) => ({
      id: s.id,
      name: s.name + "_航行轨迹",
      points: s.trajectory.slice(-30).map(([lng, lat]) => ({ lat, lng })),
    }));

  if (limit && limit > 0) {
    results = results.slice(0, limit);
  }

  return results;
}

// ==================== 风险筛选与异常检测 ====================

/** 计算两点间距离（海里），使用 haversine 公式 */
function distanceNm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3440.065; // 地球半径（海里）
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

export interface AisAnomaly {
  entityId: string;
  entityName: string;
  type: "clustering" | "speed" | "boundary";
  severity: "warning" | "danger";
  description: string;
  relatedIds?: string[];
  lat: number;
  lng: number;
}

/** 获取高危实体（riskLevel=high 或 status=danger） */
export function getAisHighRiskEntities(
  region: string,
  limit?: number
): AisEntity[] {
  if (!initialized) initAisShips();

  const zoneIndices = matchZones(region);
  let results = shipStates
    .filter((s) => zoneIndices.includes(s.zoneIndex) && s.status !== "normal")
    .map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      lat: s.lat,
      lng: s.lng,
      speed: parseFloat(s.speed.toFixed(1)),
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
export function getAisAnomalies(region: string): AisAnomaly[] {
  if (!initialized) initAisShips();

  const zoneIndices = matchZones(region);
  let regionShips = shipStates.filter((s) => zoneIndices.includes(s.zoneIndex));

  // 真实数据：只处理新鲜数据，避免对陈旧航位推算数据做聚集检测
  if (useRealData) {
    const now = Date.now();
    regionShips = regionShips.filter(
      (s) => s.dataSource === "mock" || now - s.lastUpdated < VESSEL_FRESHNESS_THRESHOLD_MS
    );
  }

  const anomalies: AisAnomaly[] = [];

  // 1. 聚集异常：两船距离 < 5 海里
  const CLUSTER_THRESHOLD_NM = 5;
  const clustered = new Set<string>();
  for (let i = 0; i < regionShips.length; i++) {
    for (let j = i + 1; j < regionShips.length; j++) {
      const a = regionShips[i];
      const b = regionShips[j];
      const dist = distanceNm(a.lat, a.lng, b.lat, b.lng);
      if (dist < CLUSTER_THRESHOLD_NM) {
        if (!clustered.has(a.id)) {
          clustered.add(a.id);
          anomalies.push({
            entityId: a.id,
            entityName: a.name,
            type: "clustering",
            severity: dist < 2 ? "danger" : "warning",
            description: `与 ${b.name} 距离过近（${dist.toFixed(1)} 海里），疑似密集聚集`,
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
            severity: dist < 2 ? "danger" : "warning",
            description: `与 ${a.name} 距离过近（${dist.toFixed(1)} 海里），疑似密集聚集`,
            relatedIds: [a.id],
            lat: b.lat,
            lng: b.lng,
          });
        }
      }
    }
  }

  // 2. 速度异常
  for (const ship of regionShips) {
    if (ship.speed > 25) {
      anomalies.push({
        entityId: ship.id,
        entityName: ship.name,
        type: "speed",
        severity: "warning",
        description: `航速异常过快（${ship.speed.toFixed(1)} 节），超出一般商船巡航速度`,
        lat: ship.lat,
        lng: ship.lng,
      });
    } else if (ship.speed < 1) {
      anomalies.push({
        entityId: ship.id,
        entityName: ship.name,
        type: "speed",
        severity: "warning",
        description: `航速极低（${ship.speed.toFixed(1)} 节），疑似停泊或漂流状态`,
        lat: ship.lat,
        lng: ship.lng,
      });
    }
  }

  // 3. 边界逼近：距离海域边缘 < 0.5 度
  const BOUNDARY_MARGIN = 0.5;
  for (const ship of regionShips) {
    const zone = SEA_ZONES[ship.zoneIndex];
    if (!zone) continue;
    const distToEdgeLat = Math.min(
      Math.abs(ship.lat - zone.minLat),
      Math.abs(ship.lat - zone.maxLat)
    );
    const distToEdgeLng = Math.min(
      Math.abs(ship.lng - zone.minLng),
      Math.abs(ship.lng - zone.maxLng)
    );
    if (distToEdgeLat < BOUNDARY_MARGIN || distToEdgeLng < BOUNDARY_MARGIN) {
      anomalies.push({
        entityId: ship.id,
        entityName: ship.name,
        type: "boundary",
        severity: "warning",
        description: `靠近海域边缘（lat 距边界 ${distToEdgeLat.toFixed(2)}°, lng 距边界 ${distToEdgeLng.toFixed(2)}°），存在越界风险`,
        lat: ship.lat,
        lng: ship.lng,
      });
    }
  }

  return anomalies;
}

/** 按 ID 批量获取轨迹 */
export function getAisTrajectoriesByIds(
  entityIds: string[]
): AisTrajectory[] {
  if (!initialized) initAisShips();

  const idSet = new Set(entityIds);
  return shipStates
    .filter((s) => idSet.has(s.id) && s.trajectory.length >= 2)
    .map((s) => ({
      id: s.id,
      name: s.name + "_航行轨迹",
      points: s.trajectory.slice(-30).map(([lng, lat]) => ({ lat, lng })),
    }));
}

// ==================== ShipDT 数据集成 ====================

const SHIPDT_STALE_THRESHOLD_MS = 600_000; // 10 分钟

/** 将 ShipDT 原始数据转换为内部 ShipState */
function shipDTToShipState(raw: ShipDTAreaShip): ShipState {
  const lat = raw.lat / 1_000_000;
  const lng = raw.lon / 1_000_000;
  const sog = raw.sog != null ? raw.sog / 100 : 0;
  const cog = raw.cog != null ? raw.cog / 100 : 0;
  const hdg = raw.hdg != null ? raw.hdg / 100 : cog;
  const length = raw.length != null ? raw.length / 10 : 0;
  const width = raw.width != null ? raw.width / 10 : 0;

  const name = raw.name || raw.ais_name || `MMSI-${raw.mmsi}`;
  const mmsiStr = String(raw.mmsi);

  return {
    id: mmsiStr,
    name,
    type: raw.shipTypeName || "unknown",
    lat: parseFloat(lat.toFixed(6)),
    lng: parseFloat(lng.toFixed(6)),
    heading: hdg,
    speed: sog,
    status: "normal",
    riskLevel: "low",
    importance: "low",
    trajectory: [[lng, lat]],
    zoneIndex: computeZoneIndex(lat, lng),
    lastUpdated: Date.now(),
    dataSource: "shipdt",
  };
}

/** 导入 ShipDT 区域查询结果到内存 store，按 MMSI 去重（AISStream 优先） */
export function importShipdtShips(ships: ShipDTAreaShip[]): {
  added: number;
  skipped: number;
} {
  let added = 0;
  let skipped = 0;

  for (const raw of ships) {
    if (!raw.mmsi) continue;

    const mmsiStr = String(raw.mmsi);

    // 如果 AISStream 已有该 MMSI，跳过（AISStream 实时性更好）
    const existingAis = shipStates.find(
      (s) => s.id === mmsiStr && s.dataSource === "real"
    );
    if (existingAis) {
      skipped++;
      continue;
    }

    // 如果已有 ShipDT 版本，更新它
    const existingIdx = shipStates.findIndex(
      (s) => s.id === mmsiStr && s.dataSource === "shipdt"
    );
    const state = shipDTToShipState(raw);
    deriveVesselStatus(state);

    if (existingIdx >= 0) {
      shipStates[existingIdx] = state;
    } else {
      shipStates.push(state);
      added++;
    }
  }

  // 保持总数上限
  enforceMaxVesselCount();

  return { added, skipped };
}

/** 清理过期的 ShipDT 船舶 */
function cleanupStaleShipdtVessels(): void {
  const now = Date.now();
  const before = shipStates.length;
  shipStates = shipStates.filter((s) => {
    if (s.dataSource !== "shipdt") return true;
    return now - s.lastUpdated < SHIPDT_STALE_THRESHOLD_MS;
  });
  const removed = before - shipStates.length;
  if (removed > 0) {
    console.log(`[AIS] Cleaned up ${removed} stale ShipDT vessels`);
  }
}

// 每 60 秒清理一次过期 ShipDT 数据
setInterval(cleanupStaleShipdtVessels, 60_000);

// ==================== StationInfo 数据集成 ====================

const STATION_STALE_THRESHOLD_MS = 300_000; // 5 分钟

/** 导入 StationInfo 数据到内存 store，按 OriginalID 去重 */
export function importStationInfoShips(ships: ShipState[]): { added: number; updated: number } {
  let added = 0;
  let updated = 0;

  for (const state of ships) {
    const existingIdx = shipStates.findIndex((s) => s.id === state.id);
    if (existingIdx >= 0) {
      const existing = shipStates[existingIdx];
      // StationInfo 优先级低于 AISStream，高于 Mock
      if (existing.dataSource === "real") {
        continue; // AISStream 实时数据优先，不覆盖
      }
      shipStates[existingIdx] = state;
      updated++;
    } else {
      shipStates.push(state);
      added++;
    }
  }

  enforceMaxVesselCount();
  return { added, updated };
}

/** 清理过期的 StationInfo 船舶 */
function cleanupStaleStationVessels(): void {
  const now = Date.now();
  const before = shipStates.length;
  shipStates = shipStates.filter((s) => {
    if (s.dataSource !== "station") return true;
    return now - s.lastUpdated < STATION_STALE_THRESHOLD_MS;
  });
  const removed = before - shipStates.length;
  if (removed > 0) {
    console.log(`[AIS] Cleaned up ${removed} stale StationInfo vessels`);
  }
}

// 每 60 秒清理一次过期 StationInfo 数据
setInterval(cleanupStaleStationVessels, 60_000);

export function getAisStats() {
  if (!initialized) return { count: 0, byStatus: {}, byImportance: {} };
  const byStatus: Record<string, number> = {};
  const byImportance: Record<string, number> = {};
  shipStates.forEach((s) => {
    byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    byImportance[s.importance] = (byImportance[s.importance] || 0) + 1;
  });
  return { count: shipStates.length, byStatus, byImportance };
}

/** 获取指定海域的合并边界框 */
export function getRegionBounds(region: string): { minLng: number; maxLng: number; minLat: number; maxLat: number } | null {
  const zoneIndices = matchZones(region);
  if (zoneIndices.length === 0) return null;

  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const idx of zoneIndices) {
    const z = SEA_ZONES[idx];
    if (!z) continue;
    minLng = Math.min(minLng, z.minLng);
    maxLng = Math.max(maxLng, z.maxLng);
    minLat = Math.min(minLat, z.minLat);
    maxLat = Math.max(maxLat, z.maxLat);
  }
  return { minLng, maxLng, minLat, maxLat };
}

/** 获取指定海域的数据来源统计 */
export function getRegionDataSourceSummary(region: string): { aisStream: number; shipdt: number; station: number; mock: number } {
  if (!initialized) return { aisStream: 0, shipdt: 0, station: 0, mock: 0 };
  const zoneIndices = matchZones(region);
  const summary = { aisStream: 0, shipdt: 0, station: 0, mock: 0 };
  shipStates.forEach((s) => {
    if (!zoneIndices.includes(s.zoneIndex)) return;
    if (s.dataSource === "real") summary.aisStream++;
    else if (s.dataSource === "shipdt") summary.shipdt++;
    else if (s.dataSource === "station") summary.station++;
    else if (s.dataSource === "mock") summary.mock++;
  });
  return summary;
}

/** 获取指定海域内船舶的最新数据时间戳 */
export function getRegionDataTimestamp(region: string): number {
  if (!initialized) return 0;
  const zoneIndices = matchZones(region);
  let maxTs = 0;
  shipStates.forEach((s) => {
    if (zoneIndices.includes(s.zoneIndex)) {
      maxTs = Math.max(maxTs, s.lastUpdated);
    }
  });
  return maxTs;
}

/** 获取相邻海域名称列表（基于边界框重叠判断） */
export function getNearbyRegions(region: string, maxResults: number = 3): string[] {
  const bounds = getRegionBounds(region);
  if (!bounds) return [];

  const overlapThreshold = 0.5; // 度
  const nearby: { name: string; overlapScore: number }[] = [];

  for (const zone of SEA_ZONES) {
    if (region.includes(zone.name) || zone.name.includes(region)) continue;

    const xOverlap = Math.max(0, Math.min(bounds.maxLng, zone.maxLng) - Math.max(bounds.minLng, zone.minLng));
    const yOverlap = Math.max(0, Math.min(bounds.maxLat, zone.maxLat) - Math.max(bounds.minLat, zone.minLat));
    if (xOverlap > overlapThreshold || yOverlap > overlapThreshold) {
      nearby.push({ name: zone.name, overlapScore: xOverlap + yOverlap });
    }
  }

  nearby.sort((a, b) => b.overlapScore - a.overlapScore);
  return nearby.slice(0, maxResults).map((n) => n.name);
}

// ==================== 全量数据导出（供前端地图展示） ====================

/** 获取全部船舶实体（前端 Entity 格式） */
export function getAllAisEntities(): Array<{
  id: string;
  name: string;
  type: string;
  coordinates: [number, number];
  importance: string;
  status: string;
  description: string;
  speed: number;
  heading: number;
}> {
  if (!initialized) initAisShips();

  return shipStates.map((s) => ({
    id: s.id,
    name: s.name,
    type: "ship",
    coordinates: [s.lng, s.lat] as [number, number],
    importance: s.importance,
    status: s.status,
    description: `${s.dataSource === "real" ? "AIS实时信号" : s.dataSource === "shipdt" ? "ShipDT补充" : s.dataSource === "station" ? "船舶（鑫诺）" : "模拟数据"} | 航速:${s.speed.toFixed(1)}节 | 航向:${Math.round(s.heading)}° | 海域:${SEA_ZONES[s.zoneIndex]?.name || "未知海域"}`,
    speed: parseFloat(s.speed.toFixed(1)),
    heading: Math.round(s.heading),
  }));
}

/** 获取全部船舶轨迹（前端 Trajectory 格式） */
export function getAllAisTrajectories(): Array<{
  id: string;
  name: string;
  type: string;
  coordinates: [number, number][];
  status: string;
}> {
  if (!initialized) initAisShips();

  return shipStates
    .filter((s) => s.trajectory.length >= 2)
    .map((s) => ({
      id: `traj-${s.id}`,
      name: `${s.name}_航行轨迹`,
      type: "route",
      coordinates: s.trajectory.slice(-30),
      status: "realtime",
    }));
}
