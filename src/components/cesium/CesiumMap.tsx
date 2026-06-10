'use client';

import {
  useRef,
  useEffect,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
  useState,
} from 'react';
import * as Cesium from 'cesium';
import { Entity, Trajectory, Region, GisData } from '@/types/prd';
import { getStyleById } from './ImageryManager';
import { createLocalImageryProvider, getLocalConfigById } from './LocalTileProvider';
import { createFireOverlayProvider, createFireMaskProvider, getFireRectangle } from './FireOverlay';
import { collectFireGroundSpecs, syncFireGroundPulseRings } from './fireGroundEffect';
import { collectEpicenterGroundSpecs, syncEpicenterGroundPulseRings } from './earthquakeGroundEffect';
import {
  collectOilSpillDiffusionSpecs,
  syncOilSpillDiffusionPlumes,
} from './oilSpillDiffusionEffect';
import { isRegionLightWall, syncRegionLightWall } from './regionLightWall';
import { billboardGlowSvgDataUri } from './billboardGlowSvg';
import type { MapDrawMode, MapDrawResult } from '@/types/mapDraw';
import { attachMapDrawTool } from './mapDrawTool';
import { addPersistedMapDraw } from './mapDrawPersisted';
import {
  createPolylineFlowMaterialProperty,
  polylineFlowOptionsKey,
  type PolylineFlowMaterialOptions,
} from './polylineFlowMaterial';

export type { MapDrawMode, MapDrawResult, MapDrawEntitiesByLayer } from '@/types/mapDraw';

// 事件颜色池
const EVENT_COLORS = ['#FF44FF', '#00E0FF', '#FFAA00', '#44FF44', '#FFFF44', '#FF4444'];

/** 轨迹虚线 dash 长度（屏幕像素量级，与 PolylineDashMaterialProperty 一致） */
const TRAJECTORY_DASH_LENGTH_PX = 16;
const TRAJECTORY_BASE_LINE_WIDTH = 8;
const TRAJECTORY_EVENT_LINE_WIDTH = 12;
/** 油污 AIS / 漂移路径流动线宽 */
const TRAJECTORY_FLOW_LINE_WIDTH = 10;
/** 油污漂移路径与扩散脉冲统一褐色 */
const OIL_SPILL_BROWN_HEX = '#8B5A14';
/** 贴地轨迹叠放顺序：流动 AIS 线置于其它地面几何之上 */
const TRAJECTORY_FLOW_Z_INDEX = 2500;
const FLOW_ARROW_TEXTURE_URL = '/textures/flow-arrow-small.png';

function trajectoryCartesiansFromCoords(coords: [number, number][]): Cesium.Cartesian3[] {
  return coords.map(([lng, lat]) => Cesium.Cartesian3.fromDegrees(lng, lat, 0));
}

type TrajectoryPolylineSyncRow = {
  id: string;
  positions: Cesium.Cartesian3[];
  width: number;
  color: Cesium.Color;
  /** 流动箭头材质；方向沿 positions 从首点到末点 */
  flow?: PolylineFlowMaterialOptions;
};

function positionsEqual(a: Cesium.Cartesian3[], b: Cesium.Cartesian3[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Cesium.Cartesian3.equals(a[i], b[i])) return false;
  }
  return true;
}

type TrajectoryCache = {
  positions: Cesium.Cartesian3[];
  width: number;
  color: Cesium.Color;
  materialKey: string;
  zIndex: number;
};

function trajectoryPolylineMaterial(row: TrajectoryPolylineSyncRow): Cesium.MaterialProperty {
  if (row.flow) {
    return createPolylineFlowMaterialProperty(row.flow);
  }
  return new Cesium.PolylineArrowMaterialProperty(row.color);
}

function trajectoryMaterialKey(row: TrajectoryPolylineSyncRow): string {
  if (row.flow) return `flow:${polylineFlowOptionsKey(row.flow)}`;
  return `arrow:${row.color.toCssHexString()}`;
}

function trajectoryPolylineZIndex(row: TrajectoryPolylineSyncRow): number {
  return row.flow ? TRAJECTORY_FLOW_Z_INDEX : 0;
}

function buildTrajectoryPolyline(row: TrajectoryPolylineSyncRow) {
  const polyline: Cesium.PolylineGraphics.ConstructorOptions = {
    positions: new Cesium.ConstantProperty(row.positions),
    width: row.width,
    material: trajectoryPolylineMaterial(row),
    arcType: Cesium.ArcType.GEODESIC,
    clampToGround: true,
  };
  const zIndex = trajectoryPolylineZIndex(row);
  if (zIndex > 0) {
    polyline.zIndex = zIndex;
  }
  return {
    id: String(row.id),
    polyline,
  };
}

/**
 * 轨迹 polyline 增量同步：避免每次 removeAll 整层重建造成闪烁。
 * 贴地大地线；AIS 油污轨迹使用流动箭头材质，其余为箭头材质。
 */
function syncTrajectoryPolylineEntities(
  collection: Cesium.EntityCollection,
  rows: TrajectoryPolylineSyncRow[]
) {
  const desiredIds = new Set(rows.map((r) => String(r.id)));

  collection.suspendEvents();
  try {
    for (const e of [...collection.values]) {
      const id = String(e.id);
      if (!desiredIds.has(id)) {
        collection.removeById(id);
      }
    }

    for (const row of rows) {
      const entityId = String(row.id);
      const existing = collection.getById(entityId);
      const nextMaterialKey = trajectoryMaterialKey(row);

      if (!existing) {
        collection.add(buildTrajectoryPolyline(row));
        continue;
      }

      if (!existing.polyline) {
        collection.removeById(entityId);
        collection.add(buildTrajectoryPolyline(row));
        continue;
      }

      const cache = (existing as unknown as { _syncCache?: TrajectoryCache })._syncCache;
      const pl = existing.polyline;

      if (!cache || !positionsEqual(cache.positions, row.positions)) {
        pl.positions = new Cesium.ConstantProperty(row.positions);
      }
      if (!cache || cache.width !== row.width) {
        pl.width = new Cesium.ConstantProperty(row.width);
      }
      if (!cache || cache.materialKey !== nextMaterialKey) {
        pl.material = trajectoryPolylineMaterial(row);
      }
      const nextZIndex = trajectoryPolylineZIndex(row);
      if (!cache || cache.zIndex !== nextZIndex) {
        pl.zIndex = nextZIndex > 0 ? new Cesium.ConstantProperty(nextZIndex) : undefined;
      }
      if (!cache) {
        pl.arcType = new Cesium.ConstantProperty(Cesium.ArcType.GEODESIC);
        pl.clampToGround = new Cesium.ConstantProperty(true);
      }

      (existing as unknown as { _syncCache: TrajectoryCache })._syncCache = {
        positions: row.positions,
        width: row.width,
        color: row.color.clone(),
        materialKey: nextMaterialKey,
        zIndex: nextZIndex,
      };
    }
  } finally {
    collection.resumeEvents();
  }
}

/** 油污溯源 AIS 轨迹（ais-fetch） */
function isOilSpillAisTrajectoryId(id: string): boolean {
  return id.startsWith('ais-traj-');
}

/** 油污漂移溯源路径（oil-drift） */
function isOilSpillDriftPathId(id: string): boolean {
  return id === 'drift-path';
}

function isOilSpillFlowTrajectoryId(id: string): boolean {
  return isOilSpillAisTrajectoryId(id) || isOilSpillDriftPathId(id);
}

function buildOilSpillFlowMaterial(
  arrowColor: Cesium.Color,
  textureUrl: string
): PolylineFlowMaterialOptions {
  return {
    color: arrowColor,
    image: textureUrl,
    repeat: new Cesium.Cartesian2(40, 1),
    speed: 30,
  };
}


/** `public/geo/china.geojson`（copy-cesium 从仓库根同步）；支持 Next `basePath` */
function resolveChinaGeoJsonUrl(): string {
  const raw = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const base = raw === '/' ? '' : raw.replace(/\/$/, '');
  if (!base) return '/geo/china.geojson';
  return `${base}/geo/china.geojson`;
}

/** `public/geo/eastern_china_sea.geojson`；加载方式与 china.geojson 一致 */
function resolveEastChinaSeaGeoJsonUrl(): string {
  const raw = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const base = raw === '/' ? '' : raw.replace(/\/$/, '');
  if (!base) return '/geo/eastern_china_sea.geojson';
  return `${base}/geo/eastern_china_sea.geojson`;
}

const EAST_CHINA_SEA_REGION_ID = 'region-east-china-sea';

/** `public` 下静态资源；与 `resolveChinaGeoJsonUrl` 一致处理 `basePath` */
function resolvePublicAssetUrl(absolutePathFromRoot: string): string {
  if (/^https?:\/\//i.test(absolutePathFromRoot)) return absolutePathFromRoot;
  const raw = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const base = raw === '/' ? '' : raw.replace(/\/$/, '');
  const p = absolutePathFromRoot.startsWith('/') ? absolutePathFromRoot : `/${absolutePathFromRoot}`;
  if (!base) return p;
  return `${base}${p}`;
}

/**
 * 2D / CV 下 `camera.computeViewRectangle` 常返回 undefined。
 * 注意：在 3D 斜视时若对**整圈屏幕边缘** pick，会拾到地平线，经纬包络接近全球 → 2D 仍「铺满地球」。
 * 本函数保留「全边采样」供 2D 等场景；3D→2D 请优先用 `captureRectangleFor3DTo2D` / `approximateViewRectangleByInsetScreenPicks`。
 */
function approximateViewRectangleByScreenPicks(viewer: Cesium.Viewer): Cesium.Rectangle | undefined {
  const ellipsoid = viewer.scene.globe.ellipsoid;
  const canvas = viewer.scene.canvas;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 2 || h < 2) return undefined;

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let count = 0;

  const addPick = (x: number, y: number) => {
    const picked = viewer.camera.pickEllipsoid(new Cesium.Cartesian2(x, y), ellipsoid);
    if (!picked) return;
    const carto = ellipsoid.cartesianToCartographic(picked);
    if (!carto) return;
    const lng = Cesium.Math.toDegrees(carto.longitude);
    const lat = Cesium.Math.toDegrees(carto.latitude);
    count++;
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  };

  const cols = 7;
  const rows = 5;
  for (let ci = 0; ci < cols; ci++) {
    for (let ri = 0; ri < rows; ri++) {
      addPick(((ci + 0.5) / cols) * w, ((ri + 0.5) / rows) * h);
    }
  }
  const edgeSteps = 12;
  for (let i = 0; i <= edgeSteps; i++) {
    const t = (i / edgeSteps) * w;
    addPick(t, 0);
    addPick(t, h);
  }
  for (let j = 0; j <= edgeSteps; j++) {
    const t = (j / edgeSteps) * h;
    addPick(0, t);
    addPick(w, t);
  }
  addPick(0, 0);
  addPick(w, 0);
  addPick(0, h);
  addPick(w, h);

  if (count < 3) return undefined;

  const spanLng = Math.max(east - west, 1e-4);
  const spanLat = Math.max(north - south, 1e-4);
  const padLng = Math.max(spanLng * 0.02, 0.001);
  const padLat = Math.max(spanLat * 0.02, 0.001);
  return Cesium.Rectangle.fromDegrees(west - padLng, south - padLat, east + padLng, north + padLat);
}

/** 仅在画布内缩区域采样，避免 3D 边缘拾到地平线导致矩形过大 */
function approximateViewRectangleByInsetScreenPicks(viewer: Cesium.Viewer, inset = 0.12): Cesium.Rectangle | undefined {
  const ellipsoid = viewer.scene.globe.ellipsoid;
  const canvas = viewer.scene.canvas;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 2 || h < 2) return undefined;

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let count = 0;

  const addPick = (x: number, y: number) => {
    const picked = viewer.camera.pickEllipsoid(new Cesium.Cartesian2(x, y), ellipsoid);
    if (!picked) return;
    const carto = ellipsoid.cartesianToCartographic(picked);
    if (!carto) return;
    const lng = Cesium.Math.toDegrees(carto.longitude);
    const lat = Cesium.Math.toDegrees(carto.latitude);
    count++;
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  };

  const x0 = inset * w;
  const x1 = (1 - inset) * w;
  const y0 = inset * h;
  const y1 = (1 - inset) * h;
  const cols = 8;
  const rows = 6;
  for (let ci = 0; ci < cols; ci++) {
    for (let ri = 0; ri < rows; ri++) {
      const x = x0 + ((ci + 0.5) / cols) * (x1 - x0);
      const y = y0 + ((ri + 0.5) / rows) * (y1 - y0);
      addPick(x, y);
    }
  }

  if (count < 3) return undefined;

  const spanLng = Math.max(east - west, 1e-4);
  const spanLat = Math.max(north - south, 1e-4);
  const padLng = Math.max(spanLng * 0.03, 0.0005);
  const padLat = Math.max(spanLat * 0.03, 0.0005);
  return Cesium.Rectangle.fromDegrees(west - padLng, south - padLat, east + padLng, north + padLat);
}

