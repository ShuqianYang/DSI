import { Entity, Trajectory } from "@/types/prd";

// ==================== 民航空域定义 ====================
// 预定义的主要民航航线空域（lng, lat），确保飞机在陆地上方/近海航线
const AIR_ZONES: {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
  name: string;
}[] = [
  // 亚洲
  { minLng: 100.0, maxLng: 122.0, minLat: 20.0, maxLat: 45.0, name: "中国东部空域" },
  { minLng: 70.0, maxLng: 95.0, minLat: 8.0, maxLat: 35.0, name: "南亚空域" },
  { minLng: 35.0, maxLng: 60.0, minLat: 25.0, maxLat: 42.0, name: "中东空域" },
  { minLng: 125.0, maxLng: 145.0, minLat: 30.0, maxLat: 45.0, name: "日本空域" },
  // 欧洲
  { minLng: -10.0, maxLng: 25.0, minLat: 35.0, maxLat: 60.0, name: "西欧空域" },
  { minLng: 25.0, maxLng: 50.0, minLat: 40.0, maxLat: 65.0, name: "东欧空域" },
  // 北美
  { minLng: -125.0, maxLng: -95.0, minLat: 25.0, maxLat: 50.0, name: "美国西部空域" },
  { minLng: -95.0, maxLng: -65.0, minLat: 25.0, maxLat: 50.0, name: "美国东部空域" },
  // 其他大洲
  { minLng: 115.0, maxLng: 155.0, minLat: -38.0, maxLat: -15.0, name: "澳洲空域" },
  { minLng: -80.0, maxLng: -35.0, minLat: -35.0, maxLat: 5.0, name: "南美空域" },
  { minLng: -10.0, maxLng: 40.0, minLat: -35.0, maxLat: 5.0, name: "非洲空域" },
  { minLng: 165.0, maxLng: 180.0, minLat: -45.0, maxLat: -30.0, name: "新西兰空域" },
];

// ==================== 航空公司与航班词库 ====================
const AIRLINES = [
  { code: "CA", name: "国航" },
  { code: "MU", name: "东航" },
  { code: "CZ", name: "南航" },
  { code: "HU", name: "海航" },
  { code: "MF", name: "厦航" },
  { code: "3U", name: "川航" },
  { code: "ZH", name: "深航" },
  { code: "SC", name: "山航" },
  { code: "JL", name: "日航" },
  { code: "NH", name: "全日空" },
  { code: "KE", name: "大韩" },
  { code: "OZ", name: "韩亚" },
  { code: "CX", name: "国泰" },
  { code: "SQ", name: "新航" },
  { code: "MH", name: "马航" },
  { code: "TG", name: "泰航" },
  { code: "UA", name: "美联航" },
  { code: "AA", name: "美航" },
  { code: "BA", name: "英航" },
  { code: "LH", name: "汉莎" },
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
  entity: Entity;
  heading: number; // 航向，0-360度，0=北，90=东
  speed: number; // 航速，km/h
  altitude: number; // 飞行高度，米
  trajectory: [number, number][];
  zoneIndex: number; // 所属空域
}

let aircraftStates: AircraftState[] = [];
let initialized = false;

