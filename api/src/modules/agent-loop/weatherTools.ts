import { z } from "zod";
import type { ToolDefinition, ToolExecutionContext } from "./types.js";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
const DEFAULT_GRID_ROWS = 5;
const DEFAULT_GRID_COLS = 5;
const MAX_GRID_DIMENSION = 5;
const MAX_GRID_POINTS = 25;
const DEFAULT_LOOKBACK_DAYS = 3;
const DEFAULT_TIMEZONE = "Asia/Shanghai";
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_CENTER_HALF_SPAN_DEG = 0.5;
const MAX_RESULT_SIZE_CHARS = 80_000;

const CoordinateSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const BboxSchema = z
  .strictObject({
    west: z.number().min(-180).max(180),
    east: z.number().min(-180).max(180),
    south: z.number().min(-90).max(90),
    north: z.number().min(-90).max(90),
  })
  .refine((bbox) => bbox.west < bbox.east, "bbox.west must be less than bbox.east")
  .refine((bbox) => bbox.south < bbox.north, "bbox.south must be less than bbox.north");

const GridSchema = z
  .strictObject({
    rows: z.number().int().min(2).max(MAX_GRID_DIMENSION).default(DEFAULT_GRID_ROWS),
    cols: z.number().int().min(2).max(MAX_GRID_DIMENSION).default(DEFAULT_GRID_COLS),
  })
  .refine((grid) => grid.rows * grid.cols <= MAX_GRID_POINTS, `grid must contain at most ${MAX_GRID_POINTS} points`);

const WeatherFetchInputSchema = z.strictObject({
  center: CoordinateSchema.optional().describe("Center point for the weather field. Required when bbox is omitted."),
  bbox: BboxSchema.optional().describe("Bounding box for the weather field. Preferred when the user names a concrete map extent."),
  grid: GridSchema.default({ rows: DEFAULT_GRID_ROWS, cols: DEFAULT_GRID_COLS }).describe("Wind-field grid resolution."),
  lookbackDays: z.number().int().min(1).max(7).default(DEFAULT_LOOKBACK_DAYS),
  timezone: z.string().trim().min(1).default(DEFAULT_TIMEZONE),
  requestTimeoutMs: z.number().int().min(1_000).max(30_000).default(DEFAULT_REQUEST_TIMEOUT_MS),
});

type WeatherFetchInput = z.infer<typeof WeatherFetchInputSchema>;

interface WeatherFetchOutput {
  summary: string;
  dataSource: "open-meteo";
  windSpeed: number;
  windDirection: string;
  windDirectionDegrees: number;
  currentSpeed: number;
  currentDirection: string;
  period: string;
  center: Coordinate;
  bbox: Bbox;
  coverage: {
    validWindPoints: number;
    totalWindPoints: number;
    validCurrentPoints: number;
    totalCurrentPoints: number;
  };
  gisData: {
    type: "wind-field";
    windField: {
      bbox: Bbox;
      grid: {
        rows: number;
        cols: number;
      };
      u: number[];
      v: number[];
      speed: number[];
      validMask: boolean[];
      timestamp: string;
      source: "open-meteo";
    };
  };
}

interface Coordinate {
  lat: number;
  lng: number;
}

interface Bbox {
  west: number;
  east: number;
  south: number;
  north: number;
}

interface HourlyResponse {
  hourly?: Record<string, unknown>;
}

export function buildWeatherFetchTool(): ToolDefinition {
  return {
    name: "WeatherFetch",
    aliases: ["weather-fetch"],
    description:
      'Fetch real Open-Meteo wind and ocean-current data for an explicit center or bbox and return a GIS wind-field layer. Input: {"center":{"lat":25,"lng":120},"grid":{"rows":5,"cols":5},"lookbackDays":3}. The tool never guesses a default region and never fabricates mock weather data.',
    kind: "domain",
    inputSchema: WeatherFetchInputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    maxResultSizeChars: MAX_RESULT_SIZE_CHARS,
    validateInput(input) {
      assertHasLocation(input as WeatherFetchInput);
    },
    async execute(input, context) {
      const parsed = input as WeatherFetchInput;
      assertHasLocation(parsed);
      return executeWeatherFetch(parsed, context);
    },
  };
}

