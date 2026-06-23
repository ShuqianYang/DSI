// Kensai 火灾演示固定数据（哈萨克斯坦，76.998°E, 43.2635°N）

export const FIRE_CENTER_LNG = 76.998;
export const FIRE_CENTER_LAT = 43.2635;

export const FIRE_RECT = {
  west: 76.967,
  south: 43.241,
  east: 77.029,
  north: 43.286,
} as const;

export const FIRE_BOUNDS = [
  [FIRE_RECT.west, FIRE_RECT.south],
  [FIRE_RECT.east, FIRE_RECT.south],
  [FIRE_RECT.east, FIRE_RECT.north],
  [FIRE_RECT.west, FIRE_RECT.north],
  [FIRE_RECT.west, FIRE_RECT.south],
] as [number, number][];

export const BURNED_AREA_HECTARES = 1200;
export const FIRE_TYPE = "草原/灌木火灾";
export const CONFIDENCE = "high";

export const OVERLAY_META = {
  postFireImageUrl: "/local-tiles/fire.png",
  rectangle: { ...FIRE_RECT },
};

export interface FireAssessment {
  burnedAreaHectares: number;
  fireIntensity: "medium" | "high" | "extreme";
  spreadDirection: string;
  spreadSpeedKmH: number;
  windSpeedMs: number;
  windDirection: string;
  affectedObjects: string[];
  riskLevel: "high" | "medium" | "low";
}

export const FIRE_ASSESSMENT: FireAssessment = {
  burnedAreaHectares: BURNED_AREA_HECTARES,
  fireIntensity: "high",
  spreadDirection: "东北-西南向",
  spreadSpeedKmH: 3.5,
  windSpeedMs: 5.2,
  windDirection: "东北风",
  affectedObjects: ["草原植被", "灌木丛", "边境围栏", "简易道路"],
  riskLevel: "high",
};
