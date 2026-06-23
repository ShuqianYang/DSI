import { z } from "zod";
import type { ToolDefinition, ToolExecutionContext } from "../../_shared/types.js";
import {
  cleanupSatelliteSliceCallback,
  registerSatelliteSliceCallback,
  type SatelliteSliceCallbackPayload,
} from "./satelliteCallbackStore.js";

const CDSE_TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const CDSE_STAC_URL = "https://stac.dataspace.copernicus.eu/v1/search";
const CDSE_BROWSER_URL = "https://browser.dataspace.copernicus.eu";
const LEGACY_DEMAND_URL = process.env.SATELLITE_DEMAND_URL || "http://192.168.0.129:5000/agent/zh/demand";

const DEFAULT_MAX_CLOUD = 30;
const DEFAULT_TOP = 10;
const MAX_TOP = 50;
const MAX_RESULT_SIZE_CHARS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const KM_PER_LATITUDE_DEGREE = 111.32;
const LEGACY_DEMAND_CALLBACK_TIMEOUT_MS = parsePositiveInt(
  process.env.SATELLITE_DEMAND_CALLBACK_TIMEOUT_MS,
  300_000
);
const LEGACY_DEMAND_SUBMIT_TIMEOUT_MS = parsePositiveInt(
  process.env.SATELLITE_DEMAND_SUBMIT_TIMEOUT_MS,
  8_000
);

// ─── CDSE OAuth ───

