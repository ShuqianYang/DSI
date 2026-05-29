import type { Entity, Trajectory, Region } from '@/types/prd';

/** 示例 · 飞机图层（对应 GisViewer 图层 id：`ads`） */
export const demoLayerEntitiesAircraft: Entity[] = [
  {
    id: 'demo-air-001',
    name: '演示航班 PN-A01',
    type: 'aircraft',
    coordinates: [113.82, 22.63],
    importance: 'high',
    status: 'normal',
    description: '珠三角上空例行观测航线',
    speed: 780,
    heading: 92,
    altitude: 10600,
    dataSource: 'demo-layer',
  },
  {
    id: 'demo-air-002',
    name: '演示航班 PN-B07',
    type: 'aircraft',
    coordinates: [121.56, 31.22],
    importance: 'medium',
    status: 'warning',
    description: '终端区排序等待，高度调整中',
    speed: 260,
    heading: 178,
    altitude: 4200,
    dataSource: 'demo-layer',
  },
  {
    id: 'demo-air-003',
    name: '演示通航 DR-C12',
    type: 'aircraft',
    coordinates: [104.05, 30.58],
    importance: 'low',
    status: 'normal',
    description: '低空通航训练',
    speed: 185,
    heading: 315,
    altitude: 900,
    dataSource: 'demo-layer',
  },
];

/** 示例 · 船舶图层（对应 GisViewer 图层 id：`ais`） */
export const demoLayerEntitiesShip: Entity[] = [
  {
    id: 'demo-ship-001',
    name: '演示货轮 MV-HaiDao',
    type: 'ship',
    coordinates: [125.12, 30.45],
    importance: 'high',
    status: 'danger',
    description: '已进入演示警戒缓冲带，需值班席复核',
    speed: 14,
    heading: 228,
    dataSource: 'demo-layer',
  },
  {
    id: 'demo-ship-002',
    name: '演示滚装船 RF-Link',
    type: 'ship',
    coordinates: [118.92, 38.38],
    importance: 'medium',
    status: 'normal',
    description: '渤海航线正常航行',
    speed: 16,
    heading: 64,
    dataSource: 'demo-layer',
  },
  {
    id: 'demo-ship-003',
    name: '演示渔船 FC-W2026',
    type: 'ship',
    coordinates: [110.35, 20.05],
    importance: 'low',
    status: 'warning',
    description: '短时滞留敏感水域外侧',
    speed: 7,
    heading: 112,
    dataSource: 'demo-layer',
  },
];

/** 示例 · 基站图层（对应 GisViewer 图层 id：`base`） */
export const demoLayerEntitiesBase: Entity[] = [
  {
    id: 'demo-base-001',
    name: '演示岸基雷达站 R-East',
    type: 'base',
    coordinates: [122.08, 29.92],
    importance: 'high',
    status: 'normal',
    description: 'AIS/雷达融合站点',
    dataSource: 'demo-layer',
  },
  {
    id: 'demo-base-002',
    name: '演示通信枢纽 TX-Core',
    type: 'base',
    coordinates: [114.42, 23.11],
    importance: 'medium',
    status: 'normal',
    description: '卫星回传与边缘计算节点',
    dataSource: 'demo-layer',
  },
  {
    id: 'demo-base-003',
    name: '演示监测哨所 OP-North',
    type: 'base',
    coordinates: [116.95, 40.22],
    importance: 'low',
    status: 'warning',
    description: '链路抖动，已切换备份信道',
    dataSource: 'demo-layer',
  },
];

/** 合并后的实体列表（供 GisViewer `entities`） */
export const demoLayerEntities: Entity[] = [
  ...demoLayerEntitiesAircraft,
  ...demoLayerEntitiesShip,
  ...demoLayerEntitiesBase,
];

