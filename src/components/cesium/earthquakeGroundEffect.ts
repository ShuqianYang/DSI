import * as Cesium from 'cesium';

/** 震中地面脉冲高亮（2D / 3D 通用，风格对齐火点扩散） */
export const EARTHQUAKE_GROUND_EFFECT_DEFAULTS = {
  maxRadiusMeters: 2_800,
  periodMs: 2_000,
  color: '#DC2626',
  ringCount: 3,
  coreRadiusRatio: 0.2,
} as const;

const EPICENTER_PULSE_PREFIX = 'eq-pulse-';
const EPICENTER_CORE_PREFIX = 'eq-core-';

export interface EpicenterGroundSpec {
  id: string;
  lng: number;
  lat: number;
  maxRadiusMeters?: number;
}

export function collectEpicenterGroundSpecs(
  points: Array<{ id: string; coordinates: [number, number] }>
): EpicenterGroundSpec[] {
  const byCoord = new Map<string, EpicenterGroundSpec>();
  for (const p of points) {
    const [lng, lat] = p.coordinates;
    const key = `${lng.toFixed(5)},${lat.toFixed(5)}`;
    if (!byCoord.has(key)) {
      byCoord.set(key, { id: key, lng, lat });
    }
  }
  return [...byCoord.values()];
}

function isEpicenterEffectEntityId(id: string): boolean {
  return id.startsWith(EPICENTER_PULSE_PREFIX) || id.startsWith(EPICENTER_CORE_PREFIX);
}

function ringFillAlpha(progress: number): number {
  const p = Math.min(Math.max(progress, 0), 1);
  const fade = 1 - p;
  return fade * fade * 0.48;
}

function ringOutlineAlpha(progress: number): number {
  const p = Math.min(Math.max(progress, 0), 1);
  const peak = 1 - Math.abs(p - 0.22) * 1.75;
  return Math.max(0, peak) * 0.95;
}

export function syncEpicenterGroundPulseRings(
  collection: Cesium.EntityCollection,
  specs: EpicenterGroundSpec[],
  mapLikePoints: boolean
): void {
  const desiredPulse = new Set<string>();
  const desiredCore = new Set<string>();

  for (const spec of specs) {
    desiredCore.add(`${EPICENTER_CORE_PREFIX}${spec.id}`);
    for (let i = 0; i < EARTHQUAKE_GROUND_EFFECT_DEFAULTS.ringCount; i++) {
      desiredPulse.add(`${EPICENTER_PULSE_PREFIX}${spec.id}-${i}`);
    }
  }

  const toRemove: Cesium.Entity[] = [];
  for (const e of collection.values) {
    const id = String(e.id);
    if (!isEpicenterEffectEntityId(id)) continue;
    if (id.startsWith(EPICENTER_CORE_PREFIX) && !desiredCore.has(id)) {
      toRemove.push(e);
    } else if (id.startsWith(EPICENTER_PULSE_PREFIX) && !desiredPulse.has(id)) {
      toRemove.push(e);
    }
  }
  for (const e of toRemove) {
    collection.remove(e);
  }

  const existing = new Set([...collection.values].map((e) => String(e.id)));

  for (const spec of specs) {
    const maxR = spec.maxRadiusMeters ?? EARTHQUAKE_GROUND_EFFECT_DEFAULTS.maxRadiusMeters;
    const period = EARTHQUAKE_GROUND_EFFECT_DEFAULTS.periodMs;
    const baseColor = Cesium.Color.fromCssColorString(EARTHQUAKE_GROUND_EFFECT_DEFAULTS.color);
    const heightRef = mapLikePoints
      ? Cesium.HeightReference.NONE
      : Cesium.HeightReference.CLAMP_TO_GROUND;
    const coreR = maxR * EARTHQUAKE_GROUND_EFFECT_DEFAULTS.coreRadiusRatio;

    const coreId = `${EPICENTER_CORE_PREFIX}${spec.id}`;
    if (!existing.has(coreId)) {
      collection.add({
        id: coreId,
        position: Cesium.Cartesian3.fromDegrees(spec.lng, spec.lat, 0),
        ellipse: {
          semiMinorAxis: coreR,
          semiMajorAxis: coreR,
          material: baseColor.withAlpha(0.45),
          outline: true,
          outlineColor: baseColor.withAlpha(0.98),
          outlineWidth: 3,
          heightReference: heightRef,
        },
        label: {
          text: '★ 震中',
          font: 'bold 14px "Microsoft YaHei", sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: baseColor,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -18),
          heightReference: heightRef,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }

    for (let ringIndex = 0; ringIndex < EARTHQUAKE_GROUND_EFFECT_DEFAULTS.ringCount; ringIndex++) {
      const ringId = `${EPICENTER_PULSE_PREFIX}${spec.id}-${ringIndex}`;
      if (existing.has(ringId)) continue;

      const phase = ringIndex / EARTHQUAKE_GROUND_EFFECT_DEFAULTS.ringCount;

      collection.add({
        id: ringId,
        position: Cesium.Cartesian3.fromDegrees(spec.lng, spec.lat, 0),
        ellipse: {
          semiMinorAxis: new Cesium.CallbackProperty((time) => {
            const t = (((time?.secondsOfDay ?? 0) * 1000) % period) / period;
            const progress = (t + phase) % 1;
            return Math.max(maxR * (0.08 + progress * 0.92), coreR * 1.1);
          }, false),
          semiMajorAxis: new Cesium.CallbackProperty((time) => {
            const t = (((time?.secondsOfDay ?? 0) * 1000) % period) / period;
            const progress = (t + phase) % 1;
            return Math.max(maxR * (0.08 + progress * 0.92), coreR * 1.1);
          }, false),
          material: new Cesium.ColorMaterialProperty(
            new Cesium.CallbackProperty((time) => {
              const t = (((time?.secondsOfDay ?? 0) * 1000) % period) / period;
              const progress = (t + phase) % 1;
              return baseColor.withAlpha(ringFillAlpha(progress));
            }, false)
          ),
          outline: true,
          outlineWidth: 4,
          outlineColor: new Cesium.CallbackProperty((time) => {
            const t = (((time?.secondsOfDay ?? 0) * 1000) % period) / period;
            const progress = (t + phase) % 1;
            return baseColor.withAlpha(ringOutlineAlpha(progress));
          }, false),
          heightReference: heightRef,
        },
      });
    }
  }
}
