import type { Entity } from '@/types/prd';

/** 与 GisViewer 图层 id 对齐（含事件 / 高密度虚拟点位） */
export type MapDrawLayerId = 'ads' | 'ais' | 'base' | 'event' | 'dense';

/** 框选范围内点位按图层分组（仅面、矩形回调中带此字段） */
export type MapDrawEntitiesByLayer = {
  ads: Entity[];
  ais: Entity[];
  base: Entity[];
  event: Array<{ entity: Entity; eventId: string }>;
  dense: Entity[];
};

export type MapDrawMode = 'none' | 'point' | 'polyline' | 'polygon' | 'rectangle';

export type MapDrawPointResult = {
  kind: 'point';
  lngLat: [number, number];
};

export type MapDrawPolylineResult = {
  kind: 'polyline';
  /** [lng, lat][]，至少 2 点 */
  coordinates: [number, number][];
};

export type MapDrawPolygonResult = {
  kind: 'polygon';
  /** 闭合环 [lng, lat][]，首尾不重复（至少 3 点） */
  coordinates: [number, number][];
  entitiesByLayer: MapDrawEntitiesByLayer;
};

export type MapDrawRectangleResult = {
  kind: 'rectangle';
  west: number;
  south: number;
  east: number;
  north: number;
  /** 四角 [lng, lat]，顺序 SW SE NE NW */
  corners: [number, number][];
  entitiesByLayer: MapDrawEntitiesByLayer;
};

export type MapDrawResult =
  | MapDrawPointResult
  | MapDrawPolylineResult
  | MapDrawPolygonResult
  | MapDrawRectangleResult;