/**
 * 3D→2D：用屏幕中心贴地点 + 透视视锥与斜距估算「当前屏内地面」经纬范围，
 * 不依赖整屏 pick 包络，避免地平线把矩形撑满全球。
 */
function captureRectangleFor3DTo2D(viewer: Cesium.Viewer): Cesium.Rectangle | undefined {
  if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) return undefined;

  const camera = viewer.camera;
  const ellipsoid = viewer.scene.globe.ellipsoid;
  const canvas = viewer.scene.canvas;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 2 || h < 2) return undefined;

  const centerPick = camera.pickEllipsoid(new Cesium.Cartesian2(w * 0.5, h * 0.5), ellipsoid);
  if (!centerPick) return undefined;

  const centerCarto = ellipsoid.cartesianToCartographic(centerPick, new Cesium.Cartographic());
  const lat = centerCarto.latitude;
  const lon = centerCarto.longitude;

  const dist = Cesium.Cartesian3.distance(centerPick, camera.position);
  const R = ellipsoid.maximumRadius;
  const distGround = Math.max(dist, R * 0.05);

  let fovy = Cesium.Math.toRadians(55);
  const frustum = camera.frustum;
  if (frustum && Cesium.defined((frustum as Cesium.PerspectiveFrustum).fovy)) {
    fovy = (frustum as Cesium.PerspectiveFrustum).fovy as number;
  }

  const useW = w * 0.84;
  const useH = h * 0.84;
  const metersPerScreenHeight = 2 * distGround * Math.tan(fovy * 0.5);
  const mpp = metersPerScreenHeight / h;
  const halfWm = (useW * 0.5) * mpp;
  const halfHm = (useH * 0.5) * mpp;

  const cosLat = Math.max(Math.cos(lat), 0.15);
  let dLon = halfWm / (R * cosLat);
  let dLat = halfHm / R;

  const maxHalf = Cesium.Math.toRadians(40);
  const minHalf = Cesium.Math.toRadians(0.002);
  dLon = Cesium.Math.clamp(dLon, minHalf, maxHalf);
  dLat = Cesium.Math.clamp(dLat, minHalf, maxHalf);

  return Cesium.Rectangle.fromRadians(
    lon - dLon,
    Math.max(Cesium.Math.toRadians(-85), lat - dLat),
    lon + dLon,
    Math.min(Cesium.Math.toRadians(85), lat + dLat)
  );
}

/** 切换 SceneMode 前捕获当前「地理视窗」，用于 morph 结束后写回相机 */
function captureVisibleGeographicRectangle(viewer: Cesium.Viewer): Cesium.Rectangle | undefined {
  const ellipsoid = viewer.scene.globe.ellipsoid;

  if (viewer.scene.mode === Cesium.SceneMode.SCENE3D) {
    return (
      captureRectangleFor3DTo2D(viewer) ??
      approximateViewRectangleByInsetScreenPicks(viewer) ??
      viewer.camera.computeViewRectangle(ellipsoid)
    );
  }
  return viewer.camera.computeViewRectangle(ellipsoid) ?? approximateViewRectangleByInsetScreenPicks(viewer);
}

/**
 * morph 完成后 2D 首帧可能仍会改相机：postRender 多帧后 setView，并用 clone 避免矩形被内部改写。
 * 另用短时 setTimeout 再写一次，防止内部在首帧后再次重置为「全球」。
 */
function restoreCameraToRectangleWhenSceneStable(viewer: Cesium.Viewer, rect: Cesium.Rectangle) {
  const dest = Cesium.Rectangle.clone(rect);
  const apply = () => {
    if (viewer.isDestroyed()) return;
    try {
      viewer.camera.setView({ destination: Cesium.Rectangle.clone(dest) });
    } catch {
      // ignore
    }
  };

  let postFrames = 0;
  const removePost = viewer.scene.postRender.addEventListener(() => {
    if (viewer.isDestroyed()) {
      removePost();
      return;
    }
    postFrames++;
    if (postFrames < 3) return;
    removePost();
    apply();
    window.setTimeout(apply, 0);
    window.setTimeout(apply, 80);
    window.setTimeout(apply, 240);
  });
}

/** 船舶默认 Billboard（白底可着色，status 颜色通过 bb.color 乘色正确渲染） */
const SHIP_DEFAULT_BILLBOARD_URI = '/cesium/Assets/Images/ship_alpha_tintable_white.png';
/** 飞机默认 Billboard */
const AIRCRAFT_DEFAULT_BILLBOARD_URI = '/cesium/Assets/Images/aircraft.png';
/** 火情点位默认图标 */
export const FIRE_DEFAULT_BILLBOARD_URI = '/cesium/Assets/Images/fire-point.png';
/** 轨迹方向箭头 SVG（指向上方，通过 billboard.rotation 控制朝向） */
const ARROW_SVG_URI = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="M8 1 L15 15 L8 11 L1 15 Z" fill="white" stroke="white" stroke-width="1"/></svg>')}`;

/** 船舶像素 Billboard 近大远小：远距倍率高于通用点图层，避免全球视角船标过小 */
const SHIP_PIXEL_SCALE_BY_DISTANCE = new Cesium.NearFarScalar(2e2, 2.15, 1.55e7, 0.92);
/**
 * 与文档示例一样给 `billboard.rotation`（弧度）：贴图在「朝相机的牌面」上旋转。
 * 不是钉在地面真北；绕地球看时观感会变。贴图艏与真北差固定角时改此偏移（度）。
 */
const SHIP_PIXEL_ROTATION_OFFSET_DEG = 0;
/** 飞机默认图标艏向与真北差固定角时修正（度） */
const AIRCRAFT_PIXEL_ROTATION_OFFSET_DEG = 0;

/** 轴对齐矩形单张贴图（SingleTileImageryProvider），适用于 PNG/JPEG；TIFF 需另行转换 */
export interface SingleTileOverlaySpec {
  id: string;
  url: string;
  rectangle: { west: number; south: number; east: number; north: number };
  alpha?: number;
  /** 与图片像素一致为佳；当前 Cesium 版本构造 SingleTileImageryProvider 必填 */
  tileWidth?: number;
  tileHeight?: number;
}

const SINGLE_TILE_DEFAULT_PIXEL_W = 2048;
const SINGLE_TILE_DEFAULT_PIXEL_H = 1024;

const EMPTY_SINGLE_TILE_OVERLAYS: SingleTileOverlaySpec[] = [];

/** Billboard 呼吸光圈（PNG/JPEG/SVG URL）；不参与拾取，数据源排在底层以便点画在其上 */
export interface BillboardGlowHighlightOptions {
  enabled: boolean;
  /** 不传则用内置青色 SVG 渐变 */
  imageUrl?: string;
}

const BILLBOARD_GLOW_PERIOD_MS = 2000;

/** 随相机距离小幅伸缩：远距倍率压低，避免光圈占地过大 */
const BILLBOARD_GLOW_SCALE_BY_DISTANCE = new Cesium.NearFarScalar(1.2e4, 0.86, 2.0e7, 1.18);

function builtinBillboardGlowSvgUri(): string {
  return billboardGlowSvgDataUri('rgb(0,224,255)');
}

interface CesiumMapProps {
  entities: Entity[];
  trajectories: Trajectory[];
  regions: Region[];
  eventGisDataList: GisData[];
  denseCells: Array<{
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
    count: number;
  }>;
  activeLayers: Set<string>;
  currentStyle: string;
  selectedEntity: Entity | null;
  onEntityClick: (entity: Entity) => void;
  onViewportChange?: (viewport: { lat: number; lng: number; altitude: number }) => void;
  /** 叠在底图之上的单张影像层（切换底图样式后会自动重挂） */
  singleTileOverlays?: SingleTileOverlaySpec[];
  /** 点位下层 Billboard 呼吸光圈，可换 imageUrl（PNG/JPEG/SVG） */
  billboardGlowHighlight?: BillboardGlowHighlightOptions;
  /**
   * 为当前可见的全部 base/event 点位绘制脉冲椭圆环（ring 数据源）。
   * 关闭时仅对事件 / danger / 大尺寸点位显示环（原有策略）。
   */
  pulseRingDemoAll?: boolean;
  /** 手动绘制：点 / 线 / 面 / 矩形；完成后触发 onDrawComplete */
  drawTool?: {
    mode: MapDrawMode;
    onDrawComplete?: (result: MapDrawResult) => void;
  };
  /** 递增时清空地图上已提交的绘制结果（持久层） */
  mapDrawPersistClearVersion?: number;
  /** 点位上方显示名称（base / event / 高密度聚合） */
  showPointLabels?: boolean;
}

// 状态 → 颜色（船舶 / 飞机：正常白、警告橙、危险红；其它实体保持原逻辑）
function getStatusColor(
  status: Entity['status'],
  isEvent: boolean,
  eventColor?: string,
  entityType?: Entity['type'],
  dataSource?: string
): string {
  if (isEvent && eventColor) return eventColor;
  if (status === 'danger') return '#FF4444';
  if (status === 'warning')
    return entityType === 'ship' || entityType === 'aircraft' ? 'rgba(254, 149, 29, 1)' : '#FFAA00';
  if (entityType === 'ship' && status === 'normal') return '#00E0FF';
  if (entityType === 'aircraft' && status === 'normal') return '#FFFFFF';
  return '#EAEAEA';
}

// 实体大小
function getEntitySize(entity: Entity, isEvent: boolean): number {
  if (entity.type === 'fire') return 20;
  if (entity.type === 'earthquake') return 22;
  if (isEvent) return 12;
  if (entity.type === 'aircraft') return 6;
  if (entity.importance === 'high') return 10;
  if (entity.importance === 'medium') return 8;
  return 6;
}

/** 拾取展示用（tooltip / 样式），在传入数据之上附加 color、size 等 */
type PointDisplayItem = Record<string, unknown> & {
  coordinates: [number, number];
  color: string;
  size: number;
};

/** 一行点位：增量同步用 id；_payload 与传入引用一致，_item 为展示扩展 */
type PointLayerRow = {
  id: string;
  display: PointDisplayItem;
  /** 单击详情：与父组件 `entities` / 事件 GIS 里传入的是同一对象引用（高密度点为当场构造的唯一对象） */
  payload: Entity;
};

function pointLabelText(row: PointLayerRow): string {
  const fromDisplay = row.display.name;
  if (typeof fromDisplay === 'string' && fromDisplay.trim()) return fromDisplay.trim();
  const fromPayload = row.payload.name;
  if (typeof fromPayload === 'string' && fromPayload.trim()) return fromPayload.trim();
  return row.id;
}

/** 白色描边：强制 alpha=1，无半透明（避免与底图叠色发灰） */
const MAP_LABEL_OUTLINE_COLOR = new Cesium.Color(1, 1, 1, 1);
const MAP_LABEL_OUTLINE_WIDTH = 2;

/** Region / Overlay 大标签远距离缩放：200km 正常，3,000km 缩小到 0.25 */
const REGION_LABEL_SCALE = new Cesium.NearFarScalar(2e5, 1.0, 24e6, 0.25);
/** Region / Overlay 大标签远距离淡出：500km 开始变淡，3,000km 透明 */
const REGION_LABEL_FADE = new Cesium.NearFarScalar(5e5, 1.0, 24e6, 0.0);
/** 点位标签远距离淡出：500km 开始变淡，2,000km 透明 */
const POINT_LABEL_FADE = new Cesium.NearFarScalar(5e5, 1.0, 2e6, 0.0);

