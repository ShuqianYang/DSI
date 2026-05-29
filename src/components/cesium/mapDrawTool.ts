import * as Cesium from 'cesium';
import Drawer, { defaultOptions as drawerDefaultOptions } from '@cesium-extends/drawer';
import type { Entity, GisData } from '@/types/prd';
import type { MapDrawMode, MapDrawResult } from '@/types/mapDraw';
import { collectEntitiesInPolygon, collectEntitiesInRectangle } from '@/lib/mapDrawCollectEntities';

export interface MapDrawCollectContext {
  entities: Entity[];
  eventGisDataList: GisData[];
  denseCells: Array<{ minLng: number; maxLng: number; minLat: number; maxLat: number; count: number }>;
  activeLayers: Set<string>;
}

export interface AttachMapDrawToolContext {
  viewer: Cesium.Viewer;
  drawDataSource: Cesium.CustomDataSource;
  mode: Exclude<MapDrawMode, 'none'>;
  /** 取最新业务数据，避免 effect 依赖 entities 导致绘制中途卸载 handler */
  getCollectCtx: () => MapDrawCollectContext;
  onComplete: (result: MapDrawResult) => void;
}

const PREVIEW_COLOR = Cesium.Color.fromCssColorString('#00E0FF').withAlpha(0.55);
const OUTLINE_COLOR = Cesium.Color.fromCssColorString('#00E0FF');

/** 点击落点：优先地形，其次椭球。 */
function pickCartesian(viewer: Cesium.Viewer, screenPosition: Cesium.Cartesian2): Cesium.Cartesian3 | undefined {
  const ray = viewer.camera.getPickRay(screenPosition);
  if (!ray) return undefined;
  const globeHit = viewer.scene.globe.pick(ray, viewer.scene);
  if (globeHit) return globeHit;
  return viewer.camera.pickEllipsoid(screenPosition, viewer.scene.globe.ellipsoid) ?? undefined;
}

function cartesianToLngLat(c: Cesium.Cartesian3): [number, number] {
  const carto = Cesium.Cartographic.fromCartesian(c);
  return [Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)];
}

function requestDrawFrame(viewer: Cesium.Viewer) {
  viewer.scene.requestRender();
}

function dedupeConsecutiveLngLat(coords: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  const eps = 1e-12;
  for (const [lng, lat] of coords) {
    const prev = out[out.length - 1];
    if (!prev || Math.abs(prev[0] - lng) > eps || Math.abs(prev[1] - lat) > eps) {
      out.push([lng, lat]);
    }
  }
  return out;
}

/**
 * 折线 / 面：使用社区库 @cesium-extends/drawer（椭球选点 terrain:false，预览更稳）。
 * 操作：左键加点，双击撤销上一点，右键结束（与原右键结束一致；撤销改为双击）。
 */
function attachCesiumExtendsPolyDraw(
  ctx: AttachMapDrawToolContext,
  drawType: 'POLYLINE' | 'POLYGON'
): () => void {
  const { viewer, onComplete, getCollectCtx } = ctx;

  const drawer = new Drawer(viewer, {
    terrain: false,
    model: false,
    operateType: {
      START: 'LEFT_CLICK',
      MOVING: 'MOUSE_MOVE',
      CANCEL: 'LEFT_DOUBLE_CLICK',
      END: 'RIGHT_CLICK',
    },
    sameStyle: true,
    tips: {
      init: '左键添加顶点',
      start: '左键加点，双击撤销上一点，右键完成',
      end: '',
    },
    dynamicGraphicsOptions: {
      ...drawerDefaultOptions.dynamicGraphicsOptions,
      POLYLINE: {
        ...drawerDefaultOptions.dynamicGraphicsOptions.POLYLINE,
        clampToGround: false,
        width: 4,
        material: OUTLINE_COLOR,
        arcType: Cesium.ArcType.GEODESIC,
      },
      POLYGON: {
        ...drawerDefaultOptions.dynamicGraphicsOptions.POLYGON,
        outlineColor: OUTLINE_COLOR,
        outlineWidth: 2,
        material: PREVIEW_COLOR.withAlpha(0.22),
      },
    },
  });

  const startOpts = {
    type: drawType,
    once: true,
    oneInstance: true,
    onEnd: (_entity: Cesium.Entity, cartesians: Cesium.Cartesian3[]) => {
      const coords = dedupeConsecutiveLngLat(cartesians.map(cartesianToLngLat));
      if (drawType === 'POLYLINE') {
        if (coords.length < 2) return;
        onComplete({ kind: 'polyline', coordinates: coords });
        return;
      }
      if (coords.length < 3) return;
      const entitiesByLayer = collectEntitiesInPolygon(coords, getCollectCtx());
      onComplete({ kind: 'polygon', coordinates: coords, entitiesByLayer });
    },
  };

  const kickoff = () => {
    drawer.start(startOpts, () => undefined);
  };

  kickoff();

  const preventCtx = (ev: Event) => ev.preventDefault();
  viewer.canvas.addEventListener('contextmenu', preventCtx);

  const onEsc = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    drawer.reset();
    kickoff();
  };
  window.addEventListener('keydown', onEsc);

  return () => {
    window.removeEventListener('keydown', onEsc);
    viewer.canvas.removeEventListener('contextmenu', preventCtx);
    drawer.destroy();
  };
}

