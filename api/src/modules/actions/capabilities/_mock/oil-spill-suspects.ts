// 共享 mock 数据：东海油污溯源场景的 5 艘候选船 + 嫌疑评分
// 三个 capability 共享：ais-fetch（subtask-5）/ ais-match-suspects（subtask-6）/ ais-suspect-ranking（subtask-7）
// 数据源：api/plan/oil-spill-mock-data.md
// 数字故事化：vesselCount=157、recordCount=2863 与 oil-detector.md 剧本一致；vessels[] 真实只有 5 艘

export const POLLUTION_ORIGIN: [number, number] = [123.0375, 30.2761];

// 故事化数字（事件卡片 markdown 显示）
export const TOTAL_VESSEL_COUNT = 157;
export const TOTAL_RECORD_COUNT = 2863;

// ==================== 船舶基础画像 ====================
export interface SuspectVessel {
  mmsi: string;
  name: string;
  type: "货轮" | "集装箱船" | "散货船" | "成品油轮" | "远洋渔船";
  flag: "CN" | "JP" | "KR" | "PA";
  length: number;
  width: number;
  dwt?: number;
  callSign: string;
  imo?: string;
}

export const SUSPECT_VESSELS: SuspectVessel[] = [
  {
    mmsi: "413567890",
    name: "远洋货轮01",
    type: "货轮",
    flag: "CN",
    length: 180,
    width: 28,
    dwt: 35000,
    callSign: "BVZQ7",
    imo: "9456789",
  },
  {
    mmsi: "431758432",
    name: "KOBE STAR",
    type: "集装箱船",
    flag: "JP",
    length: 260,
    width: 32,
    dwt: 50000,
    callSign: "7JFA",
    imo: "9712345",
  },
  {
    mmsi: "440912756",
    name: "DAEYANG VICTORY",
    type: "散货船",
    flag: "KR",
    length: 220,
    width: 32,
    dwt: 60000,
    callSign: "DSVT7",
    imo: "9645234",
  },
  {
    mmsi: "357654321",
    name: "OCEAN PEARL",
    type: "成品油轮",
    flag: "PA",
    length: 185,
    width: 27,
    dwt: 40000,
    callSign: "3FQH8",
    imo: "9523456",
  },
  {
    mmsi: "412987654",
    name: "浙象渔18866",
    type: "远洋渔船",
    flag: "CN",
    length: 38,
    width: 7,
    callSign: "BX18866",
  },
];

// ==================== 5 艘船 10 点轨迹 ====================
export interface TrajectoryPoint {
  coord: [number, number]; // [lng, lat]
  hoursAgo: number; // 距 "now" 的小时数（capability 实施时计算 ISO 时间戳）
  speedKn: number; // 节
  heading: number; // 0-360°
}

