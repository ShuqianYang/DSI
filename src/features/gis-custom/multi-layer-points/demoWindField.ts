import type { WindField } from '@datasourceintelligence/shared';
import type { SingleTileOverlaySpec } from '@/components/cesium/CesiumMap';

const D2R = Math.PI / 180;

/**
 * 东海尺度 demo 风场（10×10，与 api/plan/wind-particle-handoff 中 bbox 尺度一致）。
 * 矢量做成「绕中心旋转」+ 轻微噪声，便于在示例页看出流线。
 */
function buildDemoWindArrays(): Pick<WindField, 'u' | 'v' | 'speed'> {
  const rows = 10;
  const cols = 10;
  const u: number[] = [];
  const v: number[] = [];
  const speed: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const nx = (c / (cols - 1 || 1) - 0.5) * 2;
      const ny = (r / (rows - 1 || 1) - 0.5) * 2;
      const base = 3.2 + Math.hypot(nx, ny) * 2.2;
      const ui = -ny * base * 0.55 + Math.sin(c * 0.7 + r * 0.4) * 0.6;
      const vi = nx * base * 0.55 + Math.cos(r * 0.6) * 0.5;
      u.push(ui);
      v.push(vi);
      speed.push(Math.sqrt(ui * ui + vi * vi));
    }
  }
  return { u, v, speed };
}

const demoArrays = buildDemoWindArrays();

export const DEMO_WIND_FIELD: WindField = {
  bbox: {
    west: 122.5125,
    east: 123.5125,
    south: 29.7561,
    north: 30.7561,
  },
  grid: { rows: 10, cols: 10 },
  u: demoArrays.u,
  v: demoArrays.v,
  speed: demoArrays.speed,
  timestamp: '2026-05-13T00:00:00.000Z',
  source: 'mock-fallback',
};

function speedToColor(s: number, sMin: number, sMax: number, px: number, py: number, w: number, h: number): [number, number, number, number] {
  const rawT = sMax > sMin ? (s - sMin) / (sMax - sMin) : 0.5;
  const t = smoothstep(0, 1, Math.min(1, Math.max(0, rawT)));

  // Windy 感：深蓝 → 青 (#00E0FF) → 翠绿 → 琥珀 → 珊瑚
  let r: number;
  let g: number;
  let b: number;
  if (t < 0.28) {
    const k = t / 0.28;
    r = lerp(26, 42, k);
    g = lerp(42, 95, k);
    b = lerp(92, 168, k);
  } else if (t < 0.52) {
    const k = (t - 0.28) / 0.24;
    r = lerp(42, 0, k);
    g = lerp(95, 200, k);
    b = lerp(168, 255, k);
  } else if (t < 0.72) {
    const k = (t - 0.52) / 0.2;
    r = lerp(0, 68, k);
    g = lerp(200, 220, k);
    b = lerp(255, 140, k);
  } else if (t < 0.88) {
    const k = (t - 0.72) / 0.16;
    r = lerp(68, 255, k);
    g = lerp(220, 184, k);
    b = lerp(140, 90, k);
  } else {
    const k = (t - 0.88) / 0.12;
    r = lerp(255, 255, k);
    g = lerp(184, 110, k);
    b = lerp(90, 95, k);
  }

  const ed = Math.min(px, py, w - 1 - px, h - 1 - py);
  const edgeFade = smoothstep(0, 22, ed);
  const a = Math.round(210 * (0.45 + 0.55 * edgeFade));
  return [Math.round(r), Math.round(g), Math.round(b), a];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 由 WindField.speed 生成半透明热力图 Data URL，供 SingleTileImageryProvider 使用（仅客户端调用） */
export function createWindHeatmapSingleTile(wf: WindField): SingleTileOverlaySpec {
  const w = 256;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      id: 'demo-wind-heatmap-fallback',
      url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      rectangle: wf.bbox,
      tileWidth: 1,
      tileHeight: 1,
      alpha: 0.55,
    };
  }

  const speeds = wf.speed;
  let sMin = Infinity;
  let sMax = -Infinity;
  for (const s of speeds) {
    if (Number.isFinite(s)) {
      sMin = Math.min(sMin, s);
      sMax = Math.max(sMax, s);
    }
  }
  if (!Number.isFinite(sMin) || !Number.isFinite(sMax) || sMin === sMax) {
    sMin = 0;
    sMax = 1;
  }

  const { rows, cols } = wf.grid;
  const img = ctx.createImageData(w, h);
  const data = img.data;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const gx = (px / (w - 1)) * (cols - 1);
      const gy = (1 - py / (h - 1)) * (rows - 1);
      const s = sampleBilinearScalar(speeds, cols, rows, gx, gy);
      const [r, g, b, a] = speedToColor(s, sMin, sMax, px, py, w, h);
      const o = (py * w + px) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);

  return {
    id: 'demo-wind-heatmap',
    url: canvas.toDataURL('image/png'),
    rectangle: { ...wf.bbox },
    tileWidth: w,
    tileHeight: h,
    alpha: 0.56,
  };
}