/** 矩形：同库内逻辑——左键第一角点，移动拉框，右键完成（双击可撤销点）。 */
function attachCesiumExtendsRectangleDraw(ctx: AttachMapDrawToolContext): () => void {
  const { viewer, onComplete, getCollectCtx } = ctx;

  const drawer = new Drawer(viewer, {
    terrain: false,
    model: false,
    operateType: {
      START: 'LEFT_CLICK',
      MOVING: 'MOUSE_MOVE',
      CANCEL: 'LEFT_DOUBLE_CLICK',
      END: 'RIGHT_CLICK',
    },
    sameStyle: true,
    tips: {
      init: '左键确定矩形一角',
      start: '移动鼠标拉框，右键完成；双击撤销',
      end: '',
    },
    dynamicGraphicsOptions: {
      ...drawerDefaultOptions.dynamicGraphicsOptions,
      RECTANGLE: {
        ...drawerDefaultOptions.dynamicGraphicsOptions.RECTANGLE,
        material: PREVIEW_COLOR.withAlpha(0.32),
        outline: true,
        outlineColor: OUTLINE_COLOR,
        outlineWidth: 2,
      },
    },
  });

  const startOpts = {
    type: 'RECTANGLE' as const,
    once: true,
    oneInstance: true,
    onEnd: (entity: Cesium.Entity, _positions: Cesium.Cartesian3[]) => {
      const coordsProp = entity.rectangle?.coordinates;
      if (!coordsProp) return;
      const rect = coordsProp.getValue(Cesium.JulianDate.now());
      if (!rect) return;
      const west = Cesium.Math.toDegrees(rect.west);
      const east = Cesium.Math.toDegrees(rect.east);
      const south = Cesium.Math.toDegrees(rect.south);
      const north = Cesium.Math.toDegrees(rect.north);
      if (Math.abs(east - west) < 1e-8 || Math.abs(north - south) < 1e-8) return;
      const corners: [number, number][] = [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
      ];
      const entitiesByLayer = collectEntitiesInRectangle(west, south, east, north, getCollectCtx());
      onComplete({ kind: 'rectangle', west, south, east, north, corners, entitiesByLayer });
    },
  };

  const kickoff = () => {
    drawer.start(startOpts, () => undefined);
  };

  kickoff();

  const preventCtx = (ev: Event) => ev.preventDefault();
  viewer.canvas.addEventListener('contextmenu', preventCtx);

  const onEsc = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    drawer.reset();
    kickoff();
  };
  window.addEventListener('keydown', onEsc);

  return () => {
    window.removeEventListener('keydown', onEsc);
    viewer.canvas.removeEventListener('contextmenu', preventCtx);
    drawer.destroy();
  };
}

/** 挂载绘制交互；返回卸载函数（销毁 handler / Drawer、恢复相机） */
export function attachMapDrawTool(ctx: AttachMapDrawToolContext): () => void {
  const { viewer, drawDataSource: ds, mode, onComplete } = ctx;

  if (mode === 'polyline') return attachCesiumExtendsPolyDraw(ctx, 'POLYLINE');
  if (mode === 'polygon') return attachCesiumExtendsPolyDraw(ctx, 'POLYGON');
  if (mode === 'rectangle') return attachCesiumExtendsRectangleDraw(ctx);

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  const onEsc = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    ds.entities.removeAll();
  };
  window.addEventListener('keydown', onEsc);

  const finishCleanup = () => {
    window.removeEventListener('keydown', onEsc);
    handler.destroy();
  };

  if (mode === 'point') {
    handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const pos = pickCartesian(viewer, click.position);
      if (!pos) return;
      ds.entities.removeAll();
      ds.entities.add({
        position: pos,
        point: {
          pixelSize: 12,
          color: OUTLINE_COLOR,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      requestDrawFrame(viewer);
      onComplete({ kind: 'point', lngLat: cartesianToLngLat(pos) });
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    return finishCleanup;
  }

  return finishCleanup;
}