const CDSE_CLIENT_ID = process.env.CDSE_CLIENT_ID || "";
const CDSE_CLIENT_SECRET = process.env.CDSE_CLIENT_SECRET || "";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  if (!CDSE_CLIENT_ID || !CDSE_CLIENT_SECRET) return null;

  // Return cached token if not expired (with 60s buffer)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CDSE_CLIENT_ID,
    client_secret: CDSE_CLIENT_SECRET,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("token_timeout"), 10_000);

  try {
    const res = await fetch(CDSE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
    }

    const json = await res.json() as { access_token: string; expires_in: number };
    cachedToken = {
      token: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    return cachedToken.token;
  } catch (error) {
    // Token failure is non-fatal: STAC search may still work anonymously
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Schemas ───

const BboxSchema = z
  .strictObject({
    west: z.number().min(-180).max(180),
    east: z.number().min(-180).max(180),
    south: z.number().min(-90).max(90),
    north: z.number().min(-90).max(90),
  })
  .refine((bbox) => bbox.west < bbox.east, "bbox.west must be less than bbox.east")
  .refine((bbox) => bbox.south < bbox.north, "bbox.south must be less than bbox.north");

const TargetPointSchema = z.strictObject({
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
});

const SatelliteImageSearchInputSchema = z
  .strictObject({
    regionName: z.string().trim().min(1).optional().describe("Named region for display only."),
    bbox: BboxSchema.optional().describe("Bounding box to search within. Required unless targetPoint is provided. When targetPoint is present, bbox is used as a clipping boundary."),
    targetPoint: TargetPointSchema.optional().describe("Event center point. Used with searchRadiusKm to compute a focused bbox."),
    searchRadiusKm: z.number().min(1).max(500).default(30).describe("Radius around targetPoint for focused search."),
    startDate: z.string().trim().min(1).optional().describe("Start date in ISO format (e.g. '2024-05-01'). Defaults to 30 days before endDate."),
    endDate: z.string().trim().min(1).optional().describe("End date in ISO format (e.g. '2024-05-10'). Defaults to today."),
    maxCloudCoverage: z.number().min(0).max(100).default(DEFAULT_MAX_CLOUD).describe("Maximum cloud coverage percentage."),
    source: z.enum(["sentinel-2", "landsat-8", "any"]).default("any").describe("Satellite source preference."),
    maxResults: z.number().int().min(1).max(MAX_TOP).default(DEFAULT_TOP).describe("Maximum number of results to return."),
  })
  .refine((input) => Boolean(input.bbox || input.targetPoint), "SatelliteImageSearch requires either bbox or targetPoint.");

type SatelliteImageSearchInput = z.infer<typeof SatelliteImageSearchInputSchema>;

interface SatelliteImage {
  id: string;
  name: string;
  source: "sentinel-2" | "landsat-8" | "unknown";
  acquisitionDate: string;
  cloudCoverage: number | null;
  resolution: number | null;
  bbox: { west: number; east: number; south: number; north: number };
  footprint: string; // GeoJSON string
  thumbnailUrl: string | null;
  downloadUrl: string | null;
  browserUrl: string;
}

interface SatelliteImageSearchOutput {
  summary: string;
  provider: "legacy-demand" | "open-stac";
  fallbackReason?: string;
  query: {
    regionName?: string;
    bbox: { west: number; east: number; south: number; north: number };
    startDate: string;
    endDate: string;
    maxCloudCoverage: number;
    source: string;
  };
  images: SatelliteImage[];
  totalCount: number;
  gisData: {
    type: "image";
    imageOverlays: Array<{
      id: string;
      url: string;
      rectangle: { west: number; south: number; east: number; north: number };
      alpha?: number;
    }>;
    cameraView: {
      type: "fit-bbox";
      bbox: { west: number; east: number; south: number; north: number };
    };
  };
}

// ─── STAC Types ───

interface StacFeature {
  id: string;
  collection: string;
  bbox: [number, number, number, number];
  properties: {
    datetime?: string;
    "eo:cloud_cover"?: number;
    [key: string]: unknown;
  };
  assets: Record<string, { href?: string; [key: string]: unknown }>;
}

interface StacResponse {
  features?: StacFeature[];
}

// ─── Tool Definition ───

export function buildSatelliteImageSearchTool(): ToolDefinition {
  return {
    name: "SatelliteImageSearch",
    aliases: ["satellite-image-search"],
    description:
      'Search satellite imagery metadata from legacy satellite demand first, then Copernicus Data Space (Sentinel-2, Landsat) by bounding box/date range. Input: {"bbox":{"west":117,"east":122.5,"south":22,"north":26.5},"startDate":"2024-05-01","endDate":"2024-05-10","maxCloudCoverage":20}. For disaster events, prefer {"targetPoint":{"lon":123,"lat":30.25},"searchRadiusKm":30,"bbox":{...region bbox...}} so the tool computes a focused bbox clipped to the region. Returns image metadata with acquisition date, cloud coverage, thumbnail links, and browser links.',
    kind: "domain",
    inputSchema: SatelliteImageSearchInputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    maxResultSizeChars: MAX_RESULT_SIZE_CHARS,
    async execute(input, context) {
      const parsed = SatelliteImageSearchInputSchema.parse(input);
      return executeSatelliteImageSearch(parsed, context);
    },
  };
}

async function executeSatelliteImageSearch(
  input: SatelliteImageSearchInput,
  context: ToolExecutionContext
): Promise<SatelliteImageSearchOutput> {
  const { regionName, startDate, endDate, maxCloudCoverage, source, maxResults } = input;
  const bbox = computeSearchBbox(input);

  const effectiveEnd = endDate ? new Date(endDate) : new Date();
  const effectiveStart = startDate
    ? new Date(startDate)
    : new Date(effectiveEnd.getTime() - 30 * 24 * 60 * 60 * 1000);

  const startIso = effectiveStart.toISOString();
  const endIso = effectiveEnd.toISOString();

  context.onProgress?.({
    stage: "start",
    message: `Searching satellite imagery for ${regionName ?? "specified bbox"} (${startIso.slice(0, 10)} to ${endIso.slice(0, 10)})`,
  });

  const legacyResult = await searchLegacyDemand(
    input,
    bbox,
    startIso,
    endIso,
    context
  );
  if (legacyResult.image) {
    const legacyImages = [legacyResult.image];
    context.onProgress?.({
      stage: "complete",
      message: "Received satellite image from legacy demand callback",
      data: { provider: "legacy-demand", requirementId: legacyResult.requirementId },
    });

    return {
      summary: buildLegacySummary(legacyResult.image, regionName),
      provider: "legacy-demand",
      query: {
        regionName,
        bbox,
        startDate: startIso,
        endDate: endIso,
        maxCloudCoverage,
        source,
      },
      images: legacyImages,
      totalCount: legacyImages.length,
      gisData: buildGisData(legacyImages, regionName, bbox),
    };
  }

  if (legacyResult.fallbackReason) {
    context.onProgress?.({
      stage: "warning",
      message: `Legacy satellite demand unavailable; falling back to open STAC: ${legacyResult.fallbackReason}`,
    });
  }

  const images: SatelliteImage[] = [];

  // Search Sentinel-2
  if (source === "sentinel-2" || source === "any") {
    try {
      const s2Images = await searchStac(
        "sentinel-2-l2a",
        bbox,
        startIso,
        endIso,
        maxCloudCoverage,
        maxResults,
        context.signal
      );
      images.push(...s2Images);
    } catch (error) {
      context.onProgress?.({
        stage: "warning",
        message: `Sentinel-2 STAC search failed: ${formatErrorMessage(error)}`,
      });
    }
  }

  // Search Landsat-8/9
  if (source === "landsat-8" || source === "any") {
    try {
      const lsImages = await searchStac(
        "landsat-8-l2",
        bbox,
        startIso,
        endIso,
        maxCloudCoverage,
        maxResults,
        context.signal
      );
      images.push(...lsImages);
    } catch (error) {
      context.onProgress?.({
        stage: "warning",
        message: `Landsat STAC search failed: ${formatErrorMessage(error)}`,
      });
    }
  }

  // Sort by acquisition date descending
  images.sort((a, b) => new Date(b.acquisitionDate).getTime() - new Date(a.acquisitionDate).getTime());

  const limited = images.slice(0, maxResults);

  context.onProgress?.({
    stage: "complete",
    message: `Found ${limited.length} satellite image(s)`,
    data: { totalCount: limited.length },
  });

  return {
    summary: buildSummary(limited, regionName, startIso, endIso),
    provider: "open-stac",
    fallbackReason: legacyResult.fallbackReason,
    query: {
      regionName,
      bbox,
      startDate: startIso,
      endDate: endIso,
      maxCloudCoverage,
      source,
    },
    images: limited,
    totalCount: limited.length,
    gisData: buildGisData(limited, regionName, bbox),
  };
}

interface LegacyDemandResult {
  image?: SatelliteImage;
  requirementId?: string;
  fallbackReason?: string;
}

function computeSearchBbox(input: SatelliteImageSearchInput): { west: number; east: number; south: number; north: number } {
  if (!input.targetPoint) {
    if (!input.bbox) {
      throw new Error("SatelliteImageSearch requires either bbox or targetPoint.");
    }
    return { ...input.bbox };
  }

  const focused = bboxAroundPoint(input.targetPoint, input.searchRadiusKm);
  if (!input.bbox) return focused;

  return intersectBbox(focused, input.bbox) ?? { ...input.bbox };
}

function bboxAroundPoint(
  point: { lon: number; lat: number },
  radiusKm: number
): { west: number; east: number; south: number; north: number } {
  const latDelta = radiusKm / KM_PER_LATITUDE_DEGREE;
  const latRadians = point.lat * Math.PI / 180;
  const longitudeKmPerDegree = Math.max(KM_PER_LATITUDE_DEGREE * Math.cos(latRadians), 0.01);
  const lonDelta = radiusKm / longitudeKmPerDegree;

  return {
    west: clamp(point.lon - lonDelta, -180, 180),
    east: clamp(point.lon + lonDelta, -180, 180),
    south: clamp(point.lat - latDelta, -90, 90),
    north: clamp(point.lat + latDelta, -90, 90),
  };
}

function intersectBbox(
  a: { west: number; east: number; south: number; north: number },
  b: { west: number; east: number; south: number; north: number }
): { west: number; east: number; south: number; north: number } | null {
  const intersection = {
    west: Math.max(a.west, b.west),
    east: Math.min(a.east, b.east),
    south: Math.max(a.south, b.south),
    north: Math.min(a.north, b.north),
  };

  if (intersection.west >= intersection.east || intersection.south >= intersection.north) {
    return null;
  }

  return intersection;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function searchLegacyDemand(
  input: SatelliteImageSearchInput,
  searchBbox: { west: number; east: number; south: number; north: number },
  startIso: string,
  endIso: string,
  context: ToolExecutionContext
): Promise<LegacyDemandResult> {
  const requirementId = `REQ-SAT-${Date.now()}`;
  const callBackUrl = buildCallbackUrl();
  const payload = buildLegacyDemandPayload(input, searchBbox, startIso, endIso, requirementId, callBackUrl);

  context.onProgress?.({
    stage: "start",
    message: `Submitting legacy satellite demand for ${input.regionName ?? "specified bbox"}`,
    data: { requirementId },
  });

  let actualRequirementId = requirementId;
  try {
    const response = await fetchWithTimeout(
      LEGACY_DEMAND_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      },
      LEGACY_DEMAND_SUBMIT_TIMEOUT_MS,
      context.signal
    );

    const responseText = await response.text();
    if (!response.ok) {
      return { fallbackReason: `legacy demand HTTP ${response.status}: ${responseText.slice(0, 200)}` };
    }

    const returnedRequirementId = readRequirementId(parseJsonObject(responseText));
    if (!returnedRequirementId) {
      return { fallbackReason: "legacy demand returned no requirementId/value" };
    }
    actualRequirementId = returnedRequirementId;
  } catch (error) {
    return { fallbackReason: `legacy demand request failed: ${formatErrorMessage(error)}` };
  }

  const callbackPayload = await waitForLegacyCallback(
    actualRequirementId,
    LEGACY_DEMAND_CALLBACK_TIMEOUT_MS,
    context.signal
  );

  if (!callbackPayload) {
    return {
      requirementId: actualRequirementId,
      fallbackReason: `legacy demand callback timeout after ${LEGACY_DEMAND_CALLBACK_TIMEOUT_MS}ms`,
    };
  }

  if (!callbackPayload.url) {
    return {
      requirementId: actualRequirementId,
      fallbackReason: "legacy demand callback returned no image url",
    };
  }

  return {
    requirementId: actualRequirementId,
    image: legacyCallbackToImage(callbackPayload, searchBbox),
  };
}

function buildLegacyDemandPayload(
  input: SatelliteImageSearchInput,
  searchBbox: { west: number; east: number; south: number; north: number },
  startIso: string,
  endIso: string,
  requirementId: string,
  callBackUrl: string
) {
  const regionName = input.regionName ?? "指定区域";
  const now = Date.now();

  return {
    requirementId,
    requirementName: `${regionName} 卫星影像查询需求`,
    requirementSource: "天基信息服务系统",
    startTime: new Date(startIso).getTime(),
    endTime: new Date(endIso).getTime(),
    areaBounds: bboxToPolygon(searchBbox),
    targetType: "卫星影像",
    targetName: regionName,
    algorithm: "卫星影像检索",
    payloadMode: input.source === "landsat-8" ? "光学影像" : "可见光",
    productType: "目标切片",
    priority: "normal",
    resolution: input.source === "landsat-8" ? "30" : "10",
    trackType: "低",
    timeConstraints: JSON.stringify({
      latestStartTime: now,
      startDate: startIso,
      endDate: endIso,
    }),
    duration: null,
    timeLimitRequirement: "5分钟内",
    rawPayload: {
      mode: 2,
      bbox: searchBbox,
      regionBbox: input.bbox,
      targetPoint: input.targetPoint,
      searchRadiusKm: input.searchRadiusKm,
      source: input.source,
      maxCloudCoverage: input.maxCloudCoverage,
      maxResults: input.maxResults,
    },
    submitTime: now,
    callBackUrl,
  };
}

function bboxToPolygon(bbox: { west: number; east: number; south: number; north: number }) {
  return {
    type: "Polygon",
    coordinates: [[
      [bbox.west, bbox.south],
      [bbox.east, bbox.south],
      [bbox.east, bbox.north],
      [bbox.west, bbox.north],
      [bbox.west, bbox.south],
    ]],
  };
}

function buildCallbackUrl(): string {
  if (process.env.SATELLITE_DEMAND_CALLBACK_URL) {
    return process.env.SATELLITE_DEMAND_CALLBACK_URL;
  }

  const callbackHost = process.env.CALLBACK_HOST || "localhost";
  const callbackPort = process.env.API_PORT || "3001";
  return `http://${callbackHost}:${callbackPort}/agent/callback/slice`;
}

async function waitForLegacyCallback(
  requirementId: string,
  timeoutMs: number,
  parentSignal: AbortSignal | undefined
): Promise<SatelliteSliceCallbackPayload | null> {
  const callbackPromise = registerSatelliteSliceCallback(requirementId);
  let timeout: NodeJS.Timeout | undefined;
  let abortHandler: (() => void) | undefined;

  const timeoutPromise = new Promise<null>((resolve) => {
    timeout = setTimeout(() => resolve(null), timeoutMs);
  });

  const abortPromise = new Promise<null>((resolve) => {
    if (!parentSignal) return;
    abortHandler = () => resolve(null);
    if (parentSignal.aborted) {
      resolve(null);
    } else {
      parentSignal.addEventListener("abort", abortHandler, { once: true });
    }
  });

  try {
    return await Promise.race([callbackPromise, timeoutPromise, abortPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (abortHandler) parentSignal?.removeEventListener("abort", abortHandler);
    cleanupSatelliteSliceCallback(requirementId);
  }
}

function legacyCallbackToImage(
  payload: SatelliteSliceCallbackPayload,
  fallbackBbox: { west: number; east: number; south: number; north: number }
): SatelliteImage {
  const imageBbox = bboxFromCallback(payload, fallbackBbox);
  const id = payload.source_image_id || payload.id || payload.requirementId || "legacy-satellite-image";

  return {
    id,
    name: id,
    source: "unknown",
    acquisitionDate: payload.acquisition_time ?? new Date().toISOString(),
    cloudCoverage: null,
    resolution: typeof payload.resolution === "number" ? payload.resolution : null,
    bbox: imageBbox,
    footprint: "",
    thumbnailUrl: payload.url ?? null,
    downloadUrl: payload.url ?? null,
    browserUrl: payload.url ?? buildBrowserUrl([
      imageBbox.west,
      imageBbox.south,
      imageBbox.east,
      imageBbox.north,
    ]),
  };
}

function bboxFromCallback(
  payload: SatelliteSliceCallbackPayload,
  fallbackBbox: { west: number; east: number; south: number; north: number }
) {
  const lonValues = [
    payload.lon_ul,
    payload.lon_ur,
    payload.lon_ll,
    payload.lon_lr,
  ].filter((value): value is number => typeof value === "number");
  const latValues = [
    payload.lat_ul,
    payload.lat_ur,
    payload.lat_ll,
    payload.lat_lr,
  ].filter((value): value is number => typeof value === "number");

  if (lonValues.length >= 2 && latValues.length >= 2) {
    return {
      west: Math.min(...lonValues),
      east: Math.max(...lonValues),
      south: Math.min(...latValues),
      north: Math.max(...latValues),
    };
  }

  return { ...fallbackBbox };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function readRequirementId(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const direct = payload.value ?? payload.requirementId;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const data = payload.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const nested = (data as Record<string, unknown>).requirementId ?? (data as Record<string, unknown>).value;
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }

  return null;
}

function buildLegacySummary(image: SatelliteImage, regionName: string | undefined): string {
  const date = image.acquisitionDate ? image.acquisitionDate.slice(0, 10) : "未知时间";
  const resolution = image.resolution === null ? "未知分辨率" : `${image.resolution}m`;
  return `已通过旧天基提报获取 ${regionName ?? "指定区域"} 卫星影像：${image.name}，采集时间 ${date}，分辨率 ${resolution}。`;
}

// ─── CDSE STAC Search ───

async function searchStac(
  collection: string,
  bbox: { west: number; east: number; south: number; north: number },
  startTime: string,
  endTime: string,
  maxCloud: number,
  limit: number,
  parentSignal: AbortSignal | undefined
): Promise<SatelliteImage[]> {
  const token = await getAccessToken();

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const body = JSON.stringify({
    collections: [collection],
    bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
    datetime: `${startTime}/${endTime}`,
    limit,
    filter: {
      op: "<=",
      args: [{ property: "eo:cloud_cover" }, maxCloud],
    },
    "filter-lang": "cql2-json",
    sortby: [{ field: "properties.datetime", direction: "desc" }],
    fields: {
      include: ["id", "collection", "properties.datetime", "properties.eo:cloud_cover", "assets", "bbox"],
      exclude: ["geometry"],
    },
  });

  const data = await fetchJson(CDSE_STAC_URL, {
    method: "POST",
    headers,
    body,
  }, DEFAULT_REQUEST_TIMEOUT_MS, parentSignal);

  const response = data as StacResponse;
  if (!response.features) return [];

  const sourceName = collection.startsWith("sentinel") ? "sentinel-2" :
    collection.startsWith("landsat") ? "landsat-8" : "unknown";
  const resolution = sourceName === "sentinel-2" ? 10 : sourceName === "landsat-8" ? 30 : null;

  return response.features
    .map((feature): SatelliteImage | null => {
      const cloud = feature.properties["eo:cloud_cover"];
      const cloudCoverage = typeof cloud === "number" ? cloud : null;

      return {
        id: feature.id,
        name: feature.id, // STAC does not have a separate "name" field
        source: sourceName,
        acquisitionDate: feature.properties.datetime ?? "",
        cloudCoverage,
        resolution,
        bbox: {
          west: feature.bbox[0],
          south: feature.bbox[1],
          east: feature.bbox[2],
          north: feature.bbox[3],
        },
        footprint: "", // geometry excluded from fields
        thumbnailUrl: feature.assets?.thumbnail?.href ?? null,
        downloadUrl: null, // Requires CDSE authentication
        browserUrl: buildBrowserUrl(feature.bbox),
      };
    })
    .filter((img): img is SatelliteImage => img !== null && img.acquisitionDate !== "");
}

// ─── Helpers ───

function buildBrowserUrl(bbox: [number, number, number, number]): string {
  const [west, south, east, north] = bbox;
  const centerLng = (west + east) / 2;
  const centerLat = (south + north) / 2;
  return `${CDSE_BROWSER_URL}/?zoom=10&lat=${centerLat}&lng=${centerLng}`;
}

function buildSummary(images: SatelliteImage[], regionName: string | undefined, startIso: string, endIso: string): string {
  if (images.length === 0) {
    return `未在 ${regionName ?? "指定区域"} 查询到符合条件的卫星影像（${startIso.slice(0, 10)} 至 ${endIso.slice(0, 10)}）。`;
  }

  const s2Count = images.filter((i) => i.source === "sentinel-2").length;
  const lsCount = images.filter((i) => i.source === "landsat-8").length;

  let summary = `在 ${regionName ?? "指定区域"} 查询到 ${images.length} 张卫星影像（${startIso.slice(0, 10)} 至 ${endIso.slice(0, 10)}）。`;
  if (s2Count > 0) summary += ` Sentinel-2: ${s2Count} 张`;
  if (lsCount > 0) summary += ` Landsat: ${lsCount} 张`;
  summary += "。";

  const best = images[0];
  if (best) {
    summary += ` 最新影像：${best.name}（${best.acquisitionDate.slice(0, 10)}）`;
    if (best.cloudCoverage !== null) summary += `，云量 ${best.cloudCoverage.toFixed(1)}%`;
    summary += "。";
  }

  return summary;
}

// 卫星来源 → 边框颜色映射
const SATELLITE_SOURCE_COLORS: Record<string, string> = {
  "sentinel-2": "#00E0FF", // 青色
  "landsat-8": "#FFAA00",  // 橙色
  unknown: "#FF44FF",      // 品红
};

function buildGisData(
  images: SatelliteImage[],
  regionName: string | undefined,
  queryBbox: { west: number; east: number; south: number; north: number }
): SatelliteImageSearchOutput["gisData"] {
  const overlays = images
    .filter((img) => img.thumbnailUrl || img.browserUrl)
    .map((img) => ({
      id: `satellite-${img.source}-${img.id}`,
      url: img.thumbnailUrl ?? img.browserUrl,
      rectangle: {
        west: img.bbox.west,
        south: img.bbox.south,
        east: img.bbox.east,
        north: img.bbox.north,
      },
      alpha: 0.85,
      outlineColor: SATELLITE_SOURCE_COLORS[img.source] ?? SATELLITE_SOURCE_COLORS.unknown,
    }));

  return {
    type: "image",
    imageOverlays: overlays,
    cameraView: {
      type: "fit-bbox",
      bbox: { ...queryBbox },
    },
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  parentSignal: AbortSignal | undefined
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("request_timeout"), timeoutMs);
  const abortFromParent = () => controller.abort(parentSignal?.reason ?? "aborted");
  if (parentSignal?.aborted) abortFromParent();
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  parentSignal: AbortSignal | undefined
): Promise<unknown> {
  const response = await fetchWithTimeout(url, init, timeoutMs, parentSignal);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return await response.json();
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