export const SUSPECT_TRAJECTORIES: Record<string, TrajectoryPoint[]> = {
  // 1. 远洋货轮01 - 首要嫌疑：异常绕路 + 22 min 停留 + 加速离开
  "413567890": [
    { coord: [122.2, 30.3], hoursAgo: 72, speedKn: 14, heading: 95 },
    { coord: [122.55, 30.32], hoursAgo: 60, speedKn: 13, heading: 90 },
    { coord: [122.85, 30.3], hoursAgo: 48, speedKn: 13, heading: 95 },
    { coord: [122.98, 30.29], hoursAgo: 40, speedKn: 12, heading: 80 },
    { coord: [123.035, 30.275], hoursAgo: 36.2, speedKn: 4, heading: 45 },
    { coord: [123.0375, 30.2761], hoursAgo: 35.8, speedKn: 1, heading: 0 },
    { coord: [123.0392, 30.2775], hoursAgo: 35.5, speedKn: 1, heading: 30 },
    { coord: [123.06, 30.3], hoursAgo: 34.6, speedKn: 16, heading: 60 },
    { coord: [123.4, 30.5], hoursAgo: 24, speedKn: 15, heading: 65 },
    { coord: [124.1, 30.95], hoursAgo: 8, speedKn: 14, heading: 70 },
  ],
  // 2. KOBE STAR - 次要：减速 15 min 经过，无异动
  "431758432": [
    { coord: [121.55, 31.3], hoursAgo: 68, speedKn: 15, heading: 100 },
    { coord: [122.1, 30.95], hoursAgo: 58, speedKn: 16, heading: 105 },
    { coord: [122.6, 30.65], hoursAgo: 46, speedKn: 16, heading: 110 },
    { coord: [122.95, 30.4], hoursAgo: 38, speedKn: 14, heading: 115 },
    { coord: [123.03, 30.29], hoursAgo: 36.5, speedKn: 8, heading: 100 },
    { coord: [123.035, 30.278], hoursAgo: 36.0, speedKn: 5, heading: 95 },
    { coord: [123.039, 30.27], hoursAgo: 35.7, speedKn: 6, heading: 90 },
    { coord: [123.12, 30.18], hoursAgo: 34.5, speedKn: 15, heading: 110 },
    { coord: [124.5, 29.5], hoursAgo: 20, speedKn: 16, heading: 115 },
    { coord: [126.8, 29.2], hoursAgo: 6, speedKn: 16, heading: 120 },
  ],
  // 3. DAEYANG VICTORY - 次要：反复转向 18 min
  "440912756": [
    { coord: [127.5, 33.8], hoursAgo: 70, speedKn: 14, heading: 240 },
    { coord: [126.2, 32.5], hoursAgo: 60, speedKn: 14, heading: 235 },
    { coord: [124.8, 31.2], hoursAgo: 48, speedKn: 14, heading: 240 },
    { coord: [123.5, 30.5], hoursAgo: 40, speedKn: 13, heading: 245 },
    { coord: [123.1, 30.3], hoursAgo: 37, speedKn: 10, heading: 250 },
    { coord: [123.042, 30.28], hoursAgo: 36.3, speedKn: 6, heading: 270 },
    { coord: [123.04, 30.272], hoursAgo: 36.0, speedKn: 2, heading: 320 },
    { coord: [123.038, 30.276], hoursAgo: 35.7, speedKn: 3, heading: 200 },
    { coord: [122.5, 30.1], hoursAgo: 20, speedKn: 14, heading: 240 },
    { coord: [121.8, 31.1], hoursAgo: 6, speedKn: 13, heading: 270 },
  ],
  // 4. OCEAN PEARL - 次要：AIS 信号断 5 min（剧情亮点）
  "357654321": [
    { coord: [121.8, 28.5], hoursAgo: 68, speedKn: 13, heading: 60 },
    { coord: [122.3, 29.2], hoursAgo: 58, speedKn: 13, heading: 50 },
    { coord: [122.8, 29.8], hoursAgo: 46, speedKn: 12, heading: 45 },
    { coord: [123.0, 30.2], hoursAgo: 38, speedKn: 11, heading: 40 },
    { coord: [123.045, 30.275], hoursAgo: 36.5, speedKn: 7, heading: 30 },
    // ★ AIS 信号断点：T-36.4h ~ T-36.32h，约 5 min 无报文
    { coord: [123.041, 30.272], hoursAgo: 36.25, speedKn: 4, heading: 350 },
    { coord: [123.038, 30.275], hoursAgo: 36.05, speedKn: 5, heading: 0 },
    { coord: [123.025, 30.29], hoursAgo: 35.75, speedKn: 9, heading: 340 },
    { coord: [122.85, 30.95], hoursAgo: 24, speedKn: 12, heading: 320 },
    { coord: [122.2, 31.85], hoursAgo: 8, speedKn: 12, heading: 320 },
  ],
  // 5. 浙象渔18866 - 一般嫌疑（清白对照）：自然过路 8 min
  "412987654": [
    { coord: [122.5, 30.1], hoursAgo: 70, speedKn: 6, heading: 80 },
    { coord: [122.75, 30.15], hoursAgo: 60, speedKn: 5, heading: 70 },
    { coord: [122.95, 30.22], hoursAgo: 48, speedKn: 4, heading: 60 },
    { coord: [123.05, 30.28], hoursAgo: 40, speedKn: 5, heading: 50 },
    { coord: [123.03, 30.272], hoursAgo: 36.5, speedKn: 7, heading: 90 },
    { coord: [123.043, 30.272], hoursAgo: 36.37, speedKn: 7, heading: 90 },
    { coord: [123.1, 30.25], hoursAgo: 36.0, speedKn: 8, heading: 100 },
    { coord: [123.3, 30.1], hoursAgo: 24, speedKn: 6, heading: 130 },
    { coord: [123.55, 29.8], hoursAgo: 12, speedKn: 7, heading: 150 },
    { coord: [123.7, 29.5], hoursAgo: 4, speedKn: 6, heading: 170 },
  ],
};