// ==================== 初始化 300+ 飞机 ====================
export function initAdsAircrafts(count: number = 20): {
  entities: Entity[];
  trajectories: Trajectory[];
} {
  if (initialized && aircraftStates.length >= count) {
    return exportAdsData();
  }

  const aircraftsPerZone = Math.floor(count / AIR_ZONES.length);
  const extra = count - aircraftsPerZone * AIR_ZONES.length;

  const newStates: AircraftState[] = [];

  AIR_ZONES.forEach((zone, zoneIdx) => {
    const zoneCount = aircraftsPerZone + (zoneIdx < extra ? 1 : 0);
    for (let i = 0; i < zoneCount; i++) {
      const globalIndex = newStates.length;
      const lng = randFloat(zone.minLng, zone.maxLng);
      const lat = randFloat(zone.minLat, zone.maxLat);

      // 重要性分布：high 10%, medium 30%, low 60%
      const importanceRoll = Math.random();
      const importance =
        importanceRoll < 0.1 ? "high" : importanceRoll < 0.4 ? "medium" : "low";

      // 状态分布：danger 5%, warning 15%, normal 80%
      const statusRoll = Math.random();
      const status =
        statusRoll < 0.05 ? "danger" : statusRoll < 0.2 ? "warning" : "normal";

      const heading = randFloat(0, 360);
      const speed = randFloat(400, 950); // 400-950 km/h（民航巡航速度）
      const altitude = randFloat(6000, 12500); // 6000-12500米

      // 生成初始轨迹（最近 20-40 个历史点，沿当前航向反推）
      const historyLength = randInt(20, 40);
      const trajectory: [number, number][] = [];
      let curLng = lng;
      let curLat = lat;
      // 反推：每点假设间隔1分钟
      for (let h = 0; h < historyLength; h++) {
        trajectory.unshift([curLng, curLat]);
        const distKm = speed / 60; // 1分钟飞行距离
        const backHeading = (heading + 180) % 360;
        const dLat = distKm / 111;
        const dLng =
          (distKm / (111 * Math.cos((curLat * Math.PI) / 180))) *
          Math.sin((backHeading * Math.PI) / 180);
        curLat += dLat * Math.cos((backHeading * Math.PI) / 180);
        curLng += dLng;
      }

      const entity: Entity = {
        id: `ads-ac-${String(globalIndex).padStart(4, "0")}`,
        name: generateFlightName(globalIndex),
        type: "aircraft",
        coordinates: [parseFloat(lng.toFixed(4)), parseFloat(lat.toFixed(4))],
        importance,
        status,
        description: `ADS-B信号 | 航速:${speed.toFixed(0)}km/h | 航向:${Math.round(heading)}° | 高度:${Math.round(altitude)}m | 空域:${zone.name}`,
      };

      newStates.push({
        entity,
        heading,
        speed,
        altitude,
        trajectory,
        zoneIndex: zoneIdx,
      });
    }
  });

  aircraftStates = newStates;
  initialized = true;
  return exportAdsData();
}

// ==================== 导出数据 ====================
function exportAdsData(): { entities: Entity[]; trajectories: Trajectory[] } {
  const entities = aircraftStates.map((s) => s.entity);
  // 飞机轨迹（最近30个点，用于可视化）
  const trajectories: Trajectory[] = aircraftStates
    .filter((s) => s.trajectory.length >= 2)
    .map((s) => ({
      id: `traj-${s.entity.id}`,
      name: `${s.entity.name}_飞行轨迹`,
      type: "route",
      coordinates: s.trajectory.slice(-30),
      status: "realtime",
    }));
  return { entities, trajectories };
}

// ==================== 实时位置更新 ====================
/**
 * 更新所有飞机位置，模拟实时移动
 * @param dtSeconds 时间步长（秒），默认 3 秒
 * @returns 更新后的 entities 和 trajectories
 */
