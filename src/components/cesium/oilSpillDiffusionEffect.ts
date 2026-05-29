import * as Cesium from 'cesium';
import type { GisData, Region } from '@/types/prd';

type WindField = NonNullable<GisData['windField']>;

export const POLLUTION_ORIGIN_REGION_ID = 'pollution-origin-area';

const OIL_CORE_PREFIX = 'oil-diffusion-core-';
const OIL_STATIC_PLUME_PREFIX = 'oil-diffusion-static-';
const OIL_ANIM_PLUME_PREFIX = 'oil-diffusion-anim-';

/** 排污原点油污扩散：常驻底色 + 沿顺风脉冲动画 */
export const OIL_SPILL_DIFFUSION_DEFAULTS = {
  periodMs: 3_200,
  animRingCount: 2,
  staticLayerCount: 2,
  baseDownwindMeters: 2_800,
  baseCrosswindMeters: 950,
  metersPerWindSpeed: 520,
  coreDownwindMeters: 380,
  coreCrosswindMeters: 260,
  staticDownwindRatios: [0.38, 0.72] as const,
  staticAlphas: [0.26, 0.18] as const,
  color: '#8B5A14',
  zIndex: 1800,
  /** 动画脉冲最低透明度，避免“闪没” */
  minAnimAlpha: 0.14,
} as const;

export interface OilSpillDiffusionSpec {
  id: string;
  lng: number;
  lat: number;
  /** 风流去向：顺时针自真北（度） */
  flowDegCW: number;
  windSpeed?: number;
}

type RegionDiffusionMeta = {
  windFlowDeg?: number;
  windSpeed?: number;
};

function isOilDiffusionEntityId(id: string): boolean {
  return (
    id.startsWith(OIL_CORE_PREFIX) ||
    id.startsWith(OIL_STATIC_PLUME_PREFIX) ||
    id.startsWith(OIL_ANIM_PLUME_PREFIX)
  );
}

function regionCentroid(region: Region): [number, number] {
  const n = region.coordinates.length;
  if (n === 0) return [0, 0];
  let lng = 0;
  let lat = 0;
  for (const [x, y] of region.coordinates) {
    lng += x;
    lat += y;
  }
  return [lng / n, lat / n];
}

/** 气象「来自」方位 → 风流去向（度，顺时针自真北） */
export function compassWindToFlowDeg(windDirection: string): number {
  const key = windDirection.replace(/风$/, '').trim();
  const fromDeg: Record<string, number> = {
    北: 0,
    东北: 45,
    东: 90,
    东南: 135,
    南: 180,
    西南: 225,
    西: 270,
    西北: 315,
  };
  return ((fromDeg[key] ?? 45) + 180) % 360;
}

export function flowDegCWToCesiumRotationRad(flowDegCW: number): number {
  const rad = (flowDegCW * Math.PI) / 180;
  return (Math.atan2(Math.sin(rad), Math.cos(rad)) + 2 * Math.PI) % (2 * Math.PI);
}

function uvToFlowDegCW(u: number, v: number): number {
  if (Math.abs(u) < 1e-6 && Math.abs(v) < 1e-6) {
    return compassWindToFlowDeg('东北');
  }
  const rad = Math.atan2(u, v);
  return ((rad * 180) / Math.PI + 360) % 360;
}

export function offsetDownwindLngLat(
  lng: number,
  lat: number,
  distanceM: number,
  flowDegCW: number
): [number, number] {
  const rad = (flowDegCW * Math.PI) / 180;
  const dEast = Math.sin(rad) * distanceM;
  const dNorth = Math.cos(rad) * distanceM;
  const latRad = (lat * Math.PI) / 180;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.max(Math.cos(latRad), 0.15);
  return [lng + dEast / mPerDegLng, lat + dNorth / mPerDegLat];
}

export function sampleWindFieldUV(
  field: WindField,
  lng: number,
  lat: number
): { u: number; v: number } {
  const { bbox, grid, u, v } = field;
  const cols = grid.cols;
  const rows = grid.rows;
  const spanLng = bbox.east - bbox.west || 1e-6;
  const spanLat = bbox.north - bbox.south || 1e-6;
  const tx = Math.min(1, Math.max(0, (lng - bbox.west) / spanLng));
  const ty = Math.min(1, Math.max(0, (lat - bbox.south) / spanLat));
  const colF = tx * (cols - 1);
  const rowF = ty * (rows - 1);
  const c0 = Math.floor(colF);
  const r0 = Math.floor(rowF);
  const c1 = Math.min(cols - 1, c0 + 1);
  const r1 = Math.min(rows - 1, r0 + 1);
  const fc = colF - c0;
  const fr = rowF - r0;
  const sample = (arr: number[], r: number, c: number) => arr[r * cols + c] ?? 0;
  const u00 = sample(u, r0, c0);
  const u10 = sample(u, r0, c1);
  const u01 = sample(u, r1, c0);
  const u11 = sample(u, r1, c1);
  const v00 = sample(v, r0, c0);
  const v10 = sample(v, r0, c1);
  const v01 = sample(v, r1, c0);
  const v11 = sample(v, r1, c1);
  const uMix = u00 * (1 - fc) * (1 - fr) + u10 * fc * (1 - fr) + u01 * (1 - fc) * fr + u11 * fc * fr;
  const vMix = v00 * (1 - fc) * (1 - fr) + v10 * fc * (1 - fr) + v01 * (1 - fc) * fr + v11 * fc * fr;
  return { u: uMix, v: vMix };
}