// ==================== 5 艘船匹配信息 ====================
// subtask-6 ais-match-suspects 用
export interface MatchInfo {
  mmsi: string;
  matchedAt: [number, number];
  stayDurationMin: number;
  closestDistanceM: number;
  aisGapMin: number;
}

export const MATCH_INFOS: MatchInfo[] = [
  {
    mmsi: "413567890",
    matchedAt: [123.0375, 30.2761],
    stayDurationMin: 22,
    closestDistanceM: 80,
    aisGapMin: 0,
  },
  {
    mmsi: "431758432",
    matchedAt: [123.035, 30.278],
    stayDurationMin: 15,
    closestDistanceM: 240,
    aisGapMin: 0,
  },
  {
    mmsi: "440912756",
    matchedAt: [123.04, 30.272],
    stayDurationMin: 18,
    closestDistanceM: 320,
    aisGapMin: 0,
  },
  {
    mmsi: "357654321",
    matchedAt: [123.041, 30.272],
    stayDurationMin: 12,
    closestDistanceM: 450,
    aisGapMin: 5,
  },
  {
    mmsi: "412987654",
    matchedAt: [123.043, 30.272],
    stayDurationMin: 8,
    closestDistanceM: 850,
    aisGapMin: 0,
  },
];

// ==================== 5 艘船嫌疑排名 ====================
// subtask-7 ais-suspect-ranking 用
export type SuspectLevel = "primary" | "secondary" | "normal";

export interface RankingBreakdown {
  mmsi: string;
  score: number;
  rank: number;
  level: SuspectLevel;
  breakdown: { distance: number; stay: number; behavior: number };
  reasons: string;
}

export const RANKING_BREAKDOWN: RankingBreakdown[] = [
  {
    mmsi: "413567890",
    score: 86,
    rank: 1,
    level: "primary",
    breakdown: { distance: 40, stay: 30, behavior: 16 },
    reasons:
      "距排污原点 80m（最近，40分）| 异常停留 22 分钟（30分）| 航线绕路偏离常规东海航道（16分）",
  },
  {
    mmsi: "431758432",
    score: 72,
    rank: 2,
    level: "secondary",
    breakdown: { distance: 30, stay: 22, behavior: 20 },
    reasons: "距原点 240m（30分）| 停留 15 分钟（22分）| 减速但无明显异动（20分）",
  },
  {
    mmsi: "440912756",
    score: 68,
    rank: 3,
    level: "secondary",
    breakdown: { distance: 20, stay: 22, behavior: 26 },
    reasons: "距原点 320m（20分）| 停留 18 分钟（22分）| 反复转向（26分）",
  },
  {
    mmsi: "357654321",
    score: 65,
    rank: 4,
    level: "secondary",
    breakdown: { distance: 20, stay: 15, behavior: 30 },
    reasons:
      "距原点 450m（20分）| 停留 12 分钟（15分）| AIS 信号断 5 分钟（30分，权宜旗+断点重点关注）",
  },
  {
    mmsi: "412987654",
    score: 45,
    rank: 5,
    level: "normal",
    breakdown: { distance: 10, stay: 8, behavior: 27 },
    reasons:
      "距原点 850m（10分）| 短停 8 分钟（8分）| 航迹自然无异动（27分）— 判定为正常过路渔船",
  },
];

// ==================== 辅助函数：根据 mmsi 拿数据 ====================
export function getVessel(mmsi: string): SuspectVessel | undefined {
  return SUSPECT_VESSELS.find((v) => v.mmsi === mmsi);
}

export function getMatch(mmsi: string): MatchInfo | undefined {
  return MATCH_INFOS.find((m) => m.mmsi === mmsi);
}

export function getRanking(mmsi: string): RankingBreakdown | undefined {
  return RANKING_BREAKDOWN.find((r) => r.mmsi === mmsi);
}
