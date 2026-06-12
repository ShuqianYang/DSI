import { z } from "zod";
import { CameraView } from "./camera.js";

// ========== 核心 GIS 类型（前后端共享）==========

export const EntityType = z.enum(["ship", "aircraft", "base", "fire", "earthquake"]);
export type EntityType = z.infer<typeof EntityType>;

export const EntityStatus = z.enum(["normal", "warning", "danger"]);
export type EntityStatus = z.infer<typeof EntityStatus>;

export const EntityImportance = z.enum(["high", "medium", "low"]);
export type EntityImportance = z.infer<typeof EntityImportance>;

export const Entity = z.object({
  id: z.string(),
  name: z.string(),
  type: EntityType,
  coordinates: z.tuple([z.number(), z.number()]), // [lng, lat]
  importance: EntityImportance,
  status: EntityStatus,
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  speed: z.number().optional(),
  heading: z.number().optional(),
  altitude: z.number().optional(),
  dataSource: z.string().optional(), // 'aisstream' | 'mock' 等
  color: z.string().optional(),
  size: z.number().optional(),
});
export type Entity = z.infer<typeof Entity>;

export const TrajectoryType = z.enum(["route", "communication", "warning"]);
export type TrajectoryType = z.infer<typeof TrajectoryType>;

export const TrajectoryStatus = z.enum(["realtime", "history"]);
export type TrajectoryStatus = z.infer<typeof TrajectoryStatus>;

export const Trajectory = z.object({
  id: z.string(),
  name: z.string(),
  type: TrajectoryType,
  coordinates: z.array(z.tuple([z.number(), z.number()])), // [lng, lat][]
  timestamps: z.array(z.number()).optional(),
  status: TrajectoryStatus,
});
export type Trajectory = z.infer<typeof Trajectory>;

export const RegionType = z.enum(["control", "monitor", "service"]);
export type RegionType = z.infer<typeof RegionType>;

export const RegionStyle = z.object({
  fill: z.boolean().optional(),
  fillColor: z.string().optional(),
  outlineColor: z.string().optional(),
  outlineWidth: z.number().optional(),
  /** 红色光墙边界（2D 地面光晕 + 3D 立体光墙） */
  effect: z.enum(["lightWall"]).optional(),
});
export type RegionStyle = z.infer<typeof RegionStyle>;

export const RegionLabel = z.object({
  text: z.string(),
  position: z.tuple([z.number(), z.number()]).optional(),
});
export type RegionLabel = z.infer<typeof RegionLabel>;

export const Region = z.object({
  id: z.string(),
  name: z.string(),
  type: RegionType,
  coordinates: z.array(z.tuple([z.number(), z.number()])),
  rules: z.string().optional(),
  style: RegionStyle.optional(),
  label: RegionLabel.optional(),
});
export type Region = z.infer<typeof Region>;

export const ImageOverlay = z.object({
  id: z.string(),
  url: z.string(),
  rectangle: z.object({
    west: z.number(),
    south: z.number(),
    east: z.number(),
    north: z.number(),
  }),
  alpha: z.number().optional(),
  tileWidth: z.number().optional(),
  tileHeight: z.number().optional(),
  /** 图片覆盖层边框颜色（hex 字符串，如 '#00E0FF'） */
  outlineColor: z.string().optional(),
});
export type ImageOverlay = z.infer<typeof ImageOverlay>;

// 风场（10×10 网格 u/v 分量，给 Cesium 粒子层使用；详见 api/plan/wind-particle-layer.md）
export const WindField = z.object({
  bbox: z.object({
    west: z.number(),
    south: z.number(),
    east: z.number(),
    north: z.number(),
  }),
  grid: z.object({
    rows: z.number().int(),
    cols: z.number().int(),
  }),
  u: z.array(z.number()),       // east-west 分量，length = rows*cols（row-major）
  v: z.array(z.number()),       // north-south 分量
  speed: z.array(z.number()),   // m/s，可选展示用
  timestamp: z.string().optional(),
  source: z.enum(["open-meteo", "mock-fallback"]),
});
export type WindField = z.infer<typeof WindField>;

