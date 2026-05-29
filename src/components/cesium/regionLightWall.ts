import * as Cesium from 'cesium';
import type { Region } from '@/types/prd';

export const REGION_LIGHT_WALL_DEFAULTS = {
  color: '#ff2a2a',
  fillAlpha: 0.1,
  wallHeightMeters: 8_000,
  wallHeightMaxMeters: 22_000,
} as const;

const WALL_PREFIX = 'region-light-wall-';
const GROUND_PREFIX = 'region-light-ground-';

let wallMaterialRegistered = false;

function ensureWallMaterial(): void {
  if (wallMaterialRegistered) return;
  wallMaterialRegistered = true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Cesium.Material as any)._materialCache.addMaterial('RegionLightWall', {
    fabric: {
      type: 'RegionLightWall',
      uniforms: {
        color: new Cesium.Color(1, 0.15, 0.15, 0.88),
      },
      source: `
        czm_material czm_getMaterial(czm_materialInput materialInput)
        {
          czm_material material = czm_getDefaultMaterial(materialInput);
          vec2 st = materialInput.st;
          float vFade = pow(1.0 - st.t, 0.45);
          float streak = 0.72 + 0.28 * abs(sin(st.s * 72.0 + czm_frameNumber * 0.02));
          float pulse = 0.8 + 0.2 * sin(czm_frameNumber * 0.05);
          float alpha = color.a * vFade * streak * pulse;
          material.diffuse = color.rgb;
          material.emission = color.rgb * 0.85 * vFade * pulse;
          material.alpha = clamp(alpha, 0.0, 0.96);
          return material;
        }
      `,
    },
    translucent: () => true,
  });
}

export function isRegionLightWall(region: Region): boolean {
  const style = region.style as { effect?: string } | undefined;
  if (style?.effect === 'lightWall') return true;
  return (
    region.id === 'region-fire-news-border' ||
    region.id === 'fire-imagery-bounds' ||
    region.id === 'region-earthquake-assessment' ||
    region.id === 'region-flood-assessment'
  );
}

function ringLngLat(region: Region): [number, number][] {
  const coords = region.coordinates;
  if (coords.length < 3) return coords;
  const first = coords[0];
  const last = coords[coords.length - 1];
  const closed = first[0] === last[0] && first[1] === last[1];
  return closed ? coords.slice(0, -1) : coords;
}

function estimateWallHeightMeters(ring: [number, number][]): number {
  let minLng = ring[0][0];
  let maxLng = ring[0][0];
  let minLat = ring[0][1];
  let maxLat = ring[0][1];
  for (const [lng, lat] of ring) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const midLat = (minLat + maxLat) / 2;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos(Cesium.Math.toRadians(midLat));
  const widthM = (maxLng - minLng) * mPerDegLng;
  const heightM = (maxLat - minLat) * mPerDegLat;
  const diagonal = Math.sqrt(widthM * widthM + heightM * heightM);
  return Cesium.Math.clamp(
    diagonal * 0.04,
    REGION_LIGHT_WALL_DEFAULTS.wallHeightMeters,
    REGION_LIGHT_WALL_DEFAULTS.wallHeightMaxMeters
  );
}

function getPrimitiveWallId(regionId: string): string {
  return `${WALL_PREFIX}${regionId}`;
}

function isWallPrimitive(primitive: Cesium.Primitive, regionId: string): boolean {
  return (primitive as unknown as Record<string, string>).__regionLightWallId === regionId;
}

function setWallPrimitiveId(primitive: Cesium.Primitive, regionId: string): void {
  (primitive as unknown as Record<string, string>).__regionLightWallId = regionId;
}

