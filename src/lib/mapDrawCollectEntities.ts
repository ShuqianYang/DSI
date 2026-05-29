import type { Entity, GisData } from '@/types/prd';
import type { MapDrawEntitiesByLayer } from '@/types/mapDraw';

/** 射线法，ring 为 [lng,lat][] 开放环（首尾不必相等） */
export function pointInPolygonRing(lng: number, lat: number, ring: [number, number][]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const denom = yj - yi;
    if (Math.abs(denom) < 1e-14) continue;
    const intersect = (yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / denom + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInGeoRectangle(
  lng: number,
  lat: number,
  west: number,
  south: number,
  east: number,
  north: number
): boolean {
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

function emptyBuckets(): MapDrawEntitiesByLayer {
  return { ads: [], ais: [], base: [], event: [], dense: [] };
}

export function collectEntitiesInPolygon(
  ringLngLat: [number, number][],
  ctx: {
    entities: Entity[];
    eventGisDataList: GisData[];
    denseCells: Array<{ minLng: number; maxLng: number; minLat: number; maxLat: number; count: number }>;
    activeLayers: Set<string>;
  }
): MapDrawEntitiesByLayer {
  const inside = (lng: number, lat: number) => pointInPolygonRing(lng, lat, ringLngLat);
  return collectWithPredicate(inside, ctx);
}

export function collectEntitiesInRectangle(
  west: number,
  south: number,
  east: number,
  north: number,
  ctx: {
    entities: Entity[];
    eventGisDataList: GisData[];
    denseCells: Array<{ minLng: number; maxLng: number; minLat: number; maxLat: number; count: number }>;
    activeLayers: Set<string>;
  }
): MapDrawEntitiesByLayer {
  const inside = (lng: number, lat: number) => pointInGeoRectangle(lng, lat, west, south, east, north);
  return collectWithPredicate(inside, ctx);
}

function collectWithPredicate(
  inside: (lng: number, lat: number) => boolean,
  ctx: {
    entities: Entity[];
    eventGisDataList: GisData[];
    denseCells: Array<{ minLng: number; maxLng: number; minLat: number; maxLat: number; count: number }>;
    activeLayers: Set<string>;
  }
): MapDrawEntitiesByLayer {
  const out = emptyBuckets();
  const eventIds = new Set<string>();
  ctx.eventGisDataList.forEach((g) => {
    g.entities?.forEach((e) => eventIds.add(e.id));
  });

  for (const e of ctx.entities) {
    if (eventIds.has(e.id)) continue;
    const [elng, elat] = e.coordinates;
    if (!inside(elng, elat)) continue;
    if (e.type === 'aircraft' && ctx.activeLayers.has('ads')) out.ads.push(e);
    else if (e.type === 'ship' && ctx.activeLayers.has('ais')) out.ais.push(e);
    else if (e.type === 'base' && ctx.activeLayers.has('base')) out.base.push(e);
  }

  ctx.eventGisDataList.forEach((g) => {
    const eventId = g.eventId ?? '';
    g.entities?.forEach((e) => {
      const [elng, elat] = e.coordinates;
      if (!inside(elng, elat)) return;
      out.event.push({ entity: e, eventId });
    });
  });

  for (const cell of ctx.denseCells) {
    const cx = (cell.minLng + cell.maxLng) / 2;
    const cy = (cell.minLat + cell.maxLat) / 2;
    if (!inside(cx, cy)) continue;
    const id = `dense-${cell.minLng.toFixed(2)}-${cell.minLat.toFixed(2)}`;
    out.dense.push({
      id,
      name: `约 ${cell.count} 艘船舶`,
      type: 'ship',
      status: 'normal',
      importance: 'medium',
      coordinates: [cx, cy],
      description: `dense-cell:${cell.count}`,
    } as Entity);
  }

  return out;
}
