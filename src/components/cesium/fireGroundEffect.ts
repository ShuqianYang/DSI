import * as Cesium from 'cesium';

/** 火点地面扩散（2D / 3D 通用） */
export const FIRE_GROUND_EFFECT_DEFAULTS = {
  maxRadiusMeters: 4_500,
  periodMs: 2_400,
  color: '#ff2a2a',
  ringCount: 2,
  coreRadiusRatio: 0.16,
} as const;

const FIRE_PULSE_PREFIX = 'fire-pulse-';
const FIRE_CORE_PREFIX = 'fire-core-';

export interface FireGroundSpec {
  id: string;
  lng: number;
  lat: number;
  maxRadiusMeters?: number;
}

export function collectFireGroundSpecs(
  fires: Array<{ id: string; coordinates: [number, number] }>
): FireGroundSpec[] {
  const byCoord = new Map<string, FireGroundSpec>();
  for (const f of fires) {
    const [lng, lat] = f.coordinates;
    const key = `${lng.toFixed(5)},${lat.toFixed(5)}`;
    if (!byCoord.has(key)) {
      byCoord.set(key, { id: key, lng, lat });
    }
  }
  return [...byCoord.values()];
}

function isFireEffectEntityId(id: string): boolean {
  return id.startsWith(FIRE_PULSE_PREFIX) || id.startsWith(FIRE_CORE_PREFIX);
}

/** 扩散环：中段最亮，外缘渐隐 */
function ringFillAlpha(progress: number): number {
  const p = Math.min(Math.max(progress, 0), 1);
  const fade = 1 - p;
  return fade * fade * 0.42;
}

function ringOutlineAlpha(progress: number): number {
  const p = Math.min(Math.max(progress, 0), 1);
  const peak = 1 - Math.abs(p - 0.25) * 1.8;
  return Math.max(0, peak) * 0.92;
}

export function syncFireGroundPulseRings(
  collection: Cesium.EntityCollection,
  specs: FireGroundSpec[],
  mapLikePoints: boolean
): void {
  const desiredPulse = new Set<string>();
  const desiredCore = new Set<string>();

  for (const spec of specs) {
    desiredCore.add(`${FIRE_CORE_PREFIX}${spec.id}`);
    for (let i = 0; i < FIRE_GROUND_EFFECT_DEFAULTS.ringCount; i++) {
      desiredPulse.add(`${FIRE_PULSE_PREFIX}${spec.id}-${i}`);
    }
  }

  const toRemove: Cesium.Entity[] = [];
  for (const e of collection.values) {
    const id = String(e.id);
    if (!isFireEffectEntityId(id)) continue;
    if (id.startsWith(FIRE_CORE_PREFIX) && !desiredCore.has(id)) {
      toRemove.push(e);
    } else if (id.startsWith(FIRE_PULSE_PREFIX) && !desiredPulse.has(id)) {
      toRemove.push(e);
    }
  }
  for (const e of toRemove) {
    collection.remove(e);
  }

  const existing = new Set([...collection.values].map((e) => String(e.id)));

  for (const spec of specs) {
    const maxR = spec.maxRadiusMeters ?? FIRE_GROUND_EFFECT_DEFAULTS.maxRadiusMeters;
    const period = FIRE_GROUND_EFFECT_DEFAULTS.periodMs;
    const baseColor = Cesium.Color.fromCssColorString(FIRE_GROUND_EFFECT_DEFAULTS.color);
    const heightRef = mapLikePoints
      ? Cesium.HeightReference.NONE
      : Cesium.HeightReference.CLAMP_TO_GROUND;
    const coreR = maxR * FIRE_GROUND_EFFECT_DEFAULTS.coreRadiusRatio;

    const coreId = `${FIRE_CORE_PREFIX}${spec.id}`;
    if (!existing.has(coreId)) {
      collection.add({
        id: coreId,
        position: Cesium.Cartesian3.fromDegrees(spec.lng, spec.lat, 0),
        ellipse: {
          semiMinorAxis: coreR,
          semiMajorAxis: coreR,
          material: baseColor.withAlpha(0.38),
          outline: true,
          outlineColor: baseColor.withAlpha(0.95),
          outlineWidth: 3,
          heightReference: heightRef,
        },
      });
    }

    for (let ringIndex = 0; ringIndex < FIRE_GROUND_EFFECT_DEFAULTS.ringCount; ringIndex++) {
      const ringId = `${FIRE_PULSE_PREFIX}${spec.id}-${ringIndex}`;
      if (existing.has(ringId)) continue;

      const phase = ringIndex / FIRE_GROUND_EFFECT_DEFAULTS.ringCount;

      collection.add({
        id: ringId,
        position: Cesium.Cartesian3.fromDegrees(spec.lng, spec.lat, 0),
        ellipse: {
          semiMinorAxis: new Cesium.CallbackProperty((time) => {
            const t = (((time?.secondsOfDay ?? 0) * 1000) % period) / period;
            const progress = (t + phase) % 1;
            return Math.max(maxR * (0.1 + progress * 0.9), coreR * 1.08);
          }, false),
          semiMajorAxis: new Cesium.CallbackProperty((time) => {
            const t = (((time?.secondsOfDay ?? 0) * 1000) % period) / period;
            const progress = (t + phase) % 1;
            return Math.max(maxR * (0.1 + progress * 0.9), coreR * 1.08);
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