/** 地面光晕 + 贴地填充（2D / 3D 通用） */
function syncGroundGlow(
  collection: Cesium.EntityCollection,
  region: Region,
  mapLikePoints: boolean
): void {
  const regionId = region.id;
  const ring = ringLngLat(region);
  const positions = ring.map(([lng, lat]) => Cesium.Cartesian3.fromDegrees(lng, lat, 0));
  const closed = [...positions, positions[0]];
  const baseColor = Cesium.Color.fromCssColorString(
    (region.style as { outlineColor?: string } | undefined)?.outlineColor ??
      REGION_LIGHT_WALL_DEFAULTS.color
  );
  const heightRef = mapLikePoints
    ? Cesium.HeightReference.NONE
    : Cesium.HeightReference.CLAMP_TO_GROUND;

  const fillId = `${GROUND_PREFIX}${regionId}-fill`;
  const existingFill = collection.getById(fillId);
  if (!existingFill) {
    collection.add({
      id: fillId,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: baseColor.withAlpha(REGION_LIGHT_WALL_DEFAULTS.fillAlpha),
        outline: false,
        heightReference: heightRef,
      },
    });
  }

  const softLayers = mapLikePoints
    ? [
        { width: 18, alpha: 0.22 },
        { width: 12, alpha: 0.38 },
        { width: 7, alpha: 0.55 },
      ]
    : [
        { width: 14, alpha: 0.2 },
        { width: 9, alpha: 0.35 },
        { width: 5, alpha: 0.5 },
      ];

  softLayers.forEach((layer, i) => {
    const lineId = `${GROUND_PREFIX}${regionId}-soft-${i}`;
    collection.add({
      id: lineId,
      polyline: {
        positions: closed,
        width: layer.width,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: mapLikePoints ? 0.18 : 0.12,
          taperPower: 1,
          color: baseColor.withAlpha(layer.alpha),
        }),
        clampToGround: !mapLikePoints,
      },
    });
  });

  const coreId = `${GROUND_PREFIX}${regionId}-core`;
  collection.add({
    id: coreId,
    polyline: {
      positions: closed,
      width: mapLikePoints ? 3 : 2.5,
      material: new Cesium.ColorMaterialProperty(
        new Cesium.CallbackProperty((time) => {
          const t = ((time?.secondsOfDay ?? 0) * 1000) % 2400;
          const pulse = 0.65 + 0.35 * (0.5 + 0.5 * Math.sin((t / 2400) * Math.PI * 2));
          return baseColor.withAlpha(pulse);
        }, false)
      ),
      clampToGround: !mapLikePoints,
    },
  });
}

/** 立体光墙（3D 球体场景；2D 平面模式仅保留地面光晕） */
function syncVerticalWall(
  primitives: Cesium.PrimitiveCollection,
  region: Region,
  mapLikePoints: boolean
): void {
  const regionId = region.id;
  const wallId = getPrimitiveWallId(regionId);

  for (let i = primitives.length - 1; i >= 0; i--) {
    const p = primitives.get(i);
    if (p instanceof Cesium.Primitive && isWallPrimitive(p, regionId)) {
      primitives.remove(p);
    }
  }

  if (mapLikePoints) return;

  ensureWallMaterial();
  const ring = ringLngLat(region);
  const cartPositions = ring.map(([lng, lat]) => Cesium.Cartesian3.fromDegrees(lng, lat, 0));
  const cartographics = cartPositions.map((p) => Cesium.Cartographic.fromCartesian(p));
  const wallH = estimateWallHeightMeters(ring);
  const minimumHeights = cartographics.map((c) => c.height);
  const maximumHeights = cartographics.map((c) => c.height + wallH);

  const baseColor = Cesium.Color.fromCssColorString(
    (region.style as { outlineColor?: string } | undefined)?.outlineColor ??
      REGION_LIGHT_WALL_DEFAULTS.color
  );

  const wallGeometry = new Cesium.WallGeometry({
    positions: cartPositions,
    minimumHeights,
    maximumHeights,
    vertexFormat: Cesium.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
  });

  const primitive = new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: wallGeometry,
      id: wallId,
    }),
    appearance: new Cesium.MaterialAppearance({
      material: Cesium.Material.fromType('RegionLightWall', { color: baseColor.withAlpha(0.9) }),
      translucent: true,
      closed: true,
      faceForward: true,
    }),
    asynchronous: false,
  });

  setWallPrimitiveId(primitive, regionId);
  primitives.add(primitive);
}

function removeGroundEntities(collection: Cesium.EntityCollection, regionId: string): void {
  const toRemove: Cesium.Entity[] = [];
  for (const e of collection.values) {
    const id = String(e.id);
    if (id.startsWith(`${GROUND_PREFIX}${regionId}`)) {
      toRemove.push(e);
    }
  }
  for (const e of toRemove) {
    collection.remove(e);
  }
}

export function syncRegionLightWall(
  entityCollection: Cesium.EntityCollection,
  primitiveCollection: Cesium.PrimitiveCollection | null,
  region: Region,
  mapLikePoints: boolean
): void {
  removeGroundEntities(entityCollection, region.id);
  syncGroundGlow(entityCollection, region, mapLikePoints);
  if (primitiveCollection) {
    syncVerticalWall(primitiveCollection, region, mapLikePoints);
  }
}

export function removeRegionLightWall(
  entityCollection: Cesium.EntityCollection,
  primitiveCollection: Cesium.PrimitiveCollection | null,
  regionId: string
): void {
  removeGroundEntities(entityCollection, regionId);
  if (!primitiveCollection) return;
  for (let i = primitiveCollection.length - 1; i >= 0; i--) {
    const p = primitiveCollection.get(i);
    if (p instanceof Cesium.Primitive && isWallPrimitive(p, regionId)) {
      primitiveCollection.remove(p);
    }
  }
}