function findWindField(gisList: GisData[]): WindField | undefined {
  for (let i = gisList.length - 1; i >= 0; i--) {
    const wf = gisList[i]?.windField;
    if (wf) return wf;
  }
  return undefined;
}

function readRegionDiffusionMeta(region: Region): RegionDiffusionMeta | undefined {
  const style = region.style as { diffusion?: RegionDiffusionMeta } | undefined;
  return style?.diffusion;
}

export function collectOilSpillDiffusionSpecs(
  regions: Region[],
  eventGisDataList: GisData[]
): OilSpillDiffusionSpec[] {
  const specs: OilSpillDiffusionSpec[] = [];
  const windField = findWindField(eventGisDataList);

  for (const region of regions) {
    if (region.id !== POLLUTION_ORIGIN_REGION_ID) continue;
    const [lng, lat] = regionCentroid(region);
    const meta = readRegionDiffusionMeta(region);

    let flowDegCW: number;
    let windSpeed = meta?.windSpeed;

    if (typeof meta?.windFlowDeg === 'number') {
      flowDegCW = meta.windFlowDeg;
    } else if (windField) {
      const { u, v } = sampleWindFieldUV(windField, lng, lat);
      flowDegCW = uvToFlowDegCW(u, v);
      if (windSpeed == null) {
        windSpeed = Math.sqrt(u * u + v * v);
      }
    } else {
      flowDegCW = compassWindToFlowDeg('东北');
      windSpeed = windSpeed ?? 3.2;
    }

    specs.push({ id: region.id, lng, lat, flowDegCW, windSpeed });
  }

  return specs;
}

function animPlumeAlpha(progress: number): number {
  const p = Math.min(Math.max(progress, 0), 1);
  const fade = 1 - p;
  return Math.max(OIL_SPILL_DIFFUSION_DEFAULTS.minAnimAlpha, fade * fade * 0.44);
}

function animOutlineAlpha(progress: number): number {
  const p = Math.min(Math.max(progress, 0), 1);
  const peak = 1 - Math.abs(p - 0.22) * 1.55;
  return Math.max(OIL_SPILL_DIFFUSION_DEFAULTS.minAnimAlpha, peak * 0.58);
}