async function executeWeatherFetch(input: WeatherFetchInput, context: ToolExecutionContext): Promise<WeatherFetchOutput> {
  const bbox = input.bbox ?? bboxFromCenter(input.center!);
  const center = input.center ?? centerFromBbox(bbox);
  const grid = input.grid;
  const coordinates = buildGridCoordinates(bbox, grid);

  context.onProgress?.({
    stage: "start",
    message: `Fetching Open-Meteo weather for ${grid.rows}x${grid.cols} grid`,
  });

  let forecastRaw: unknown;
  let marineRaw: unknown;
  try {
    [forecastRaw, marineRaw] = await Promise.all([
      fetchJson(buildForecastUrl(coordinates, input), input.requestTimeoutMs, context.signal),
      fetchJson(buildMarineUrl(center, input), input.requestTimeoutMs, context.signal),
    ]);
  } catch (error) {
    throw new Error(`Open-Meteo request failed: ${formatErrorMessage(error)}`);
  }

  const wind = extractWindField(forecastRaw, grid);
  const current = extractCurrent(marineRaw);
  const windSpeed = average(wind.validSpeed);
  const windDirectionDeg = averageDirectionDegrees(wind.directionDeg);
  const windDirection = degreesToCompass(windDirectionDeg);
  const currentDirection = degreesToCompass(current.directionDeg);
  const timestamp = new Date().toISOString();

  context.onProgress?.({
    stage: "complete",
    message: `Open-Meteo returned ${wind.speed.length}/${grid.rows * grid.cols} wind point(s)`,
    data: {
      dataSource: "open-meteo",
      center,
      bbox,
      grid,
    },
  });

  return {
    summary: `Open-Meteo wind ${windSpeed} m/s ${windDirection}; ocean current ${current.speed} m/s ${currentDirection}.`,
    dataSource: "open-meteo",
    windSpeed,
    windDirection,
    windDirectionDegrees: roundMetric(windDirectionDeg),
    currentSpeed: current.speed,
    currentDirection,
    period: `past ${input.lookbackDays} day(s)`,
    center,
    bbox,
    coverage: {
      validWindPoints: wind.validMask.filter(Boolean).length,
      totalWindPoints: grid.rows * grid.cols,
      validCurrentPoints: 1,
      totalCurrentPoints: 1,
    },
    gisData: {
      type: "wind-field",
      windField: {
        bbox,
        grid,
        u: wind.u,
        v: wind.v,
        speed: wind.speed,
        validMask: wind.validMask,
        timestamp,
        source: "open-meteo",
      },
    },
  };
}

function assertHasLocation(input: Pick<WeatherFetchInput, "center" | "bbox">): void {
  if (!input.center && !input.bbox) {
    throw new Error("WeatherFetch requires either center or bbox. It will not guess a default location.");
  }
}

function bboxFromCenter(center: Coordinate): Bbox {
  return {
    west: roundCoord(center.lng - DEFAULT_CENTER_HALF_SPAN_DEG),
    east: roundCoord(center.lng + DEFAULT_CENTER_HALF_SPAN_DEG),
    south: roundCoord(center.lat - DEFAULT_CENTER_HALF_SPAN_DEG),
    north: roundCoord(center.lat + DEFAULT_CENTER_HALF_SPAN_DEG),
  };
}

function centerFromBbox(bbox: Bbox): Coordinate {
  return {
    lat: roundCoord((bbox.south + bbox.north) / 2),
    lng: roundCoord((bbox.west + bbox.east) / 2),
  };
}

function buildGridCoordinates(bbox: Bbox, grid: { rows: number; cols: number }): Coordinate[] {
  const coordinates: Coordinate[] = [];
  for (let row = 0; row < grid.rows; row += 1) {
    const lat = interpolate(bbox.south, bbox.north, row, grid.rows);
    for (let col = 0; col < grid.cols; col += 1) {
      coordinates.push({
        lat: roundCoord(lat),
        lng: roundCoord(interpolate(bbox.west, bbox.east, col, grid.cols)),
      });
    }
  }
  return coordinates;
}

function interpolate(start: number, end: number, index: number, count: number): number {
  return count <= 1 ? start : start + ((end - start) * index) / (count - 1);
}

function buildForecastUrl(coordinates: Coordinate[], input: WeatherFetchInput): string {
  const params = new URLSearchParams({
    latitude: coordinates.map((coordinate) => String(coordinate.lat)).join(","),
    longitude: coordinates.map((coordinate) => String(coordinate.lng)).join(","),
    hourly: "wind_speed_10m,wind_direction_10m",
    past_days: String(input.lookbackDays),
    forecast_days: "0",
    timezone: input.timezone,
  });
  return `${FORECAST_URL}?${params}`;
}

function buildMarineUrl(center: Coordinate, input: WeatherFetchInput): string {
  const params = new URLSearchParams({
    latitude: String(center.lat),
    longitude: String(center.lng),
    hourly: "ocean_current_velocity,ocean_current_direction",
    past_days: String(input.lookbackDays),
    forecast_days: "0",
    timezone: input.timezone,
  });
  return `${MARINE_URL}?${params}`;
}

async function fetchJson(url: string, timeoutMs: number, parentSignal: AbortSignal | undefined): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("request_timeout"), timeoutMs);
  const abortFromParent = () => controller.abort(parentSignal?.reason ?? "aborted");
  if (parentSignal?.aborted) abortFromParent();
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

