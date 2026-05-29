import { Entity, Trajectory } from "@/types/prd";

// ==================== 海域定义 ====================
// 预定义的已知海域区块（lng, lat），确保生成的船只在海上而非陆地
const SEA_ZONES: {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
  name: string;
}[] = [
  // 渤海（纯海域，避开辽东半岛和山东半岛）
  { minLng: 118.0, maxLng: 121.0, minLat: 37.8, maxLat: 40.0, name: "渤海" },
  // 黄海
  { minLng: 121.0, maxLng: 126.0, minLat: 33.0, maxLat: 37.5, name: "黄海" },
  // 东海北部
  {
    minLng: 123.0,
    maxLng: 128.0,
    minLat: 28.0,
    maxLat: 32.0,
    name: "东海北部",
  },
  // 东海南部
  {
    minLng: 122.0,
    maxLng: 127.0,
    minLat: 24.0,
    maxLat: 28.0,
    name: "东海南部",
  },
  // 台湾海峡
  {
    minLng: 118.5,
    maxLng: 121.5,
    minLat: 22.5,
    maxLat: 25.0,
    name: "台湾海峡",
  },
  // 南海北部（广东外海，避开海南岛）
  {
    minLng: 112.0,
    maxLng: 118.0,
    minLat: 16.0,
    maxLat: 21.5,
    name: "南海北部",
  },
  // 南海南部（西沙-中沙附近开阔海域）
  {
    minLng: 111.0,
    maxLng: 116.0,
    minLat: 10.0,
    maxLat: 16.0,
    name: "南海南部",
  },
  // 北部湾
  { minLng: 106.0, maxLng: 111.0, minLat: 17.0, maxLat: 21.5, name: "北部湾" },
  // 日本海
  { minLng: 129.0, maxLng: 135.0, minLat: 34.0, maxLat: 38.0, name: "日本海" },
  // 菲律宾海（巴士海峡附近）
  {
    minLng: 125.0,
    maxLng: 130.0,
    minLat: 20.0,
    maxLat: 24.0,
    name: "菲律宾海",
  },
];

// ==================== 船舶名称词库 ====================
const SHIP_PREFIXES = [
  "货轮",
  "集装箱船",
  "油轮",
  "LNG船",
  "散货船",
  "渔船",
  "科考船",
  "巡逻艇",
  "护卫舰",
  "补给舰",
  "破冰船",
  "滚装船",
  "邮轮",
];
const SHIP_CODES = [
  "HHXC",
  "YHXY",
  "DLHY",
  "JHY",
  "BH",
  "QDH",
  "XM",
  "ZHS",
  "SY",
  "NJ",
  "TK",
  "LY",
  "XM",
  "FS",
  "HZ",
  "NB",
  "WZ",
  "TZ",
  "WX",
  "CS",
  "HEB",
  "CC",
  "KM",
  "NN",
  "GY",
  "LZ",
  "XN",
  "YC",
  "XZ",
  "HF",
  "NT",
  "YZ",
  "ZJ",
  "CZ",
  "JX",
  "SX",
  "JH",
  "QU",
  "LS",
  "ZS",
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
  return `${prefix}_${code}_${num}`;
}

// ==================== 内部状态 ====================
interface ShipState {
  entity: Entity;
  heading: number; // 航向，0-360度，0=北，90=东
  speed: number; // 航速，节（knots）
  trajectory: [number, number][];
  zoneIndex: number; // 所属海域
}

let shipStates: ShipState[] = [];
let initialized = false;

// ==================== 初始化 300+ 船舶 ====================
export function initAisShips(count: number = 320): {
  entities: Entity[];
  trajectories: Trajectory[];
} {
  if (initialized && shipStates.length >= count) {
    return exportAisData();
  }

  const shipsPerZone = Math.floor(count / SEA_ZONES.length);
  const extra = count - shipsPerZone * SEA_ZONES.length;

  const newStates: ShipState[] = [];

  SEA_ZONES.forEach((zone, zoneIdx) => {
    const zoneCount = shipsPerZone + (zoneIdx < extra ? 1 : 0);
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
      const speed = randFloat(2, 28); // 2-28节

      // 生成初始轨迹（最近 20-40 个历史点，沿当前航向反推）
      const historyLength = randInt(20, 40);
      const trajectory: [number, number][] = [];
      let curLng = lng;
      let curLat = lat;
      for (let h = 0; h < historyLength; h++) {
        trajectory.unshift([curLng, curLat]);
        // 反推：减去移动量
        const dist = (speed * 60) / 3600; // 每小时采样一次，假设每个点间隔1小时
        const backHeading = (heading + 180) % 360;
        const dLat = (dist * Math.cos((backHeading * Math.PI) / 180)) / 60;
        const dLng =
          (dist * Math.sin((backHeading * Math.PI) / 180)) /
          (60 * Math.cos((curLat * Math.PI) / 180));
        curLat += dLat;
        curLng += dLng;
      }

      const entity: Entity = {
        id: `ais-ship-${String(globalIndex).padStart(4, "0")}`,
        name: generateShipName(globalIndex),
        type: "ship",
        coordinates: [parseFloat(lng.toFixed(6)), parseFloat(lat.toFixed(6))],
        importance,
        status,
        heading,
        speed,
        description: `AIS实时信号 | 航速:${speed.toFixed(1)}节 | 航向:${Math.round(heading)}° | 海域:${zone.name}`,
      };

      newStates.push({
        entity,
        heading,
        speed,
        trajectory,
        zoneIndex: zoneIdx,
      });
    }
  });

  shipStates = newStates;
  initialized = true;
  return exportAisData();
}