function sampleBilinearScalar(
  grid: number[],
  cols: number,
  rows: number,
  fx: number,
  fy: number
): number {
  const c0 = Math.max(0, Math.min(cols - 1, fx));
  const r0 = Math.max(0, Math.min(rows - 1, fy));
  const c = Math.floor(c0);
  const r = Math.floor(r0);
  const dc = c0 - c;
  const dr = r0 - r;
  const c1 = Math.min(c + 1, cols - 1);
  const r1 = Math.min(r + 1, rows - 1);
  const i00 = r * cols + c;
  const i10 = r * cols + c1;
  const i01 = r1 * cols + c;
  const i11 = r1 * cols + c1;
  const v00 = grid[i00] ?? 0;
  const v10 = grid[i10] ?? 0;
  const v01 = grid[i01] ?? 0;
  const v11 = grid[i11] ?? 0;
  const v0 = v00 * (1 - dc) + v10 * dc;
  const v1 = v01 * (1 - dc) + v11 * dc;
  return v0 * (1 - dr) + v1 * dr;
}

export function sampleWindUv(
  wf: WindField,
  lon: number,
  lat: number
): { u: number; v: number; speed: number } {
  const { west, south, east, north } = wf.bbox;
  const { rows, cols } = wf.grid;
  const fx = ((lon - west) / (east - west || 1e-9)) * (cols - 1);
  const fy = ((lat - south) / (north - south || 1e-9)) * (rows - 1);
  const gx = Math.max(0, Math.min(cols - 1, fx));
  const gy = Math.max(0, Math.min(rows - 1, fy));
  const c = Math.floor(gx);
  const r = Math.floor(gy);
  const dc = gx - c;
  const dr = gy - r;
  const c1 = Math.min(c + 1, cols - 1);
  const r1 = Math.min(r + 1, rows - 1);

  const sample = (arr: number[]) => {
    const i00 = r * cols + c;
    const i10 = r * cols + c1;
    const i01 = r1 * cols + c;
    const i11 = r1 * cols + c1;
    const v00 = arr[i00] ?? 0;
    const v10 = arr[i10] ?? 0;
    const v01 = arr[i01] ?? 0;
    const v11 = arr[i11] ?? 0;
    const v0 = v00 * (1 - dc) + v10 * dc;
    const v1 = v01 * (1 - dc) + v11 * dc;
    return v0 * (1 - dr) + v1 * dr;
  };

  const u = sample(wf.u);
  const v = sample(wf.v);
  const speed = sample(wf.speed);
  return { u, v, speed };
}

/** m/s → 度/秒（小范围近似）；再乘 visualMult 供屏幕级动画 */
export function windMpsToDegreesPerSecond(latDeg: number, u: number, v: number, visualMult: number) {
  const cosLat = Math.max(0.2, Math.cos(latDeg * D2R));
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * cosLat;
  return {
    dLon: ((u / mPerDegLon) * visualMult) as number,
    dLat: ((v / mPerDegLat) * visualMult) as number,
  };
}