export function updateAdsPositions(dtSeconds: number = 1): {
  entities: Entity[];
  trajectories: Trajectory[];
} {
  if (!initialized || aircraftStates.length === 0) {
    initAdsAircrafts();
  }

  aircraftStates.forEach((ac) => {
    const zone = AIR_ZONES[ac.zoneIndex];
    const [lng, lat] = ac.entity.coordinates;

    // 计算移动距离（km）= 速度(km/h) * 时间(h)
    const dtHours = dtSeconds / 3600;
    const distanceKm = ac.speed * dtHours;

    // 计算新位置
    const rad = (ac.heading * Math.PI) / 180;
    const dLat = (distanceKm * Math.cos(rad)) / 111;
    const dLng =
      (distanceKm * Math.sin(rad)) / (111 * Math.cos((lat * Math.PI) / 180));

    let newLat = lat + dLat;
    let newLng = lng + dLng;

    // 边界检测与转向：如果靠近空域边缘，随机微调航向（模拟航线转弯）
    const margin = 0.5; // 边缘缓冲（度）
    let headingChanged = false;

    if (newLat < zone.minLat + margin || newLat > zone.maxLat - margin) {
      ac.heading = randFloat(0, 360);
      headingChanged = true;
    }
    if (newLng < zone.minLng + margin || newLng > zone.maxLng - margin) {
      ac.heading = randFloat(0, 360);
      headingChanged = true;
    }

    // 如果航向改变了，重新计算
    if (headingChanged) {
      const rad2 = (ac.heading * Math.PI) / 180;
      const dLat2 = (distanceKm * Math.cos(rad2)) / 111;
      const dLng2 =
        (distanceKm * Math.sin(rad2)) / (111 * Math.cos((lat * Math.PI) / 180));
      newLat = lat + dLat2;
      newLng = lng + dLng2;
    }

    // 偶尔随机改变航向（模拟空中转向/绕飞）
    if (Math.random() < 0.01) {
      ac.heading = (ac.heading + randFloat(-20, 20)) % 360;
      if (ac.heading < 0) ac.heading += 360;
    }

    // 偶尔微调速度（模拟爬升/下降阶段的调速）
    if (Math.random() < 0.03) {
      ac.speed = Math.max(350, Math.min(1000, ac.speed + randFloat(-30, 30)));
    }

    // 偶尔微调高度
    if (Math.random() < 0.02) {
      ac.altitude = Math.max(
        3000,
        Math.min(13000, ac.altitude + randFloat(-200, 200)),
      );
    }

    // 确保仍在空域内
    newLat = Math.max(zone.minLat, Math.min(zone.maxLat, newLat));
    newLng = Math.max(zone.minLng, Math.min(zone.maxLng, newLng));

    // 更新实体坐标
    ac.entity.coordinates = [
      parseFloat(newLng.toFixed(4)),
      parseFloat(newLat.toFixed(4)),
    ];
    ac.entity.description = `ADS-B信号 | 航速:${ac.speed.toFixed(0)}km/h | 航向:${Math.round(ac.heading)}° | 高度:${Math.round(ac.altitude)}m | 空域:${zone.name}`;

    // 更新轨迹（保留最近 50 个点）
    ac.trajectory.push([
      parseFloat(newLng.toFixed(4)),
      parseFloat(newLat.toFixed(4)),
    ]);
    if (ac.trajectory.length > 50) {
      ac.trajectory.shift();
    }
  });

  return exportAdsData();
}

// ==================== 获取当前数据（不更新位置） ====================
export function getAdsData(): {
  entities: Entity[];
  trajectories: Trajectory[];
} {
  if (!initialized || aircraftStates.length === 0) {
    return initAdsAircrafts();
  }
  return exportAdsData();
}

// ==================== 获取飞机额外状态（用于渲染） ====================
export interface AircraftRenderState {
  id: string;
  heading: number;
  altitude: number;
  speed: number;
}

export function getAdsRenderStates(): AircraftRenderState[] {
  return aircraftStates.map((s) => ({
    id: s.entity.id,
    heading: s.heading,
    altitude: s.altitude,
    speed: s.speed,
  }));
}

// ==================== 统计信息 ====================
export function getAdsStats() {
  if (!initialized) return { count: 0, byStatus: {}, byImportance: {} };
  const byStatus: Record<string, number> = {};
  const byImportance: Record<string, number> = {};
  aircraftStates.forEach((s) => {
    byStatus[s.entity.status] = (byStatus[s.entity.status] || 0) + 1;
    byImportance[s.entity.importance] =
      (byImportance[s.entity.importance] || 0) + 1;
  });
  return {
    count: aircraftStates.length,
    byStatus,
    byImportance,
  };
}
