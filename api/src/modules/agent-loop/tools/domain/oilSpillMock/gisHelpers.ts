export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

const GRID = 10;
const HALF_SPAN_DEG = 0.5;
const MOCK_WIND_SPEED = 3.2;
const MOCK_WIND_DIR_DEG = 45;

export function toDMS(deg: number, isLng: boolean): string {
  const absDeg = Math.abs(deg);
  const d = Math.floor(absDeg);
  const minDec = (absDeg - d) * 60;
  const m = Math.floor(minDec);
  const s = Math.round((minDec - m) * 60);
  const prefix = isLng ? (deg >= 0 ? "东经" : "西经") : deg >= 0 ? "北纬" : "南纬";
  return `${prefix}${d}°${String(m).padStart(2, "0")}′${String(s).padStart(2, "0")}″`;
}

export function buildCircle(
  centerLng: number,
  centerLat: number,
  radiusDeg: number,
  points: number,
): [number, number][] {
  const ring: [number, number][] = [];
  const latScale = Math.cos((centerLat * Math.PI) / 180);
  for (let index = 0; index < points; index += 1) {
    const angle = (index / points) * 2 * Math.PI;
    ring.push([
      Number((centerLng + radiusDeg * Math.cos(angle)).toFixed(5)),
      Number((centerLat + radiusDeg * Math.sin(angle) * latScale).toFixed(5)),
    ]);
  }
  ring.push(ring[0]!);
  return ring;
}

export function compassWindToFlowDeg(windDirection: string): number {
  const key = windDirection.replace(/风$/, "").trim();
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

export function degreesToCompass(degrees: number): string {
  const dirs = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
  return dirs[Math.round(((degrees % 360) + 360) / 45) % 8]!;
}

export function directionSpeedToUv(speed: number, directionDeg: number): { u: number; v: number } {
  const flowDeg = (directionDeg + 180) % 360;
  const rad = (flowDeg * Math.PI) / 180;
  return {
    u: Number((speed * Math.sin(rad)).toFixed(2)),
    v: Number((speed * Math.cos(rad)).toFixed(2)),
  };
}

export function bboxFromCoordinates(coordinates: [number, number][]): Bbox {
  const lngs = coordinates.map(([lng]) => lng);
  const lats = coordinates.map(([, lat]) => lat);
  return {
    west: Math.min(...lngs),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    north: Math.max(...lats),
  };
}

export function buildMockWindField(center: { lng: number; lat: number }): {
  bbox: Bbox;
  grid: { rows: number; cols: number };
  u: number[];
  v: number[];
  speed: number[];
  timestamp: string;
  source: "oil-spill-mock";
} {
  const bbox = {
    west: center.lng - HALF_SPAN_DEG,
    east: center.lng + HALF_SPAN_DEG,
    south: center.lat - HALF_SPAN_DEG,
    north: center.lat + HALF_SPAN_DEG,
  };
  const vector = directionSpeedToUv(MOCK_WIND_SPEED, MOCK_WIND_DIR_DEG);
  return {
    bbox,
    grid: { rows: GRID, cols: GRID },
    u: new Array(GRID * GRID).fill(vector.u),
    v: new Array(GRID * GRID).fill(vector.v),
    speed: new Array(GRID * GRID).fill(MOCK_WIND_SPEED),
    timestamp: "2026-06-23T00:00:00.000+08:00",
    source: "oil-spill-mock",
  };
}