export function syncOilSpillDiffusionPlumes(
  collection: Cesium.EntityCollection,
  specs: OilSpillDiffusionSpec[],
  mapLikePoints: boolean
): void {
  const desiredCore = new Set<string>();
  const desiredStatic = new Set<string>();
  const desiredAnim = new Set<string>();

  for (const spec of specs) {
    desiredCore.add(`${OIL_CORE_PREFIX}${spec.id}`);
    for (let i = 0; i < OIL_SPILL_DIFFUSION_DEFAULTS.staticLayerCount; i++) {
      desiredStatic.add(`${OIL_STATIC_PLUME_PREFIX}${spec.id}-${i}`);
    }
    for (let i = 0; i < OIL_SPILL_DIFFUSION_DEFAULTS.animRingCount; i++) {
      desiredAnim.add(`${OIL_ANIM_PLUME_PREFIX}${spec.id}-${i}`);
    }
  }

  const toRemove: Cesium.Entity[] = [];
  for (const e of collection.values) {
    const id = String(e.id);
    if (!isOilDiffusionEntityId(id)) continue;
    if (id.startsWith(OIL_CORE_PREFIX) && !desiredCore.has(id)) toRemove.push(e);
    else if (id.startsWith(OIL_STATIC_PLUME_PREFIX) && !desiredStatic.has(id)) toRemove.push(e);
    else if (id.startsWith(OIL_ANIM_PLUME_PREFIX) && !desiredAnim.has(id)) toRemove.push(e);
  }
  for (const e of toRemove) {
    collection.remove(e);
  }

  const existing = new Set([...collection.values].map((e) => String(e.id)));
  const heightRef = mapLikePoints
    ? Cesium.HeightReference.NONE
    : Cesium.HeightReference.CLAMP_TO_GROUND;
  const baseColor = Cesium.Color.fromCssColorString(OIL_SPILL_DIFFUSION_DEFAULTS.color);
  const period = OIL_SPILL_DIFFUSION_DEFAULTS.periodMs;

  for (const spec of specs) {
    const speed = spec.windSpeed ?? 3.2;
    const maxDown =
      OIL_SPILL_DIFFUSION_DEFAULTS.baseDownwindMeters +
      speed * OIL_SPILL_DIFFUSION_DEFAULTS.metersPerWindSpeed;
    const maxCross =
      OIL_SPILL_DIFFUSION_DEFAULTS.baseCrosswindMeters + speed * 100;
    const rotation = flowDegCWToCesiumRotationRad(spec.flowDegCW);

    const coreId = `${OIL_CORE_PREFIX}${spec.id}`;
    if (!existing.has(coreId)) {
      collection.add({
        id: coreId,
        position: Cesium.Cartesian3.fromDegrees(spec.lng, spec.lat, 0),
        ellipse: {
          semiMajorAxis: OIL_SPILL_DIFFUSION_DEFAULTS.coreDownwindMeters,
          semiMinorAxis: OIL_SPILL_DIFFUSION_DEFAULTS.coreCrosswindMeters,
          rotation,
          material: baseColor.withAlpha(0.5),
          outline: true,
          outlineColor: baseColor.withAlpha(0.92),
          outlineWidth: 2,
          heightReference: heightRef,
          zIndex: OIL_SPILL_DIFFUSION_DEFAULTS.zIndex,
        },
      });
    }

    for (let i = 0; i < OIL_SPILL_DIFFUSION_DEFAULTS.staticLayerCount; i++) {
      const staticId = `${OIL_STATIC_PLUME_PREFIX}${spec.id}-${i}`;
      if (existing.has(staticId)) continue;

      const ratio = OIL_SPILL_DIFFUSION_DEFAULTS.staticDownwindRatios[i];
      const alpha = OIL_SPILL_DIFFUSION_DEFAULTS.staticAlphas[i];
      const layerDown = maxDown * (0.32 + ratio * 0.68);
      const layerCross = maxCross * (0.4 + ratio * 0.6);
      const [plumeLng, plumeLat] = offsetDownwindLngLat(
        spec.lng,
        spec.lat,
        maxDown * ratio * 0.52,
        spec.flowDegCW
      );

      collection.add({
        id: staticId,
        position: Cesium.Cartesian3.fromDegrees(plumeLng, plumeLat, 0),
        ellipse: {
          semiMajorAxis: layerDown,
          semiMinorAxis: layerCross,
          rotation,
          material: baseColor.withAlpha(alpha),
          outline: true,
          outlineWidth: 1.5,
          outlineColor: baseColor.withAlpha(Math.min(alpha + 0.2, 0.5)),
          heightReference: heightRef,
          zIndex: OIL_SPILL_DIFFUSION_DEFAULTS.zIndex,
        },
      });
    }

    for (let ringIndex = 0; ringIndex < OIL_SPILL_DIFFUSION_DEFAULTS.animRingCount; ringIndex++) {
      const animId = `${OIL_ANIM_PLUME_PREFIX}${spec.id}-${ringIndex}`;
      if (existing.has(animId)) continue;

      const phase = ringIndex / OIL_SPILL_DIFFUSION_DEFAULTS.animRingCount;

      collection.add({
        id: animId,
        position: new Cesium.CallbackProperty((time) => {
          const t = (((time?.secondsOfDay ?? 0) * 1000) % period) / period;
          const progress = (t + phase) % 1;
          const shift = maxDown * (0.08 + progress * 0.72);
          const [lng, lat] = offsetDownwindLngLat(spec.lng, spec.lat, shift, spec.flowDegCW);
          return Cesium.Cartesian3.fromDegrees(lng, lat, 0);
        }, false) as unknown as Cesium.PositionProperty,
        ellipse: {
          semiMajorAxis: new Cesium.CallbackProperty((time) => {
            const t = (((time?.secondsOfDay ?? 0) * 1000) % period) / period;
            const progress = (t + phase) % 1;
            return Math.max(
              maxDown * (0.14 + progress * 0.86),
              OIL_SPILL_DIFFUSION_DEFAULTS.coreDownwindMeters
            );
          }, false),
          semiMinorAxis: new Cesium.CallbackProperty((time) => {
            const t = (((time?.secondsOfDay ?? 0) * 1000) % period) / period;
            const progress = (t + phase) % 1;
            return Math.max(
              maxCross * (0.18 + progress * 0.82),
              OIL_SPILL_DIFFUSION_DEFAULTS.coreCrosswindMeters
            );
          }, false),
          rotation,
          material: new Cesium.ColorMaterialProperty(
            new Cesium.CallbackProperty((time) => {
              const t = (((time?.secondsOfDay ?? 0) * 1000) % period) / period;
              const progress = (t + phase) % 1;
              return baseColor.withAlpha(animPlumeAlpha(progress));
            }, false)
          ),
          outline: true,
          outlineWidth: 2,
          outlineColor: new Cesium.CallbackProperty((time) => {
            const t = (((time?.secondsOfDay ?? 0) * 1000) % period) / period;
            const progress = (t + phase) % 1;
            return baseColor.withAlpha(animOutlineAlpha(progress));
          }, false),
          heightReference: heightRef,
          zIndex: OIL_SPILL_DIFFUSION_DEFAULTS.zIndex,
        },
      });
    }
  }
}