function labelGraphicsForRow(
  row: PointLayerRow,
  layer: 'base' | 'event' | 'dense',
  labelsVisible: boolean,
  /** SCENE2D：平面地图标签，不用随相机距缩放、不贴地形（避免仍按 3D 球面逻辑缩放） */
  mapLikePoints: boolean
): Cesium.LabelGraphics.ConstructorOptions {
  const item = row.display;
  const pixelSize = typeof item.size === 'number' ? item.size : 8;
  const font =
    layer === 'dense' ? '11px "Segoe UI", system-ui, sans-serif' : '13px "Segoe UI", system-ui, sans-serif';
  const scaleByDistance = mapLikePoints
    ? undefined
    : layer === 'dense'
      ? new Cesium.NearFarScalar(6e3, 1.0, 2.2e7, 0.3)
      : new Cesium.NearFarScalar(2e3, 1.08, 1.55e7, 0.4);
  /** 船舶 / 飞机 / 火点 Billboard：标签上移，避免被图标挡住 */
  const liftPx =
    item.type === 'ship' || item.type === 'aircraft'
      ? Math.round(pixelSize * 2.8 + 14)
      : item.type === 'fire'
        ? 28
        : item.type === 'earthquake'
          ? 32
          : Math.round(pixelSize + 8);

  return {
    text: pointLabelText(row),
    font,
    fillColor: Cesium.Color.fromCssColorString('#E6E6EA'),
    outlineColor: MAP_LABEL_OUTLINE_COLOR,
    outlineWidth: MAP_LABEL_OUTLINE_WIDTH,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
    pixelOffset: new Cesium.Cartesian2(0, -liftPx),
    heightReference: mapLikePoints
      ? Cesium.HeightReference.NONE
      : Cesium.HeightReference.CLAMP_TO_GROUND,
    ...(scaleByDistance ? { scaleByDistance } : {}),
    translucencyByDistance: POINT_LABEL_FADE,
    /** 勿 Infinity：否则背面标签会穿透地球叠在当前视图上，与船舶同类「飘点」问题 */
    show: labelsVisible,
  };
}

/** 顺时针航向角（0=北，90=东）；兼容 JSON 字符串与 cog/course/trueHeading/hdg 等别名 */
function parseHeadingDegrees(item: PointDisplayItem, payload?: Entity): number {
  const n = readHeadingNumber(item as Record<string, unknown>);
  if (n !== undefined) return normalizeHeadingDegrees(n);
  if (payload) {
    const m = readHeadingNumber(payload as Record<string, unknown>);
    if (m !== undefined) return normalizeHeadingDegrees(m);
  }
  return 0;
}

function readHeadingNumber(bag: Record<string, unknown>): number | undefined {
  const raw =
    bag.heading ??
    bag.cog ??
    bag.course ??
    bag.trueHeading ??
    bag.true_heading ??
    bag.hdg ??
    bag.HDG;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const p = parseFloat(raw);
    if (Number.isFinite(p)) return p;
  }
  return undefined;
}

function normalizeHeadingDegrees(n: number): number {
  const m = n % 360;
  return m < 0 ? m + 360 : m;
}

/**
 * 点位图层：增量同步——删多余 id，已存在则就地更新，仅在 Billboard/Point 形态切换时 remove 再 add。
 * 实体 id 一律 String，避免 event 与 base 因 MMSI 数字/字符串键不一致而「同一船画两遍」。
 */
function syncPointLayerEntities(
  collection: Cesium.EntityCollection,
  rows: PointLayerRow[],
  layer: 'base' | 'event' | 'dense',
  labelsVisible: boolean,
  mapLikePoints: boolean
) {
  const desiredIds = new Set(rows.map((r) => String(r.id)));

  collection.suspendEvents();
  try {
    const snapshot = [...collection.values];
    for (const e of snapshot) {
      const id = String(e.id);
      if (!desiredIds.has(id)) {
        collection.removeById(id);
      }
    }

    const outline =
      layer === 'event'
        ? { outlineColor: Cesium.Color.WHITE, outlineWidth: 2 }
        : layer === 'dense'
          ? { outlineColor: Cesium.Color.WHITE, outlineWidth: 1 }
          : { outlineColor: Cesium.Color.BLACK, outlineWidth: 1 };

    const scale =
      layer === 'dense' || mapLikePoints
        ? {}
        : { scaleByDistance: new Cesium.NearFarScalar(1.5e2, 2.0, 1.5e7, 0.5) };

    const propsForRow = (row: PointLayerRow) =>
      new Cesium.PropertyBag({
        _payload: new Cesium.ConstantProperty(row.payload),
        _item: new Cesium.ConstantProperty(row.display),
      });

    for (const row of rows) {
      const entityId = String(row.id);
      const item = row.display;
      const lng = item.coordinates[0] as number;
      const lat = item.coordinates[1] as number;
      const pos = Cesium.Cartesian3.fromDegrees(lng, lat, 0);
      const pointDef = {
        pixelSize: item.size,
        color: Cesium.Color.fromCssColorString(item.color),
        ...outline,
        ...scale,
      };

      const labelDef = labelGraphicsForRow(row, layer, labelsVisible, mapLikePoints);
      const groundRef = mapLikePoints
        ? Cesium.HeightReference.NONE
        : Cesium.HeightReference.CLAMP_TO_GROUND;

      const imageUrl = item.imageUrl as string | undefined;
      const isShip = item.type === 'ship';
      const isAircraft = item.type === 'aircraft';
      const isFire = item.type === 'fire';
      const resolvedImageUrl = imageUrl ? resolvePublicAssetUrl(imageUrl) : undefined;
      const shipDefaultUri = isShip && !imageUrl ? resolvePublicAssetUrl(SHIP_DEFAULT_BILLBOARD_URI) : undefined;
      const aircraftDefaultUri = isAircraft && !imageUrl ? resolvePublicAssetUrl(AIRCRAFT_DEFAULT_BILLBOARD_URI) : undefined;
      const fireDefaultUri = isFire ? resolvePublicAssetUrl(FIRE_DEFAULT_BILLBOARD_URI) : undefined;
      const billboardImage = resolvedImageUrl ?? shipDefaultUri ?? aircraftDefaultUri ?? fireDefaultUri;
      const wantBillboard = !!billboardImage;

      let bb: Cesium.BillboardGraphics.ConstructorOptions | undefined;
      if (wantBillboard) {
        bb = {
          image: billboardImage as string,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        };
        if (isShip) {
          const headingDeg = parseHeadingDegrees(item, row.payload);
          bb.width = item.size * 0.9;
          bb.height = item.size * 1.5;
          bb.verticalOrigin = Cesium.VerticalOrigin.BOTTOM;
          bb.horizontalOrigin = Cesium.HorizontalOrigin.CENTER;
          bb.color = Cesium.Color.fromCssColorString(String(item.color));
          bb.heightReference = groundRef;
          bb.rotation = Cesium.Math.toRadians(-headingDeg - SHIP_PIXEL_ROTATION_OFFSET_DEG);
          if (!mapLikePoints && layer !== 'dense') {
            bb.scaleByDistance = SHIP_PIXEL_SCALE_BY_DISTANCE;
          }
        } else if (isAircraft) {
          const headingDeg = parseHeadingDegrees(item, row.payload);
          bb.width = item.size * 1.2;
          bb.height = item.size * 2.05;
          bb.verticalOrigin = Cesium.VerticalOrigin.BOTTOM;
          bb.horizontalOrigin = Cesium.HorizontalOrigin.CENTER;
          bb.color = Cesium.Color.fromCssColorString(String(item.color));
          bb.heightReference = groundRef;
          bb.rotation = Cesium.Math.toRadians(-headingDeg - AIRCRAFT_PIXEL_ROTATION_OFFSET_DEG);
          if (!mapLikePoints && layer !== 'dense') {
            bb.scaleByDistance = SHIP_PIXEL_SCALE_BY_DISTANCE;
          }
        } else if (isFire) {
          bb.width = 20;
          bb.height = 20;
          bb.verticalOrigin = Cesium.VerticalOrigin.BOTTOM;
          bb.horizontalOrigin = Cesium.HorizontalOrigin.CENTER;
          bb.color = Cesium.Color.WHITE;
          bb.heightReference = groundRef;
          bb.disableDepthTestDistance = Number.POSITIVE_INFINITY;
          if (!mapLikePoints && layer !== 'dense') {
            bb.scaleByDistance = new Cesium.NearFarScalar(8e4, 1.0, 4e6, 0.5);
          }
        } else {
          bb.width = item.size * 2.5;
          bb.height = item.size * 2.5;
          bb.verticalOrigin = Cesium.VerticalOrigin.CENTER;
          if (!mapLikePoints && layer !== 'dense' && pointDef.scaleByDistance !== undefined) {
            bb.scaleByDistance = pointDef.scaleByDistance;
          }
        }
      }

      const existing = collection.getById(entityId);

      if (!existing) {
        if (wantBillboard && bb) {
          collection.add({
            id: entityId,
            position: pos,
            billboard: bb,
            label: labelDef,
            properties: propsForRow(row),
          });
        } else {
          collection.add({
            id: entityId,
            position: pos,
            point: pointDef,
            label: labelDef,
            properties: propsForRow(row),
          });
        }
        continue;
      }

      const hasBillboard = existing.billboard !== undefined;
      if (wantBillboard !== hasBillboard) {
        collection.removeById(entityId);
        if (wantBillboard && bb) {
          collection.add({
            id: entityId,
            position: pos,
            billboard: bb,
            label: labelDef,
            properties: propsForRow(row),
          });
        } else {
          collection.add({
            id: entityId,
            position: pos,
            point: pointDef,
            label: labelDef,
            properties: propsForRow(row),
          });
        }
        continue;
      }

      existing.position = new Cesium.ConstantPositionProperty(pos);
      existing.properties = propsForRow(row);
      existing.label = new Cesium.LabelGraphics(labelDef);

      if (wantBillboard) {
        existing.billboard = new Cesium.BillboardGraphics(bb!);
        existing.point = undefined;
      } else {
        existing.point = new Cesium.PointGraphics(pointDef);
        existing.billboard = undefined;
      }
    }
  } finally {
    collection.resumeEvents();
  }
}