/** 示例 · 轨迹图层（对应 GisViewer 图层 id：`trajectory`） */
export const demoLayerTrajectories: Trajectory[] = [
  {
    id: 'demo-traj-air-route',
    name: '演示轨迹 · PN-A01 计划航迹',
    type: 'route',
    status: 'realtime',
    coordinates: [
      [112.5, 23.0],
      [113.1, 22.85],
      [113.82, 22.63],
      [114.4, 22.45],
    ],
    timestamps: [
      Date.now() - 3_600_000,
      Date.now() - 2_400_000,
      Date.now() - 1_200_000,
      Date.now() - 300_000,
    ],
  },
  {
    id: 'demo-traj-ship-route',
    name: '演示轨迹 · MV-HaiDao 尾迹',
    type: 'route',
    status: 'realtime',
    coordinates: [
      [125.65, 30.82],
      [125.42, 30.62],
      [125.12, 30.45],
    ],
  },
  {
    id: 'demo-traj-warning-corridor',
    name: '演示轨迹 · 告警走廊（warning）',
    type: 'warning',
    status: 'realtime',
    coordinates: [
      [110.0, 19.9],
      [110.35, 20.05],
      [110.72, 20.22],
    ],
  },
  {
    id: 'demo-traj-comm-link',
    name: '演示轨迹 · TX-Core 微波链路',
    type: 'communication',
    status: 'realtime',
    coordinates: [
      [113.9, 23.05],
      [114.42, 23.11],
      [114.95, 23.18],
    ],
  },
];

/** 示例 · 区域面（与图层开关无关，始终绘制） */
export const demoLayerRegions: Region[] = [
  {
    id: 'demo-region-control',
    name: '演示管控区 Alpha',
    type: 'control',
    coordinates: [
      [124.5, 30.2],
      [126.2, 30.2],
      [126.2, 31.4],
      [124.5, 31.4],
    ],
    rules: '演示数据：未授权目标禁止进入',
  },
  {
    id: 'demo-region-monitor',
    name: '演示监测带 Bravo',
    type: 'monitor',
    coordinates: [
      [112.0, 21.8],
      [114.5, 21.8],
      [114.5, 23.6],
      [112.0, 23.6],
    ],
    rules: '演示数据：高密度交通监视',
  },
  {
    id: 'demo-region-service',
    name: '演示服务区 Charlie',
    type: 'service',
    coordinates: [
      [118.0, 39.2],
      [119.6, 39.2],
      [119.6, 40.3],
      [118.0, 40.3],
    ],
    rules: '演示数据：补给与搜救协调',
  },
];

/**
 * 手动加载用 · 第二套图层数据（与默认套点位/轨迹/区域均不同，便于对比增量与拾取）
 */
export const demoLayerManualScenarioBEntities: Entity[] = [
  {
    id: 'demo-b-air-01',
    name: '手动场景 · 高原巡航',
    type: 'aircraft',
    coordinates: [101.65, 36.52],
    importance: 'medium',
    status: 'normal',
    description: '手动载入场景 B：航空器图层示例',
    speed: 620,
    heading: 270,
    altitude: 9200,
    dataSource: 'demo-manual-b',
    scenarioTag: 'manual-B',
  } as Entity,
  {
    id: 'demo-b-ship-01',
    name: '手动场景 · 内河驳船',
    type: 'ship',
    coordinates: [106.52, 29.58],
    importance: 'low',
    status: 'warning',
    description: '手动载入场景 B：船舶图层示例',
    speed: 9,
    heading: 33,
    dataSource: 'demo-manual-b',
    scenarioTag: 'manual-B',
  } as Entity,
  {
    id: 'demo-b-base-01',
    name: '手动场景 · 边疆中继站',
    type: 'base',
    coordinates: [96.45, 35.92],
    importance: 'high',
    status: 'normal',
    description: '手动载入场景 B：基站图层示例',
    dataSource: 'demo-manual-b',
    scenarioTag: 'manual-B',
  } as Entity,
];

export const demoLayerManualScenarioBTrajectories: Trajectory[] = [
  {
    id: 'demo-b-traj-01',
    name: '手动场景 B · 巡航折线',
    type: 'route',
    status: 'realtime',
    coordinates: [
      [102.0, 36.0],
      [101.65, 36.52],
      [101.2, 37.0],
    ],
  },
];

export const demoLayerManualScenarioBRegions: Region[] = [
  {
    id: 'demo-b-region-01',
    name: '手动场景 B · 临时监视区',
    type: 'monitor',
    coordinates: [
      [100.8, 35.8],
      [103.2, 35.8],
      [103.2, 37.2],
      [100.8, 37.2],
    ],
    rules: '手动载入：演示区域面切换',
  },
];