function extractWindField(raw: unknown, grid: { rows: number; cols: number }): {
  u: number[];
  v: number[];
  speed: number[];
  validSpeed: number[];
  validMask: boolean[];
  directionDeg: number[];
} {
  const total = grid.rows * grid.cols;
  const responses = normalizeMultiLocationResponse(raw);
  if (responses.length !== total) {
    throw new Error(`Open-Meteo forecast returned ${responses.length} location(s); expected ${total}.`);
  }

  const u: Array<number | null> = [];
  const v: Array<number | null> = [];
  const speed: Array<number | null> = [];
  const validSpeed: number[] = [];
  const validMask: boolean[] = [];
  const directionDeg: number[] = [];

  for (const response of responses) {
    const hourly = response.hourly ?? {};
    const windSpeed = lastFinite(readNumberArray(hourly.wind_speed_10m));
    const windDirection = lastFinite(readNumberArray(hourly.wind_direction_10m));
    if (windSpeed === undefined || windDirection === undefined) {
      u.push(null);
      v.push(null);
      speed.push(null);
      validMask.push(false);
      continue;
    }
    const vector = directionSpeedToUv(windSpeed, windDirection);
    u.push(roundMetric(vector.u));
    v.push(roundMetric(vector.v));
    speed.push(roundMetric(windSpeed));
    validSpeed.push(roundMetric(windSpeed));
    validMask.push(true);
    directionDeg.push(windDirection);
  }

  if (directionDeg.length === 0) {
    throw new Error("Open-Meteo forecast response has no valid wind_speed_10m/wind_direction_10m data.");
  }

  const filled = fillMissingWindPoints({ u, v, speed }, grid);

  return {
    u: filled.u,
    v: filled.v,
    speed: filled.speed,
    validSpeed,
    validMask,
    directionDeg,
  };
}

function fillMissingWindPoints(
  input: {
    u: Array<number | null>;
    v: Array<number | null>;
    speed: Array<number | null>;
  },
  grid: { rows: number; cols: number }
): { u: number[]; v: number[]; speed: number[] } {
  const validIndexes = input.speed
    .map((value, index) => (typeof value === "number" ? index : -1))
    .filter((index) => index >= 0);

  return {
    u: input.u.map((value, index) => value ?? input.u[findNearestIndex(index, validIndexes, grid)]!),
    v: input.v.map((value, index) => value ?? input.v[findNearestIndex(index, validIndexes, grid)]!),
    speed: input.speed.map((value, index) => value ?? input.speed[findNearestIndex(index, validIndexes, grid)]!),
  };
}

function findNearestIndex(index: number, candidates: number[], grid: { rows: number; cols: number }): number {
  const row = Math.floor(index / grid.cols);
  const col = index % grid.cols;
  let nearest = candidates[0]!;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const candidateRow = Math.floor(candidate / grid.cols);
    const candidateCol = candidate % grid.cols;
    const distance = Math.abs(candidateRow - row) + Math.abs(candidateCol - col);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function extractCurrent(raw: unknown): { speed: number; directionDeg: number } {
  const response = normalizeSingleLocationResponse(raw);
  const hourly = response.hourly ?? {};
  const speed = lastFinite(readNumberArray(hourly.ocean_current_velocity));
  const directionDeg = lastFinite(readNumberArray(hourly.ocean_current_direction));
  if (speed === undefined || directionDeg === undefined) {
    throw new Error("Open-Meteo marine response is missing complete ocean current data.");
  }

  return {
    speed: roundMetric(speed),
    directionDeg,
  };
}

function normalizeMultiLocationResponse(raw: unknown): HourlyResponse[] {
  if (Array.isArray(raw)) {
    return raw.filter((entry): entry is HourlyResponse => isRecord(entry));
  }
  return isRecord(raw) ? [raw] : [];
}

function normalizeSingleLocationResponse(raw: unknown): HourlyResponse {
  if (Array.isArray(raw)) {
    const first = raw.find((entry): entry is HourlyResponse => isRecord(entry));
    if (first) return first;
  }
  if (isRecord(raw)) return raw;
  return {};
}

function readNumberArray(value: unknown): Array<number | null> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((entry) => (typeof entry === "number" && Number.isFinite(entry) ? entry : null));
}

function lastFinite(values: Array<number | null> | undefined): number | undefined {
  if (!values) return undefined;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function directionSpeedToUv(speed: number, directionDeg: number): { u: number; v: number } {
  const flowDeg = (directionDeg + 180) % 360;
  const rad = (flowDeg * Math.PI) / 180;
  return {
    u: speed * Math.sin(rad),
    v: speed * Math.cos(rad),
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    throw new Error("Cannot average an empty numeric series.");
  }
  return roundMetric(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function averageDirectionDegrees(values: number[]): number {
  if (values.length === 0) {
    throw new Error("Cannot average an empty direction series.");
  }

  const vector = values.reduce(
    (acc, value) => {
      const rad = (value * Math.PI) / 180;
      acc.x += Math.sin(rad);
      acc.y += Math.cos(rad);
      return acc;
    },
    { x: 0, y: 0 }
  );
  const degrees = (Math.atan2(vector.x, vector.y) * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}

function degreesToCompass(degrees: number): string {
  const dirs = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
  return dirs[Math.round(((degrees % 360) + 360) / 45) % 8]!;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(2));
}

function roundCoord(value: number): number {
  return Number(value.toFixed(6));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