function syncBillboardGlowEntities(
  collection: Cesium.EntityCollection,
  rows: PointLayerRow[],
  enabled: boolean,
  imageUri: string,
  mapLikePoints: boolean
) {
  collection.removeAll();
  if (!enabled || rows.length === 0) return;

  for (const row of rows) {
    const item = row.display;
    const lng = item.coordinates[0] as number;
    const lat = item.coordinates[1] as number;
    const tint = Cesium.Color.fromCssColorString(String(item.color));

    collection.add({
      id: `glow-bb-${row.id}`,
      position: Cesium.Cartesian3.fromDegrees(lng, lat, mapLikePoints ? 0 : 2),
      billboard: {
        image: imageUri,
        scale: new Cesium.CallbackProperty(() => {
          const ms = performance.now();
          const phase = ((ms % BILLBOARD_GLOW_PERIOD_MS) / BILLBOARD_GLOW_PERIOD_MS) * Math.PI * 2;
          return 0.82 + 0.08 * Math.sin(phase);
        }, false),
        /** 不透明着色：仅 scale 呼吸，避免 alpha 把贴图线条冲没 */
        color: new Cesium.ConstantProperty(tint.withAlpha(1)),
        ...(mapLikePoints
          ? {}
          : { scaleByDistance: BILLBOARD_GLOW_SCALE_BY_DISTANCE }),
        heightReference: mapLikePoints
          ? Cesium.HeightReference.NONE
          : Cesium.HeightReference.CLAMP_TO_GROUND,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }
}

export interface GisOperation {
  type: string;
  /** renderLayer 等指令用 */
  id?: string;
  bounds?: { west: number; south: number; east: number; north: number };
  /** flyTo 单点，或 renderLayer 多顶点 */
  coordinates?: [number, number] | Array<[number, number]>;
  altitude?: number;
  duration?: number;
  target?: string;
  style?: Record<string, unknown>;
  label?: { text?: string; position?: [number, number] };
}

export interface CesiumMapRef {
  resetView: () => void;
  toggleSceneMode: () => void;
  flyToRegion: (lng: number, lat: number, altitude: number) => void;
  showFireOverlay: () => void;
  hideFireOverlay: () => void;
  /** 移除地图上由绘制工具提交的持久几何（不影响当前交互草稿） */
  clearPersistedMapDraw: () => void;
  /** 执行后端推送的 GIS 操作指令 */
  executeOperation: (op: GisOperation) => void;
  /** 获取当前相机视角参数，用于调试 flyTo */
  getCurrentCameraParams: () => { lng: number; lat: number; altitude: number; heading: number; pitch: number; roll: number } | null;
  /** 示例 / 实验性叠加层（如风场 Canvas）使用；生产代码请谨慎 */
  getViewer: () => Cesium.Viewer | null;
}

const CesiumMap = forwardRef<CesiumMapRef, CesiumMapProps>(function CesiumMap({
  entities,
  trajectories,
  regions,
  eventGisDataList,
  denseCells,
  activeLayers,
  currentStyle,
  selectedEntity,
  onEntityClick,
  onViewportChange,
  singleTileOverlays: singleTileOverlaysProp,
  billboardGlowHighlight: billboardGlowHighlightProp,
  pulseRingDemoAll: pulseRingDemoAllProp,
  drawTool: drawToolProp,
  mapDrawPersistClearVersion: mapDrawPersistClearVersionProp,
  showPointLabels: showPointLabelsProp = false,
}: CesiumMapProps, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const mapDrawInteractiveRef = useRef<Cesium.CustomDataSource | null>(null);
  const mapDrawPersistedRef = useRef<Cesium.CustomDataSource | null>(null);
  const drawToolModeRef = useRef<MapDrawMode>('none');
  const onDrawCompleteRef = useRef<((r: MapDrawResult) => void) | undefined>(undefined);
  const entitiesRef = useRef(entities);
  const eventGisRef = useRef(eventGisDataList);
  const denseCellsRef = useRef(denseCells);
  const activeLayersRef = useRef(activeLayers);
  // 缓存 viewer 未初始化时到达的 flyTo 请求，初始化完成后统一执行
  const pendingFlyToRef = useRef<Array<{ lng: number; lat: number; altitude: number }>>([]);
  entitiesRef.current = entities;
  eventGisRef.current = eventGisDataList;
  denseCellsRef.current = denseCells;
  activeLayersRef.current = activeLayers;
  drawToolModeRef.current = drawToolProp?.mode ?? 'none';
  onDrawCompleteRef.current = drawToolProp?.onDrawComplete;
  const dataSourcesRef = useRef<{
    base: Cesium.CustomDataSource;
    event: Cesium.CustomDataSource;
    trajectory: Cesium.CustomDataSource;
    eventTrajectory: Cesium.CustomDataSource;
    trajectoryArrow: Cesium.CustomDataSource;
    region: Cesium.CustomDataSource;
    dense: Cesium.CustomDataSource;
    ring: Cesium.CustomDataSource;
    oilDiffusion: Cesium.CustomDataSource;
    glowBillboard: Cesium.CustomDataSource;
  } | null>(null);
  const clickHandlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const moveHandlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const hoverEntityRef = useRef<Cesium.Entity | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number>(0);
  const localTileOutlinesRef = useRef<string[]>([]);
  const fireOverlayRef = useRef<Cesium.ImageryLayer | null>(null);
  const fireMaskRef = useRef<Cesium.ImageryLayer | null>(null);
  const fireOutlineIdRef = useRef<string | null>(null);
  const regionLightWallPrimitivesRef = useRef<Cesium.PrimitiveCollection | null>(null);
  /** 东海 GeoJSON（与 china.geojson 相同加载方式） */
  const eastChinaSeaGeoJsonRef = useRef<Cesium.GeoJsonDataSource | null>(null);
  const singleTileImageryLayersRef = useRef<Map<string, Cesium.ImageryLayer>>(new Map());
  /** 与 Viewer SCENE2D/3D 对齐；2D 下点位/标签用平面样式（无 scaleByDistance、不 CLAMP_TO_GROUND） */
  const [mapLikePointStyle, setMapLikePointStyle] = useState(true);

  // 创建 tooltip DOM
  useEffect(() => {
    const tooltip = document.createElement('div');
    tooltip.style.cssText = `
      position: fixed;
      z-index: 99999;
      pointer-events: none;
      display: none;
      background: rgba(30, 30, 46, 0.95);
      padding: 8px 12px;
      border-radius: 6px;
      border: 2px solid #FF0000;
      color: #EAEAEA;
      font-size: 12px;
      max-width: 240px;
      white-space: nowrap;
    `;
    document.body.appendChild(tooltip);
    tooltipRef.current = tooltip;
    return () => {
      document.body.removeChild(tooltip);
    };
  }, []);

  // 初始化 Viewer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN?.trim();
    if (ionToken) {
      Cesium.Ion.defaultAccessToken = ionToken;
    }

    if (typeof window !== 'undefined' && !(window as any).CESIUM_BASE_URL) {
      (window as any).CESIUM_BASE_URL = '/cesium/';
    }

    const viewer = new Cesium.Viewer(container, {
      baseLayerPicker: false,
      timeline: false,
      animation: false,
      homeButton: false,
      geocoder: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      sceneMode: Cesium.SceneMode.SCENE2D,
      fullscreenButton: false,
      vrButton: false,
      infoBox: false,
      selectionIndicator: false,
      skyAtmosphere: new Cesium.SkyAtmosphere(),
      baseLayer: new Cesium.ImageryLayer(getStyleById('local-global-7').createImageryProvider()),
      creditContainer: document.createElement('div'),
    } as any);

    // 星空背景
    (viewer.scene.skyBox as any).show = true;
    (viewer.scene.skyAtmosphere as any).show = true;
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#0a0a1a');

    // 晨昏线：随太阳方向照亮椭球；外侧大气：天球大气 + 地表边缘光晕
    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.showGroundAtmosphere = true;
    viewer.scene.globe.dynamicAtmosphereLighting = true;
    viewer.scene.globe.dynamicAtmosphereLightingFromSun = true;
    viewer.scene.globe.depthTestAgainstTerrain = false;

    // 地表明暗：降低 Lambert 权重、略抬夜侧底光，晨昏带更宽、夜侧不死黑（更接真实暮光）
    viewer.scene.globe.lambertDiffuseMultiplier = 0.56;
    viewer.scene.globe.vertexShadowDarkness = 0.42;

    const Re = viewer.scene.globe.ellipsoid.minimumRadius;
    viewer.scene.globe.nightFadeOutDistance = Re * Cesium.Math.PI_OVER_TWO * 1.15;
    viewer.scene.globe.nightFadeInDistance = Re * Cesium.Math.PI_OVER_TWO * 6.75;

    // 统一大气随太阳；强度略收，避免与地表晨昏对比“打架”
    const atm = viewer.scene.atmosphere;
    atm.dynamicLighting = Cesium.DynamicAtmosphereLightingType.SUNLIGHT;
    atm.lightIntensity = 20;
    atm.brightnessShift = 0.1;
    atm.saturationShift = 0.1;

    const skyAtm = viewer.scene.skyAtmosphere;
    if (skyAtm) {
      skyAtm.perFragmentAtmosphere = true;
      skyAtm.atmosphereLightIntensity = 72;
      skyAtm.brightnessShift = 0.06;
      skyAtm.saturationShift = 0.08;
    }

    viewer.scene.globe.atmosphereLightIntensity = 18;
    viewer.scene.globe.atmosphereBrightnessShift = 0.08;
    viewer.scene.globe.atmosphereSaturationShift = 0.08;

    const syncWallClockToSun = () => {
      viewer.clock.currentTime = Cesium.JulianDate.now();
    };
    syncWallClockToSun();
    viewer.scene.postUpdate.addEventListener(syncWallClockToSun);

    let chinaOutlineCancelled = false;
    // 尽早拉取解析；不贴地以减轻巨量 MultiPolygon 的 clamp 开销，加载后再 flyTo 到中国范围
    const chinaGeoJsonPromise = Cesium.GeoJsonDataSource.load(resolveChinaGeoJsonUrl(), {
      stroke: Cesium.Color.fromCssColorString('#00E0FF').withAlpha(0.95),
      fill: Cesium.Color.fromCssColorString('#00E0FF').withAlpha(0.22),
      strokeWidth: 2,
      clampToGround: false,
    });

    let terrainCancelled = false;
    const useEllipsoidTerrain = () => {
      if (!terrainCancelled && viewerRef.current === viewer) {
        viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
      }
    };

    if (ionToken) {
      Cesium.createWorldTerrainAsync({
        requestWaterMask: true,
        requestVertexNormals: true,
      })
        .then((terrainProvider) => {
          if (!terrainCancelled && viewerRef.current === viewer) {
            viewer.terrainProvider = terrainProvider;
          }
        })
        .catch((err) => {
          console.warn('[Cesium] Ion 地形不可用，使用椭球地形:', err);
          useEllipsoidTerrain();
        });
    } else {
      useEllipsoidTerrain();
    }

    // 初始视角：中国上空，等效 react-globe.gl altitude=3.1
    // react-globe.gl altitude 是相对地球半径的倍数：3.1 = 地表上方 3.1*R ≈ 19750km
    // Cesium 用米：约 20,000,000 米
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(105, 35, 20000000),
      duration: 0,
    });

    // 创建 DataSources
    const baseDS = new Cesium.CustomDataSource('base');
    const eventDS = new Cesium.CustomDataSource('event');
    const trajectoryDS = new Cesium.CustomDataSource('trajectory');
    const eventTrajectoryDS = new Cesium.CustomDataSource('eventTrajectory');
    const trajectoryArrowDS = new Cesium.CustomDataSource('trajectoryArrow');
    const regionDS = new Cesium.CustomDataSource('region');
    const denseDS = new Cesium.CustomDataSource('dense');
    const ringDS = new Cesium.CustomDataSource('ring');
    const oilDiffusionDS = new Cesium.CustomDataSource('oilDiffusion');
    const glowBillboardDS = new Cesium.CustomDataSource('glowBillboard');

    viewer.dataSources.add(glowBillboardDS);
    viewer.dataSources.add(baseDS);
    viewer.dataSources.add(eventDS);
    viewer.dataSources.add(regionDS);
    viewer.dataSources.add(denseDS);
    viewer.dataSources.add(ringDS);
    viewer.dataSources.add(oilDiffusionDS);
    // 轨迹层置于区域/密点之上，避免被面要素压住
    viewer.dataSources.add(trajectoryDS);
    viewer.dataSources.add(eventTrajectoryDS);
    viewer.dataSources.add(trajectoryArrowDS);

    const regionLightWallPrimitives = new Cesium.PrimitiveCollection();
    viewer.scene.primitives.add(regionLightWallPrimitives);
    regionLightWallPrimitivesRef.current = regionLightWallPrimitives;

    const mapDrawInteractiveDS = new Cesium.CustomDataSource('mapDrawInteractive');
    const mapDrawPersistedDS = new Cesium.CustomDataSource('mapDrawPersisted');
    viewer.dataSources.add(mapDrawInteractiveDS);
    viewer.dataSources.add(mapDrawPersistedDS);
    mapDrawInteractiveRef.current = mapDrawInteractiveDS;
    mapDrawPersistedRef.current = mapDrawPersistedDS;

    dataSourcesRef.current = {
      base: baseDS,
      event: eventDS,
      trajectory: trajectoryDS,
      eventTrajectory: eventTrajectoryDS,
      trajectoryArrow: trajectoryArrowDS,
      region: regionDS,
      dense: denseDS,
      ring: ringDS,
      oilDiffusion: oilDiffusionDS,
      glowBillboard: glowBillboardDS,
    };

    viewerRef.current = viewer;

    // 执行 viewer 初始化前缓存的 pending flyTo 请求（链式执行：等前一个完成再飞下一个）
    const pending = pendingFlyToRef.current;
    if (pending.length > 0) {
      (async () => {
        for (const { lng, lat, altitude } of pending) {
          await new Promise<void>((resolve) => {
            viewer.camera.flyTo({
              destination: Cesium.Cartesian3.fromDegrees(lng, lat, altitude),
              duration: 1.5,
              complete: () => resolve(),
            });
          });
        }
        console.log(`[CesiumMap] Executed ${pending.length} pending flyTo(s) sequentially`);
      })();
      pendingFlyToRef.current = [];
    }

    setMapLikePointStyle(viewer.scene.mode === Cesium.SceneMode.SCENE2D);
    const onMorphComplete = () => {
      if (viewer.isDestroyed()) return;
      setMapLikePointStyle(viewer.scene.mode === Cesium.SceneMode.SCENE2D);
    };
    viewer.scene.morphComplete.addEventListener(onMorphComplete);

    void chinaGeoJsonPromise
      .then((ds) => {
        if (chinaOutlineCancelled || viewer.isDestroyed()) {
          (ds as unknown as { destroy(): void }).destroy();
          return;
        }
        viewer.dataSources.add(ds);
        viewer.dataSources.lowerToBottom(ds);
        void viewer
          .flyTo(ds, {
            duration: 1.35,
            maximumHeight: 28e6,
          })
          .catch(() => {});
      })
      .catch((err) => {
        if (!chinaOutlineCancelled) {
          console.warn(
            '[Cesium] china.geojson 加载失败（请确认 public/geo/china.geojson 存在，并已执行 pnpm dev 触发 copy-cesium）:',
            err
          );
        }
      });

    // 监听容器尺寸变化，自动 resize（解决侧边栏展开/收起导致 2D 地图变形）
    const resizeObserver = new ResizeObserver(() => {
      viewer.resize();
    });
    resizeObserver.observe(container);

    return () => {
      terrainCancelled = true;
      chinaOutlineCancelled = true;
      resizeObserver.disconnect();
      viewer.scene.morphComplete.removeEventListener(onMorphComplete);
      viewer.scene.postUpdate.removeEventListener(syncWallClockToSun);
      viewer.destroy();
      viewerRef.current = null;
      dataSourcesRef.current = null;
      mapDrawInteractiveRef.current = null;
      mapDrawPersistedRef.current = null;
      regionLightWallPrimitivesRef.current = null;
      // viewer.destroy() 已自动销毁所有 dataSources，无需单独调用 destroy
      eastChinaSeaGeoJsonRef.current = null;
    };
  }, []);

  const prevPersistClearV = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (mapDrawPersistClearVersionProp === undefined) return;
    if (prevPersistClearV.current === undefined) {
      prevPersistClearV.current = mapDrawPersistClearVersionProp;
      return;
    }
    if (mapDrawPersistClearVersionProp === prevPersistClearV.current) return;
    prevPersistClearV.current = mapDrawPersistClearVersionProp;
    mapDrawPersistedRef.current?.entities.removeAll();
  }, [mapDrawPersistClearVersionProp]);

  // 手动绘制工具（交互层与持久层分离：完成后写入持久层，仅清空交互层）
  useEffect(() => {
    const viewer = viewerRef.current;
    const interactive = mapDrawInteractiveRef.current;
    const persisted = mapDrawPersistedRef.current;
    if (!viewer || !interactive || !persisted) return;

    const mode = drawToolProp?.mode ?? 'none';
    if (mode === 'none') {
      interactive.entities.removeAll();
      return;
    }

    const detach = attachMapDrawTool({
      viewer,
      drawDataSource: interactive,
      mode,
      getCollectCtx: () => ({
        entities: entitiesRef.current,
        eventGisDataList: eventGisRef.current,
        denseCells: denseCellsRef.current,
        activeLayers: activeLayersRef.current,
      }),
      onComplete: (r) => {
        addPersistedMapDraw(persisted, r);
        onDrawCompleteRef.current?.(r);
      },
    });
    return detach;
  }, [drawToolProp?.mode]);

  // 点击事件
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      if (drawToolModeRef.current !== 'none') return;
      const picked = viewer.scene.pick(movement.position);
      if (Cesium.defined(picked) && picked.id?.properties) {
        const props = picked.id.properties as Cesium.PropertyBag;
        const time = viewer.clock.currentTime;
        const payloadProp = props._payload as Cesium.Property | undefined;
        const payload =
          payloadProp && typeof payloadProp.getValue === 'function'
            ? (payloadProp.getValue(time) as Entity | undefined)
            : undefined;
        if (payload && (payload as { type?: string }).type !== 'dense') {
          onEntityClick(payload);
          return;
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    clickHandlerRef.current = handler;
    return () => {
      handler.destroy();
    };
  }, [onEntityClick]);

  // Hover tooltip
  useEffect(() => {
    const viewer = viewerRef.current;
    const tooltip = tooltipRef.current;
    if (!viewer || !tooltip) return;

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      if (drawToolModeRef.current !== 'none') {
        tooltip.style.display = 'none';
        document.body.style.cursor = 'crosshair';
        return;
      }
      const picked = viewer.scene.pick(movement.endPosition);
      if (Cesium.defined(picked) && picked.id?.properties) {
        const props = picked.id.properties as Cesium.PropertyBag;
        const itemProp = props._item as Cesium.Property | undefined;
        const item =
          itemProp && typeof itemProp.getValue === 'function'
            ? (itemProp.getValue(viewer.clock.currentTime) as PointDisplayItem | undefined)
            : undefined;
        if (item) {
          tooltip.style.display = 'block';
          tooltip.style.left = movement.endPosition.x + 15 + 'px';
          tooltip.style.top = movement.endPosition.y + 15 + 'px';

          if (item.isDense) {
            tooltip.innerHTML = `
              <div style="color: #FF6600; font-weight: 600; margin-bottom: 4px;">高密度区域</div>
              <div style="color: #EAEAEA; font-size: 12px;">${item.name}</div>
              <div style="color: #8888AA; font-size: 11px; margin-top: 2px;">请放大查看详细船舶</div>
            `;
          } else {
            const statusText = item.status === 'danger' ? '危险' : item.status === 'warning' ? '警告' : '正常';
            const typeText = item.type === 'ship' ? '船舶' : item.type === 'aircraft' ? '航空器' : item.type === 'fire' ? '火情' : '基站';
            tooltip.innerHTML = `
              <div style="color: #EAEAEA; font-weight: 600; margin-bottom: 4px;">${item.name}</div>
              <div style="color: #8888AA; font-size: 12px;">类型: ${typeText}</div>
              <div style="color: ${item.color}; font-size: 12px;">状态: ${statusText}</div>
              ${item.speed != null ? `<div style="color: #8888AA; font-size: 12px;">航速: ${Math.round(Number(item.speed))}${item.type === 'ship' ? '节' : 'km/h'}</div>` : ''}
              ${item.heading != null ? `<div style="color: #8888AA; font-size: 12px;">航向: ${Math.round(Number(item.heading))}°</div>` : ''}
              ${item.altitude != null ? `<div style="color: #8888AA; font-size: 12px;">高度: ${Math.round(Number(item.altitude))}m</div>` : ''}
              ${item.isEvent ? `<div style="color: ${item.color}; font-size: 11px; margin-top: 2px;">📍 事件关联数据</div>` : ''}
            `;
          }
          document.body.style.cursor = 'pointer';
          return;
        }
      }
      if (!autoTooltipShowingRef.current) {
        tooltip.style.display = 'none';
        document.body.style.cursor = 'default';
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    moveHandlerRef.current = handler;
    return () => {
      handler.destroy();
    };
  }, []);

  // 视口变化监听
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !onViewportChange) return;

    const onChange = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const carto = viewer.camera.positionCartographic;
        const lat = Cesium.Math.toDegrees(carto.latitude);
        const lng = Cesium.Math.toDegrees(carto.longitude);
        // Cesium height (米) → react-globe.gl altitude (相对地球半径)
        const altitude = carto.height / 6371000;
        onViewportChange({ lat, lng, altitude });
      });
    };

    viewer.camera.changed.addEventListener(onChange);
    return () => {
      if (!viewer.isDestroyed()) {
        viewer.camera.changed.removeEventListener(onChange);
      }
      cancelAnimationFrame(rafRef.current);
    };
  }, [onViewportChange]);

  /** 排污原点褐色扩散（独立 oilDiffusion 层，不受 ring.removeAll 影响） */
  const syncOilDiffusion = useCallback(() => {
    const ds = dataSourcesRef.current;
    if (!ds) return;
    const allRegions: Region[] = [...regions];
    eventGisDataList.forEach((gis) => {
      gis.regions?.forEach((r) => allRegions.push(r));
    });
    const specs = collectOilSpillDiffusionSpecs(allRegions, eventGisDataList);
    syncOilSpillDiffusionPlumes(ds.oilDiffusion.entities, specs, mapLikePointStyle);
    const viewer = viewerRef.current;
    if (viewer && specs.length > 0) {
      viewer.dataSources.raise(ds.oilDiffusion);
    }
  }, [regions, eventGisDataList, mapLikePointStyle]);

  // 同步 entities
  const syncEntities = useCallback(() => {
    const ds = dataSourcesRef.current;
    if (!ds) return;

    const getEventColor = (eventId: string) => {
      const index = eventGisDataList.findIndex((g) => g.eventId === eventId);
      return EVENT_COLORS[index % EVENT_COLORS.length];
    };

    // 收集事件实体（按 entity.id 去重；**后到覆盖先到**，让 ais-match-suspects/ranking 推同 mmsi 的新 status 覆盖 ais-fetch 的旧 status）
    const eventEntityMap = new Map<string, { entity: Entity; eventId: string }>();
    eventGisDataList.forEach((gisData) => {
      gisData.entities?.forEach((entity: Entity) => {
        eventEntityMap.set(String(entity.id), { entity, eventId: gisData.eventId! });
      });
    });

    // 基础实体（排除已在事件中的）
    const isEntityLayerActive = (type: Entity['type']) => {
      if (type === 'aircraft') return activeLayers.has('ads');
      if (type === 'ship') return activeLayers.has('ais');
      if (type === 'base') return activeLayers.has('base');
      return false;
    };

    const baseRows: PointLayerRow[] = entities
      .filter((e) => isEntityLayerActive(e.type) && !eventEntityMap.has(String(e.id)))
      .map((entity) => {
        const color = getStatusColor(entity.status, false, undefined, entity.type, (entity as any).dataSource);
        const rawImg = (entity as Record<string, unknown>).imageUrl as string | undefined;
        const resolvedImageUrl = rawImg
          ? (rawImg.startsWith('http') || rawImg.startsWith('/') ? rawImg : `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}${rawImg}`)
          : undefined;
        const display: PointDisplayItem = {
          ...entity,
          color,
          size: getEntitySize(entity, false),
          isEvent: false,
          ...(resolvedImageUrl ? { imageUrl: resolvedImageUrl } : {}),
        };
        return { id: String(entity.id), display, payload: entity };
      });

    // 事件点位渲染：使用事件颜色池（与 ADS-B/AIS 基础白/青色区分），避免重叠不可见
    const eventRows: PointLayerRow[] = Array.from(eventEntityMap.values()).map(({ entity, eventId }) => {
      const liveEntity = entities.find((e) => e.id === entity.id);
      const payload = liveEntity ?? entity;
      const eventColor = getEventColor(eventId);
      const color = getStatusColor(
        payload.status,
        true,
        eventColor,
        payload.type,
        (payload as Record<string, unknown>).dataSource as string | undefined
      );
      const rawImg = (payload as Record<string, unknown>).imageUrl as string | undefined;
      const resolvedImageUrl = rawImg
        ? (rawImg.startsWith('http') ? rawImg : `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}${rawImg}`)
        : undefined;
      const display: PointDisplayItem = {
        ...payload,
        color,
        size: getEntitySize(payload, true),
        isEvent: true,
        eventId,
        imageUrl:
          payload.type === 'fire'
            ? resolvePublicAssetUrl(FIRE_DEFAULT_BILLBOARD_URI)
            : resolvedImageUrl,
      };
      return { id: String(payload.id), display, payload };
    });

    const denseRows: PointLayerRow[] = denseCells.map((cell) => {
      const id = `dense-${cell.minLng.toFixed(2)}-${cell.minLat.toFixed(2)}`;
      const payload = {
        id,
        name: `约 ${cell.count} 艘船舶`,
        type: 'dense' as const,
        status: 'normal' as const,
        coordinates: [(cell.minLng + cell.maxLng) / 2, (cell.minLat + cell.maxLat) / 2] as [number, number],
        importance: 'medium' as const,
      } as unknown as Entity;
      const display: PointDisplayItem = {
        ...payload,
        color: '#FF6600',
        size: 14,
        isEvent: false,
        isDense: true,
      };
      return { id, display, payload };
    });

    syncPointLayerEntities(ds.base.entities, baseRows, 'base', showPointLabelsProp, mapLikePointStyle);
    syncPointLayerEntities(ds.event.entities, eventRows, 'event', showPointLabelsProp, mapLikePointStyle);
    syncPointLayerEntities(ds.dense.entities, denseRows, 'dense', showPointLabelsProp, mapLikePointStyle);

    ds.ring.entities.removeAll();

    const allRingDisplays = [...baseRows, ...eventRows].map((r) => r.display);
    const ringEntities = pulseRingDemoAllProp
      ? allRingDisplays.filter((item) => item.type !== 'fire')
      : [];

    ringEntities.forEach((item) => {
      const color = Cesium.Color.fromCssColorString(String(item.color));
      const maxR = item.isEvent ? 400000 : 300000;
      const period = item.isEvent ? 1200 : 2000;

      ds.ring.entities.add({
        position: Cesium.Cartesian3.fromDegrees(item.coordinates[0], item.coordinates[1], 0),
        ellipse: {
          semiMinorAxis: new Cesium.CallbackProperty((time) => {
            const t = ((time?.secondsOfDay ?? 0) * 1000) % period;
            const progress = t / period;
            return maxR * progress;
          }, false),
          semiMajorAxis: new Cesium.CallbackProperty((time) => {
            const t = ((time?.secondsOfDay ?? 0) * 1000) % period;
            const progress = t / period;
            return maxR * progress;
          }, false),
          material: new Cesium.ColorMaterialProperty(
            new Cesium.CallbackProperty((time) => {
              const t = ((time?.secondsOfDay ?? 0) * 1000) % period;
              const progress = t / period;
              return new Cesium.Color(color.red, color.green, color.blue, 1 - progress);
            }, false)
          ),
          heightReference: mapLikePointStyle
            ? Cesium.HeightReference.NONE
            : Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
    });

    // 火点地面扩散脉冲（2D / 3D 通用）
    const fireGroundSpecs = collectFireGroundSpecs(
      eventRows
        .filter((r) => r.payload.type === 'fire')
        .map((r) => ({ id: String(r.id), coordinates: r.payload.coordinates }))
    );
    if (fireGroundSpecs.length > 0) {
      syncFireGroundPulseRings(ds.ring.entities, fireGroundSpecs, mapLikePointStyle);
    }

    const epicenterGroundSpecs = collectEpicenterGroundSpecs(
      Array.from(eventEntityMap.values())
        .filter(({ entity }) => entity.type === 'earthquake')
        .map(({ entity }) => ({ id: String(entity.id), coordinates: entity.coordinates }))
    );
    if (epicenterGroundSpecs.length > 0) {
      syncEpicenterGroundPulseRings(ds.ring.entities, epicenterGroundSpecs, mapLikePointStyle);
    }

    const glowRows = [...baseRows, ...eventRows].filter(
      (r) => r.display.type !== 'fire' && r.display.type !== 'earthquake'
    );
    const glowOn = billboardGlowHighlightProp?.enabled === true;
    const glowUri =
      billboardGlowHighlightProp?.imageUrl?.trim() || builtinBillboardGlowSvgUri();
    syncBillboardGlowEntities(ds.glowBillboard.entities, glowRows, glowOn, glowUri, mapLikePointStyle);

    // 自动触发火情 entity tooltip（仅当新增 news-fire gisData 时）
    const currentLen = eventGisDataList.length;
    if (currentLen > lastGisLenForFireRef.current) {
      const newItems = eventGisDataList.slice(lastGisLenForFireRef.current);
      lastGisLenForFireRef.current = currentLen;
      const newsFireGis = newItems.find(
        (g) => g.eventName === 'news-fire' && g.entities?.some((e: Entity) => e.type === 'fire')
      );
      console.log('[AutoTooltip] newItems:', newItems.length, 'newsFireGis:', !!newsFireGis);
      if (newsFireGis) {
        const fireEntity = newsFireGis.entities!.find((e) => e.type === 'fire');
        const viewer = viewerRef.current;
        const tooltip = tooltipRef.current;
        if (fireEntity && viewer && tooltip) {
          const pos = Cesium.Cartesian3.fromDegrees(fireEntity.coordinates[0], fireEntity.coordinates[1], 0);
          const screenPos = viewer.scene.cartesianToCanvasCoordinates(pos);
          console.log('[AutoTooltip] Showing tooltip at', screenPos?.x, screenPos?.y);
          if (screenPos) {
            autoTooltipShowingRef.current = true;
            const statusText = fireEntity.status === 'danger' ? '危险' : fireEntity.status === 'warning' ? '警告' : '正常';
            tooltip.style.display = 'block';
            tooltip.style.left = screenPos.x + 150 + 'px';
            tooltip.style.top = screenPos.y + 150 + 'px';
            tooltip.innerHTML = `
              <div style="color: #FF4444; font-size: 11px; margin-bottom: 4px;">🔔 火情事件已发现</div>
              <div style="color: #EAEAEA; font-weight: 600; margin-bottom: 4px;">${fireEntity.name || '火情'}</div>
              <div style="color: #8888AA; font-size: 12px;">类型: 火情</div>
              <div style="color: ${fireEntity.color || '#FF4444'}; font-size: 12px;">状态: ${statusText}</div>
              <div style="color: ${fireEntity.color || '#FF4444'}; font-size: 11px; margin-top: 2px;">📍 事件关联数据</div>
            `;
            document.body.style.cursor = 'pointer';
            setTimeout(() => {
              autoTooltipShowingRef.current = false;
              tooltip.style.display = 'none';
              document.body.style.cursor = 'default';
            }, 10000);
          }
        }
      }
    }

    syncOilDiffusion();
  }, [
    entities,
    eventGisDataList,
    activeLayers,
    denseCells,
    billboardGlowHighlightProp,
    pulseRingDemoAllProp,
    showPointLabelsProp,
    mapLikePointStyle,
    syncOilDiffusion,
  ]);

  useEffect(() => {
    syncEntities();
  }, [syncEntities]);

  // 同步轨迹
  const syncTrajectories = useCallback(() => {
    const ds = dataSourcesRef.current;
    if (!ds) return;

    const getEventColorHex = (eventId: string) => {
      const index = eventGisDataList.findIndex((g) => g.eventId === eventId);
      return EVENT_COLORS[index % EVENT_COLORS.length];
    };

    const isTrajectoryActive = activeLayers.has('trajectory');

    // 事件侧轨迹 id → 只由 eventTrajectory 数据源绘制（避免与基础层双线叠画 z-fighting 闪烁）
    const eventPathMap = new Map<string, { traj: Trajectory; eventId: string }>();
    eventGisDataList.forEach((gisData) => {
      gisData.trajectories?.forEach((traj: Trajectory) => {
        if (!eventPathMap.has(traj.id)) {
          eventPathMap.set(traj.id, { traj, eventId: gisData.eventId! });
        }
      });
    });

    /** mock 油污溯源 5 艘候选船轨迹固定色（按 traj.id 匹配） */
    const TRAJECTORY_COLOR_MAP: Record<string, string> = {
      'ais-traj-413567890': '#FF4444', // 远洋货轮01 — 红
      'ais-traj-431758432': '#FFAA00', // KOBE STAR — 橙
      'ais-traj-440912756': '#00E0FF', // DAEYANG VICTORY — 青
      'ais-traj-357654321': '#44FF44', // OCEAN PEARL — 绿
      'ais-traj-412987654': '#FF44FF', // 浙象渔18866 — 粉
    };

    const flowArrowUrl = resolvePublicAssetUrl(FLOW_ARROW_TEXTURE_URL);

    const baseRows: TrajectoryPolylineSyncRow[] = [];
    if (isTrajectoryActive) {
      for (const traj of trajectories) {
        if (traj.coordinates.length < 2) continue;
        if (eventPathMap.has(traj.id)) continue;
        const trajId = String(traj.id);
        const isDriftPath = isOilSpillDriftPathId(trajId);
        const hex = isDriftPath
          ? OIL_SPILL_BROWN_HEX
          : TRAJECTORY_COLOR_MAP[trajId];
        const color = hex ? Cesium.Color.fromCssColorString(hex) : Cesium.Color.WHITE;
        const isFlow = isOilSpillFlowTrajectoryId(trajId);
        baseRows.push({
          id: trajId,
          positions: trajectoryCartesiansFromCoords(traj.coordinates as [number, number][]),
          width: isFlow ? TRAJECTORY_FLOW_LINE_WIDTH : TRAJECTORY_BASE_LINE_WIDTH,
          color,
          flow: isFlow ? buildOilSpillFlowMaterial(color, flowArrowUrl) : undefined,
        });
      }
    }

    const eventRows: TrajectoryPolylineSyncRow[] = [];
    for (const { traj, eventId } of eventPathMap.values()) {
      if (traj.coordinates.length < 2) continue;
      const trajId = String(traj.id);
      const isDriftPath = isOilSpillDriftPathId(trajId);
      const fixedHex = isDriftPath
        ? OIL_SPILL_BROWN_HEX
        : TRAJECTORY_COLOR_MAP[trajId];
      const color = Cesium.Color.fromCssColorString(fixedHex ?? getEventColorHex(eventId));
      const isFlow = isOilSpillFlowTrajectoryId(trajId);
      eventRows.push({
        id: trajId,
        positions: trajectoryCartesiansFromCoords(traj.coordinates as [number, number][]),
        width: isFlow ? TRAJECTORY_FLOW_LINE_WIDTH : TRAJECTORY_EVENT_LINE_WIDTH,
        color,
        flow: isFlow ? buildOilSpillFlowMaterial(color, flowArrowUrl) : undefined,
      });
    }

    syncTrajectoryPolylineEntities(ds.trajectory.entities, baseRows);
    syncTrajectoryPolylineEntities(ds.eventTrajectory.entities, eventRows);

    // 流动 AIS 轨迹：抬升数据源绘制顺序，保证叠在区域面与船舶点层之上
    const hasFlowTrajectories = [...baseRows, ...eventRows].some((r) => r.flow);
    const viewer = viewerRef.current;
    if (viewer && hasFlowTrajectories) {
      viewer.dataSources.raise(ds.trajectory);
      viewer.dataSources.raise(ds.eventTrajectory);
      viewer.dataSources.raise(ds.trajectoryArrow);
    }

    // 轨迹方向箭头：放在最后一段中点，指向航向（增量同步，避免 removeAll 闪烁）
    const allRows = [...baseRows, ...eventRows];
    const arrowDesiredIds = new Set(allRows.map((r) => `arrow-${r.id}`));
    for (const e of [...ds.trajectoryArrow.entities.values]) {
      if (!arrowDesiredIds.has(String(e.id))) {
        ds.trajectoryArrow.entities.removeById(e.id);
      }
    }
    for (const row of allRows) {
      if (row.positions.length < 2) continue;
      // 流动材质已沿全程显示方向箭头，不再叠加末端 billboard
      if (row.flow) continue;
      const arrowId = `arrow-${row.id}`;
      const last = row.positions.length - 1;
      const p1 = row.positions[last - 1];
      const p2 = row.positions[last];

      const existing = ds.trajectoryArrow.entities.getById(arrowId);
      type ArrowCache = { p1: Cesium.Cartesian3; p2: Cesium.Cartesian3; color: Cesium.Color };
      const cache = existing ? (existing as unknown as { _arrowCache?: ArrowCache })._arrowCache : undefined;
      const changed = !cache || !Cesium.Cartesian3.equals(cache.p1, p1) || !Cesium.Cartesian3.equals(cache.p2, p2) || !cache.color.equals(row.color);

      if (!changed && existing) continue;

      const c1 = Cesium.Cartographic.fromCartesian(p1);
      const c2 = Cesium.Cartographic.fromCartesian(p2);
      const dx = Cesium.Math.toDegrees(c2.longitude - c1.longitude);
      const dy = Cesium.Math.toDegrees(c2.latitude - c1.latitude);
      const headingRad = Math.atan2(dx, dy);
      const midLng = Cesium.Math.toDegrees((c1.longitude + c2.longitude) / 2);
      const midLat = Cesium.Math.toDegrees((c1.latitude + c2.latitude) / 2);
      const midPos = Cesium.Cartesian3.fromDegrees(midLng, midLat, 0);

      let entity: Cesium.Entity;
      if (!existing) {
        entity = ds.trajectoryArrow.entities.add({
          id: arrowId,
          position: midPos,
          billboard: {
            image: ARROW_SVG_URI,
            rotation: -headingRad,
            color: row.color,
            scale: 0.5,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      } else {
        entity = existing;
        entity.position = new Cesium.ConstantPositionProperty(midPos);
        if (entity.billboard) {
          entity.billboard.rotation = new Cesium.ConstantProperty(-headingRad);
          entity.billboard.color = new Cesium.ConstantProperty(row.color);
        }
      }

      (entity as unknown as { _arrowCache: ArrowCache })._arrowCache = {
        p1, p2: p2.clone(), color: row.color.clone(),
      };
    }
  }, [trajectories, eventGisDataList, activeLayers]);

  useEffect(() => {
    syncTrajectories();
  }, [syncTrajectories]);

  // 同步区域（包含 eventGisDataList 中的 regions）
  const syncRegions = useCallback(() => {
    const ds = dataSourcesRef.current;
    if (!ds) return;

    ds.region.entities.removeAll();

    // 合并基础 regions 和 eventGisDataList 中的 regions，按 id 去重
    const allRegions: Region[] = [...regions];
    eventGisDataList.forEach((gisData) => {
      gisData.regions?.forEach((region: Region) => {
        allRegions.push(region);
      });
    });
    const seenRegionIds = new Set<string>();
    const uniqueRegions = allRegions.filter((r) => {
      if (seenRegionIds.has(r.id)) return false;
      seenRegionIds.add(r.id);
      return true;
    });

    const lightWallRegions = uniqueRegions.filter((r) => isRegionLightWall(r));
    const activeLightWallIds = new Set(lightWallRegions.map((r) => r.id));
    const wallPrimitives = regionLightWallPrimitivesRef.current;
    if (wallPrimitives) {
      for (let i = wallPrimitives.length - 1; i >= 0; i--) {
        const p = wallPrimitives.get(i);
        if (!(p instanceof Cesium.Primitive)) continue;
        const rid = (p as unknown as Record<string, string | undefined>).__regionLightWallId;
        if (rid && !activeLightWallIds.has(rid)) {
          wallPrimitives.remove(p);
        }
      }
    }

    const showEastChinaSea = uniqueRegions.some((r) => r.id === EAST_CHINA_SEA_REGION_ID);
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed()) {
      if (showEastChinaSea && !eastChinaSeaGeoJsonRef.current) {
        void Cesium.GeoJsonDataSource.load(resolveEastChinaSeaGeoJsonUrl(), {
          stroke: Cesium.Color.fromCssColorString('#0064FF').withAlpha(0.95),
          fill: Cesium.Color.TRANSPARENT,
          strokeWidth: 2,
          clampToGround: false,
        })
          .then((eastDs) => {
            if (viewer.isDestroyed() || eastChinaSeaGeoJsonRef.current) {
              (eastDs as unknown as { destroy(): void }).destroy();
              return;
            }
            viewer.dataSources.add(eastDs);
            eastChinaSeaGeoJsonRef.current = eastDs;
          })
          .catch((err) => {
            console.warn(
              '[Cesium] eastern_china_sea.geojson 加载失败（请确认 public/geo/eastern_china_sea.geojson 存在）:',
              err
            );
          });
      } else if (!showEastChinaSea && eastChinaSeaGeoJsonRef.current) {
        viewer.dataSources.remove(eastChinaSeaGeoJsonRef.current, true);
        eastChinaSeaGeoJsonRef.current = null;
      }
    }

    uniqueRegions.forEach((region: Region) => {
      if (region.id === EAST_CHINA_SEA_REGION_ID) {
        const labelDef = (region as Region & { label?: { text: string; position?: [number, number] } })
          .label;
        if (labelDef?.text && labelDef.position) {
          const [lng, lat] = labelDef.position;
          const labelId = `region-label-${region.id}`;
          ds.region.entities.removeById(labelId);
          ds.region.entities.add({
            id: labelId,
            position: Cesium.Cartesian3.fromDegrees(lng, lat, 0),
            label: {
              text: labelDef.text,
              font: 'bold 16px "Microsoft YaHei", sans-serif',
              fillColor: Cesium.Color.fromCssColorString('#0064FF'),
              outlineColor: MAP_LABEL_OUTLINE_COLOR,
              outlineWidth: MAP_LABEL_OUTLINE_WIDTH,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              scaleByDistance: REGION_LABEL_SCALE,
              translucencyByDistance: REGION_LABEL_FADE,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
        }
        return;
      }

      if (isRegionLightWall(region)) {
        syncRegionLightWall(
          ds.region.entities,
          wallPrimitives,
          region,
          mapLikePointStyle
        );
        const labelDef = (region as Region & { label?: { text: string; position?: [number, number] } })
          .label;
        if (labelDef?.text) {
          const outlineColor =
            (region.style as { outlineColor?: string } | undefined)?.outlineColor ?? '#ff2a2a';
          const labelPos =
            labelDef.position ?? [
              region.coordinates.reduce((sum, [lng]) => sum + lng, 0) / region.coordinates.length,
              region.coordinates.reduce((sum, [, lat]) => sum + lat, 0) / region.coordinates.length,
            ];
          ds.region.entities.add({
            id: `region-label-${region.id}`,
            position: Cesium.Cartesian3.fromDegrees(labelPos[0], labelPos[1], 0),
            label: {
              text: labelDef.text,
              font: 'bold 16px "Microsoft YaHei", sans-serif',
              fillColor: Cesium.Color.fromCssColorString(outlineColor),
              outlineColor: MAP_LABEL_OUTLINE_COLOR,
              outlineWidth: MAP_LABEL_OUTLINE_WIDTH,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              scaleByDistance: REGION_LABEL_SCALE,
              translucencyByDistance: REGION_LABEL_FADE,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
        }
        return;
      }

      if (region.coordinates.length < 2) return;

      const hierarchy = region.coordinates.map(([lng, lat]) =>
        Cesium.Cartesian3.fromDegrees(lng, lat, 0)
      );

      // 默认样式按 region.type 区分；region.style 优先覆盖
      const typeDefaults =
        region.type === 'control'
          ? { fill: true, fillColor: 'rgba(255, 68, 68, 0.2)', outlineColor: '#FF4444', outlineWidth: 2 }
          : region.type === 'monitor'
            ? { fill: true, fillColor: 'rgba(255, 170, 0, 0.2)', outlineColor: '#FFAA00', outlineWidth: 2 }
            : { fill: true, fillColor: 'rgba(0, 224, 255, 0.2)', outlineColor: '#00E0FF', outlineWidth: 2 };

      const s = (region as Region & { style?: { fill?: boolean; fillColor?: string; outlineColor?: string; outlineWidth?: number } }).style ?? {};
      const fill = s.fill ?? typeDefaults.fill;
      const fillColor = s.fillColor ?? typeDefaults.fillColor;
      const outlineColor = s.outlineColor ?? typeDefaults.outlineColor;
      const outlineWidth = s.outlineWidth ?? typeDefaults.outlineWidth;

      // 用 polyline 画闭合边框（width 在 Cesium 中比 polygon outline 更可靠）
      const closed = [...hierarchy, hierarchy[0]];
      ds.region.entities.add({
        polyline: {
          positions: closed,
          width: outlineWidth,
          material: Cesium.Color.fromCssColorString(outlineColor),
          clampToGround: true,
        },
        ...(fill
          ? {
              polygon: {
                hierarchy: new Cesium.PolygonHierarchy(hierarchy),
                material: Cesium.Color.fromCssColorString(fillColor),
                outline: false,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
            }
          : {}),
      });

      // 可选 label：region.label.text 必填，position 缺省时用 coordinates 几何中心
      const labelDef = (region as Region & { label?: { text: string; position?: [number, number] } }).label;
      if (labelDef?.text) {
        const labelPos =
          labelDef.position ?? [
            region.coordinates.reduce((sum, [lng]) => sum + lng, 0) / region.coordinates.length,
            region.coordinates.reduce((sum, [, lat]) => sum + lat, 0) / region.coordinates.length,
          ];
        ds.region.entities.add({
          position: Cesium.Cartesian3.fromDegrees(labelPos[0], labelPos[1], 0),
          label: {
            text: labelDef.text,
            font: 'bold 16px "Microsoft YaHei", sans-serif',
            fillColor: Cesium.Color.fromCssColorString(outlineColor),
            outlineColor: MAP_LABEL_OUTLINE_COLOR,
            outlineWidth: MAP_LABEL_OUTLINE_WIDTH,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            scaleByDistance: REGION_LABEL_SCALE,
            translucencyByDistance: REGION_LABEL_FADE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }
    });

    syncOilDiffusion();
  }, [regions, eventGisDataList, mapLikePointStyle, syncOilDiffusion]);

  useEffect(() => {
    syncRegions();
  }, [syncRegions]);

  // eventGisDataList 中的 region 自动 flyTo
  const lastEventGisLengthRef = useRef(0);
  const lastGisLenForFireRef = useRef(0);
  const autoTooltipShowingRef = useRef(false);
  const opLayersRef = useRef<Map<string, string>>(new Map()); // id -> entityId

  useEffect(() => {
    // 只在 eventGisDataList 新增时触发（避免重复 flyTo）
    if (eventGisDataList.length <= lastEventGisLengthRef.current) {
      lastEventGisLengthRef.current = eventGisDataList.length;
      return;
    }
    lastEventGisLengthRef.current = eventGisDataList.length;

    // 只 flyTo 最新添加的 gisData（避免无 cameraView 的 gisData push 后 findLast 又飞回旧位置）
    const latestGisData = eventGisDataList[eventGisDataList.length - 1];
    if (!latestGisData?.cameraView) return;
    const cv = latestGisData.cameraView;

    // Viewer 未初始化：只缓存最新的 flyTo 请求（避免多个步骤的 flyTo 依次执行互相覆盖）
    const viewer = viewerRef.current;
    if (!viewer) {
      if (cv.type === 'point') {
        pendingFlyToRef.current.push({ lng: cv.lng, lat: cv.lat, altitude: cv.altitude });
        console.log(`[CesiumMap] Viewer not ready, cached flyTo: (${cv.lng}, ${cv.lat}) @ ${cv.altitude}m, queue=${pendingFlyToRef.current.length}`);
      }
      return;
    }

    if (cv.type === 'point') {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(cv.lng, cv.lat, cv.altitude),
        duration: 1.5,
      });
      console.log(`[CesiumMap] Auto flyTo cameraView point: (${cv.lng}, ${cv.lat}) @ ${cv.altitude}m`);
    } else if (cv.type === 'fit-bbox') {
      const { west, south, east, north } = cv.bbox;
      const padding = cv.padding ?? 0.2;
      const centerLng = (west + east) / 2;
      const centerLat = (south + north) / 2;
      const maxDim = Math.max(east - west, north - south);
      let altitude = maxDim * 150000 * (1 + padding);
      if (altitude < 5000) altitude = 5000;
      if (altitude > 10000000) altitude = 10000000;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(centerLng, centerLat, altitude),
        duration: 1.5,
      });
      console.log(`[CesiumMap] Auto flyTo cameraView fit-bbox: (${centerLng.toFixed(2)}, ${centerLat.toFixed(2)}) @ ${Math.round(altitude / 1000)}km`);
    }
  }, [eventGisDataList]);

  // 图层显隐控制
  useEffect(() => {
    const ds = dataSourcesRef.current;
    if (!ds) return;
    ds.base.show = activeLayers.has('ais') || activeLayers.has('ads') || activeLayers.has('base');
    ds.trajectory.show = activeLayers.has('trajectory');
    ds.trajectoryArrow.show = activeLayers.has('trajectory');
    ds.region.show = true;
    ds.dense.show = true;
    ds.ring.show = true;
    ds.oilDiffusion.show = true;
    ds.event.show = true;
    ds.eventTrajectory.show = true;
    ds.glowBillboard.show =
      billboardGlowHighlightProp?.enabled === true && (ds.base.show || ds.event.show);
  }, [activeLayers, billboardGlowHighlightProp]);

  // 样式切换
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    // 移除所有现有 imagery layers
    while (viewer.imageryLayers.length > 0) {
      viewer.imageryLayers.remove(viewer.imageryLayers.get(0));
    }

    // 清除之前的本地瓦片边界线
    for (const id of localTileOutlinesRef.current) {
      viewer.entities.removeById(id);
    }
    localTileOutlinesRef.current = [];

    if (currentStyle === 'local-mixed') {
      // 混合模式：网络底图兜底 + 本地区域瓦片叠加
      const baseProvider = getStyleById('blue-marble').createImageryProvider();
      viewer.imageryLayers.add(new Cesium.ImageryLayer(baseProvider));

      // 叠加北京、怀来、新疆区域高清瓦片
      const overlayIds = ['local-beijing', 'local-huailai', 'local-xinjiang'];
      for (const id of overlayIds) {
        const config = getLocalConfigById(id);
        if (config) {
          viewer.imageryLayers.add(new Cesium.ImageryLayer(createLocalImageryProvider(config)));
        }
      }

      // 标注本地瓦片范围
      const outlines = [
        { name: '北京', rect: Cesium.Rectangle.fromDegrees(116.04, 39.82, 116.51, 40.29), color: Cesium.Color.CYAN },
        { name: '怀来', rect: Cesium.Rectangle.fromDegrees(115.35, 40.15, 115.83, 40.44), color: Cesium.Color.LIME },
        { name: '新疆', rect: Cesium.Rectangle.fromDegrees(79.5, 41.5, 82.0, 46.0), color: Cesium.Color.ORANGE },
      ];
      for (const o of outlines) {
        const entity = viewer.entities.add({
          id: `local-outline-${o.name}`,
          rectangle: {
            coordinates: o.rect,
            outline: true,
            outlineColor: o.color,
            outlineWidth: 3,
            fill: false,
            classificationType: Cesium.ClassificationType.TERRAIN,
          },
        });
        localTileOutlinesRef.current.push(entity.id);
      }
    } else {
      const style = getStyleById(currentStyle);
      const newProvider = style.createImageryProvider();
      viewer.imageryLayers.add(new Cesium.ImageryLayer(newProvider));
    }
  }, [currentStyle]);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

  const eventImageOverlays = useMemo(() => {
    const overlays: SingleTileOverlaySpec[] = [];
    for (const gis of eventGisDataList) {
      if (gis.imageOverlays) {
        for (const img of gis.imageOverlays) {
          const url = img.url.startsWith("http") ? img.url : `${API_BASE}${img.url}`;
          console.log(`[CesiumMap] imageOverlay: ${img.id} → ${url}`);
          overlays.push({
            id: img.id,
            url,
            rectangle: img.rectangle,
            alpha: img.alpha,
            tileWidth: img.tileWidth,
            tileHeight: img.tileHeight,
          });
        }
      }
    }
    if (overlays.length === 0) {
      console.log('[CesiumMap] No imageOverlays in eventGisDataList');
    }
    return overlays;
  }, [eventGisDataList]);

  const singleTileOverlays = useMemo(() => {
    return [...(singleTileOverlaysProp ?? EMPTY_SINGLE_TILE_OVERLAYS), ...eventImageOverlays];
  }, [singleTileOverlaysProp, eventImageOverlays]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const bucket = singleTileImageryLayersRef.current;
    for (const layer of bucket.values()) {
      viewer.imageryLayers.remove(layer, true);
    }
    bucket.clear();

    for (const spec of singleTileOverlays) {
      try {
        const rectangle = Cesium.Rectangle.fromDegrees(
          spec.rectangle.west,
          spec.rectangle.south,
          spec.rectangle.east,
          spec.rectangle.north
        );
        const provider = new Cesium.SingleTileImageryProvider({
          url: spec.url,
          rectangle,
          tileWidth: spec.tileWidth ?? SINGLE_TILE_DEFAULT_PIXEL_W,
          tileHeight: spec.tileHeight ?? SINGLE_TILE_DEFAULT_PIXEL_H,
        });
        const layer = new Cesium.ImageryLayer(provider, {
          alpha: spec.alpha ?? 1,
        });
        viewer.imageryLayers.add(layer);
        bucket.set(spec.id, layer);
      } catch (e) {
        console.warn('[CesiumMap] SingleTile overlay skipped:', spec.id, e);
      }
    }

    return () => {
      for (const layer of bucket.values()) {
        viewer.imageryLayers.remove(layer, true);
      }
      bucket.clear();
    };
  }, [currentStyle, singleTileOverlays]);

  // 选中实体 flyTo
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !selectedEntity) return;

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        selectedEntity.coordinates[0],
        selectedEntity.coordinates[1],
        500000 // 500km 高度
      ),
      duration: 1,
    });
  }, [selectedEntity]);

  useImperativeHandle(ref, () => ({
    clearPersistedMapDraw: () => {
      mapDrawPersistedRef.current?.entities.removeAll();
    },
    resetView: () => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(105, 35, 20000000),
        duration: 1,
      });
    },
    toggleSceneMode: () => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) return;

      const rect = captureVisibleGeographicRectangle(viewer);

      let restoreStarted = false;
      const startRestore = () => {
        if (restoreStarted || !rect || viewer.isDestroyed()) return;
        restoreStarted = true;
        restoreCameraToRectangleWhenSceneStable(viewer, rect);
      };

      const removeListener = viewer.scene.morphComplete.addEventListener(() => {
        removeListener();
        startRestore();
      });

      if (viewer.scene.mode === Cesium.SceneMode.SCENE2D) {
        viewer.scene.morphTo3D(0);
      } else {
        viewer.scene.morphTo2D(0);
      }

      // morphTo*(0) 在部分环境下 morphComplete 不可靠：进入 2D/3D 后再兜底触发一次恢复
      window.setTimeout(() => {
        if (viewer.isDestroyed() || !rect) return;
        if (
          viewer.scene.mode === Cesium.SceneMode.SCENE2D ||
          viewer.scene.mode === Cesium.SceneMode.SCENE3D
        ) {
          startRestore();
        }
      }, 0);
      window.setTimeout(() => {
        if (viewer.isDestroyed() || !rect) return;
        if (
          viewer.scene.mode === Cesium.SceneMode.SCENE2D ||
          viewer.scene.mode === Cesium.SceneMode.SCENE3D
        ) {
          startRestore();
        }
      }, 120);
    },
    flyToRegion: (lng: number, lat: number, altitude: number) => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lng, lat, altitude),
        duration: 1.5,
      });
    },
    showFireOverlay: () => {
      const viewer = viewerRef.current;
      if (!viewer) return;

      // 避免重复添加
      if (fireOverlayRef.current) return;

      // 灾后影像
      const overlayLayer = new Cesium.ImageryLayer(createFireOverlayProvider());
      viewer.imageryLayers.add(overlayLayer);
      fireOverlayRef.current = overlayLayer;

      // 烧毁遮罩（半透明红色）
      const maskLayer = new Cesium.ImageryLayer(createFireMaskProvider(), {
        alpha: 0.6,
      });
      viewer.imageryLayers.add(maskLayer);
      fireMaskRef.current = maskLayer;

      // 火灾区域红色边界线
      if (!fireOutlineIdRef.current) {
        const outline = viewer.entities.add({
          id: 'fire-outline',
          rectangle: {
            coordinates: Cesium.Rectangle.fromDegrees(76.967, 43.241, 77.029, 43.286),
            outline: true,
            outlineColor: Cesium.Color.RED,
            outlineWidth: 4,
            fill: false,
            classificationType: Cesium.ClassificationType.TERRAIN,
          },
        });
        fireOutlineIdRef.current = outline.id;
      }

      // 火情 overlay 的 flyTo 已移除，视角统一由 gisData.cameraView 控制，与漏油场景保持一致
    },
    hideFireOverlay: () => {
      const viewer = viewerRef.current;
      if (!viewer) return;

      if (fireOverlayRef.current) {
        viewer.imageryLayers.remove(fireOverlayRef.current);
        fireOverlayRef.current = null;
      }

      if (fireMaskRef.current) {
        viewer.imageryLayers.remove(fireMaskRef.current);
        fireMaskRef.current = null;
      }

      if (fireOutlineIdRef.current) {
        viewer.entities.removeById(fireOutlineIdRef.current);
        fireOutlineIdRef.current = null;
      }
    },
    executeOperation: (op: GisOperation) => {
      const viewer = viewerRef.current;
      if (!viewer) return;

      if (op.type === 'flyTo') {
        let lng: number;
        let lat: number;
        let altitude = op.altitude ?? 2000000;

        if (op.bounds) {
          const { west, south, east, north } = op.bounds;
          lng = (west + east) / 2;
          lat = (south + north) / 2;
          // 根据区域大小调整高度：区域越大，高度越高
          const width = east - west;
          const height = north - south;
          const maxDim = Math.max(width, height);
          // 若调用方显式指定 altitude，优先使用；否则按区域大小自动计算
          if (op.altitude == null) {
            altitude = maxDim * 150000;
            if (altitude < 100000) altitude = 100000;
            if (altitude > 10000000) altitude = 10000000;
          }
        } else if (op.coordinates) {
          const c = op.coordinates;
          if (Array.isArray(c[0])) {
            console.warn('[CesiumMap] flyTo expected a single [lng, lat] pair');
            return;
          }
          [lng, lat] = c as [number, number];
        } else {
          console.warn('[CesiumMap] flyTo operation missing bounds or coordinates');
          return;
        }

        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lng, lat, altitude),
          duration: op.duration ?? 1.5,
        });
        console.log(`[CesiumMap] flyTo: lng=${lng.toFixed(2)}, lat=${lat.toFixed(2)}, altitude=${altitude}`);
      }

      if (op.type === 'renderLayer') {
        const layerId = op.id;
        const coords = Array.isArray(op.coordinates?.[0])
          ? (op.coordinates as Array<[number, number]>)
          : undefined;
        const style = op.style ?? {};
        const label = op.label;
        if (!layerId || !coords || coords.length < 3) {
          console.warn('[CesiumMap] renderLayer missing id or coordinates (≥3 points)');
          return;
        }

        // 清理同名旧 layer（边框 + label）
        const oldEntityId = opLayersRef.current.get(layerId);
        if (oldEntityId) {
          viewer.entities.removeById(oldEntityId);
          viewer.entities.removeById(`${oldEntityId}-label`);
          opLayersRef.current.delete(layerId);
        }

        const positions = coords.map(([lng, lat]) => Cesium.Cartesian3.fromDegrees(lng, lat, 0));
        const closedPositions = [...positions, positions[0]];

        const fill = style.fill !== false;
        const outlineColor = (style.outlineColor as string) ?? '#0064FF';
        const outlineWidth = typeof style.outlineWidth === 'number' ? style.outlineWidth : 4;

        // 用 polyline 画闭合边框（width 在 Cesium 中比 polygon outline 更可靠）
        const entityId = `op-layer-${layerId}`;
        const entity = viewer.entities.add({
          id: entityId,
          polyline: {
            positions: closedPositions,
            width: outlineWidth,
            material: Cesium.Color.fromCssColorString(outlineColor),
            clampToGround: true,
          },
          // 可选填充层
          ...(fill ? {
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(positions),
              material: Cesium.Color.fromCssColorString((style.fillColor as string) ?? 'rgba(0, 100, 255, 0.15)'),
              outline: false,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
          } : {}),
        });
        opLayersRef.current.set(layerId, entity.id);

        // 添加 label
        if (label?.text && label?.position) {
          const [labelLng, labelLat] = label.position;
          viewer.entities.add({
            id: `${entityId}-label`,
            position: Cesium.Cartesian3.fromDegrees(labelLng, labelLat, 0),
            label: {
              text: label.text,
              font: 'bold 16px "Microsoft YaHei", sans-serif',
              fillColor: Cesium.Color.fromCssColorString(outlineColor),
              outlineColor: MAP_LABEL_OUTLINE_COLOR,
              outlineWidth: MAP_LABEL_OUTLINE_WIDTH,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(0, 0),
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              scaleByDistance: REGION_LABEL_SCALE,
              translucencyByDistance: REGION_LABEL_FADE,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
        }

        console.log(`[CesiumMap] renderLayer: ${layerId}, coords=${coords.length}, label=${label?.text ?? 'none'}`);
      }
    },
    getCurrentCameraParams: () => {
      const viewer = viewerRef.current;
      if (!viewer) return null;
      const carto = viewer.camera.positionCartographic;
      return {
        lng: Cesium.Math.toDegrees(carto.longitude),
        lat: Cesium.Math.toDegrees(carto.latitude),
        altitude: carto.height,
        heading: Cesium.Math.toDegrees(viewer.camera.heading),
        pitch: Cesium.Math.toDegrees(viewer.camera.pitch),
        roll: Cesium.Math.toDegrees(viewer.camera.roll),
      };
    },
    getViewer: () => viewerRef.current,
  }));

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full min-h-0 min-w-0"
      style={{ width: '100%', height: '100%', background: '#0a0a1a' }}
    />
  );
});

export default CesiumMap;