export const GisData = z.object({
  type: z.enum(["entity", "trajectory", "region", "image", "wind-field"]),
  coordinates: z.tuple([z.number(), z.number()]).optional(),
  entities: z.array(Entity).optional(),
  trajectories: z.array(Trajectory).optional(),
  regions: z.array(Region).optional(),
  imageOverlays: z.array(ImageOverlay).optional(),
  windField: WindField.optional(),
  // 镜头视角声明：capability 显式指定 flyTo 目标；前端 auto-flyTo 优先使用此字段
  cameraView: CameraView.optional(),
  eventId: z.string().optional(),
  eventName: z.string().optional(),
  /**
   * 震中/临时高亮持续时间（毫秒）。
   * 到期后仅移除 transientRegionIds / transientEntityIds，不删除评估区光墙。
   */
  highlightDurationMs: z.number().int().positive().optional(),
  /** 与高亮时长配合：到期后移除的区域 id */
  transientRegionIds: z.array(z.string()).optional(),
  /** 与高亮时长配合：到期后移除的实体 id */
  transientEntityIds: z.array(z.string()).optional(),
});
export type GisData = z.infer<typeof GisData>;

// ========== 海事专用类型 ==========

export const MaritimeEntityStatus = z.enum(["normal", "warning", "danger"]);
export type MaritimeEntityStatus = z.infer<typeof MaritimeEntityStatus>;

export const MaritimeRiskLevel = z.enum(["low", "medium", "high"]);
export type MaritimeRiskLevel = z.infer<typeof MaritimeRiskLevel>;

export const MaritimeVessel = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  lat: z.number(),
  lng: z.number(),
  speed: z.number(),
  heading: z.number(),
  status: MaritimeEntityStatus,
  riskLevel: MaritimeRiskLevel,
  reason: z.string().optional(),
});
export type MaritimeVessel = z.infer<typeof MaritimeVessel>;

export const MaritimeAircraft = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  lat: z.number(),
  lng: z.number(),
  altitude: z.number(),
  speed: z.number(),
  heading: z.number(),
  status: MaritimeEntityStatus,
  riskLevel: MaritimeRiskLevel,
  reason: z.string().optional(),
});
export type MaritimeAircraft = z.infer<typeof MaritimeAircraft>;

export const MaritimeSummary = z.object({
  totalVessels: z.number(),
  totalAircrafts: z.number(),
  normalCount: z.number(),
  warningCount: z.number(),
  dangerCount: z.number(),
  riskAssessment: z.string(),
});
export type MaritimeSummary = z.infer<typeof MaritimeSummary>;

// ========== 转换函数 ==========

export function toSharedEntity(vessel: MaritimeVessel): Entity;
export function toSharedEntity(aircraft: MaritimeAircraft): Entity;
export function toSharedEntity(v: MaritimeVessel | MaritimeAircraft): Entity {
  const isAircraft = "altitude" in v && v.altitude !== undefined;
  return {
    id: v.id,
    name: v.name,
    type: isAircraft ? "aircraft" : "ship",
    coordinates: [v.lng, v.lat],
    importance: v.riskLevel === "high" ? "high" : v.riskLevel === "medium" ? "medium" : "low",
    status: v.status,
    description: isAircraft
      ? `${v.name} | 航速: ${v.speed}km/h | 航向: ${v.heading}° | 高度: ${v.altitude}m | ${v.reason || ""}`
      : `${v.name} | 航速: ${v.speed}节 | 航向: ${v.heading}° | ${v.reason || ""}`,
    speed: v.speed,
    heading: v.heading,
    altitude: isAircraft ? v.altitude : undefined,
  };
}

export function toSharedTrajectory(
  id: string,
  name: string,
  points: Array<{ lat: number; lng: number }>,
  type: TrajectoryType = "route",
  status: TrajectoryStatus = "realtime"
): Trajectory {
  return {
    id,
    name,
    type,
    coordinates: points.map((p) => [p.lng, p.lat]),
    status,
  };
}

export function vesselsToSharedEntities(vessels: MaritimeVessel[]): Entity[] {
  return vessels.map(toSharedEntity);
}

export function aircraftsToSharedEntities(aircrafts: MaritimeAircraft[]): Entity[] {
  return aircrafts.map(toSharedEntity);
}