// ==================== 导出数据 ====================
function exportAisData(): { entities: Entity[]; trajectories: Trajectory[] } {
  const entities = shipStates.map((s) => s.entity);
  const trajectories: Trajectory[] = shipStates
    .filter((s) => s.trajectory.length >= 2)
    .map((s) => ({
      id: `traj-${s.entity.id}`,
      name: `${s.entity.name}_航行轨迹`,
      type: 'route',
      coordinates: s.trajectory.slice(-30),
      status: 'realtime',
    }));
  return { entities, trajectories };
}

// ==================== 实时位置更新 ====================
/**
 * 更新所有船舶位置，模拟实时移动
 * @param dtSeconds 时间步长（秒），默认 5 秒
 * @returns 更新后的 entities 和 trajectories
 */
export function updateAisPositions(dtSeconds: number = 1): {
  entities: Entity[];
  trajectories: Trajectory[];
} {
  if (!initialized || shipStates.length === 0) {
    initAisShips();
  }

  shipStates.forEach((ship) => {
    const zone = SEA_ZONES[ship.zoneIndex];
    const [lng, lat] = ship.entity.coordinates;

    // 计算移动距离（海里）= 速度(节) * 时间(小时)
    // 使用 TIME_SCALE 放大时间步长，使移动在地球仪上肉眼可见
    const TIME_SCALE = 30;
    const dtHours = (dtSeconds * TIME_SCALE) / 3600;
    const distanceNm = ship.speed * dtHours;

    // 计算新位置
    const rad = (ship.heading * Math.PI) / 180;
    const dLat = (distanceNm * Math.cos(rad)) / 60;
    const dLng =
      (distanceNm * Math.sin(rad)) / (60 * Math.cos((lat * Math.PI) / 180));

    let newLat = lat + dLat;
    let newLng = lng + dLng;

    // 边界检测与转向：如果靠近海域边缘，随机微调航向
    const margin = 0.3; // 边缘缓冲（度）
    let headingChanged = false;

    if (newLat < zone.minLat + margin || newLat > zone.maxLat - margin) {
      ship.heading = randFloat(0, 360);
      headingChanged = true;
    }
    if (newLng < zone.minLng + margin || newLng > zone.maxLng - margin) {
      ship.heading = randFloat(0, 360);
      headingChanged = true;
    }

    // 如果航向改变了，重新计算
    if (headingChanged) {
      const rad2 = (ship.heading * Math.PI) / 180;
      const dLat2 = (distanceNm * Math.cos(rad2)) / 60;
      const dLng2 =
        (distanceNm * Math.sin(rad2)) / (60 * Math.cos((lat * Math.PI) / 180));
      newLat = lat + dLat2;
      newLng = lng + dLng2;
    }

    // 偶尔随机改变航向（模拟真实航行中的转向）
    if (Math.random() < 0.02) {
      ship.heading = (ship.heading + randFloat(-30, 30)) % 360;
      if (ship.heading < 0) ship.heading += 360;
    }

    // 偶尔微调速度
    if (Math.random() < 0.05) {
      ship.speed = Math.max(2, Math.min(28, ship.speed + randFloat(-2, 2)));
    }

    // 确保仍在海域内
    newLat = Math.max(zone.minLat, Math.min(zone.maxLat, newLat));
    newLng = Math.max(zone.minLng, Math.min(zone.maxLng, newLng));

    // 更新实体坐标
    ship.entity.coordinates = [
      parseFloat(newLng.toFixed(6)),
      parseFloat(newLat.toFixed(6)),
    ];
    ship.entity.heading = ship.heading;
    ship.entity.speed = ship.speed;
    ship.entity.description = `AIS实时信号 | 航速:${ship.speed.toFixed(1)}节 | 航向:${Math.round(ship.heading)}° | 海域:${zone.name}`;

    // 更新轨迹（保留最近 50 个点）
    ship.trajectory.push([
      parseFloat(newLng.toFixed(6)),
      parseFloat(newLat.toFixed(6)),
    ]);
    if (ship.trajectory.length > 50) {
      ship.trajectory.shift();
    }
  });

  return exportAisData();
}

// ==================== 获取当前数据（不更新位置） ====================
export function getAisData(): {
  entities: Entity[];
  trajectories: Trajectory[];
} {
  if (!initialized || shipStates.length === 0) {
    return initAisShips();
  }
  return exportAisData();
}

// ==================== 统计信息 ====================
export function getAisStats() {
  if (!initialized) return { count: 0, byStatus: {}, byImportance: {} };
  const byStatus: Record<string, number> = {};
  const byImportance: Record<string, number> = {};
  shipStates.forEach((s) => {
    byStatus[s.entity.status] = (byStatus[s.entity.status] || 0) + 1;
    byImportance[s.entity.importance] =
      (byImportance[s.entity.importance] || 0) + 1;
  });
  return {
    count: shipStates.length,
    byStatus,
    byImportance,
  };
}
