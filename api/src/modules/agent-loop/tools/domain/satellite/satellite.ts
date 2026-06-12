import { z } from "zod";
import type { ToolDefinition, ToolExecutionContext } from "../../_shared/types.js";

const CDSE_TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const CDSE_STAC_URL = "https://stac.dataspace.copernicus.eu/v1/search";
const CDSE_BROWSER_URL = "https://browser.dataspace.copernicus.eu";

const DEFAULT_MAX_CLOUD = 30;
const DEFAULT_TOP = 10;
const MAX_TOP = 50;
const MAX_RESULT_SIZE_CHARS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

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

const SatelliteImageSearchInputSchema = z.strictObject({
  regionName: z.string().trim().min(1).optional().describe("Named region for display only."),
  bbox: BboxSchema.describe("Bounding box to search within."),
  startDate: z.string().trim().min(1).optional().describe("Start date in ISO format (e.g. '2024-05-01'). Defaults to 30 days before endDate."),
  endDate: z.string().trim().min(1).optional().describe("End date in ISO format (e.g. '2024-05-10'). Defaults to today."),
  maxCloudCoverage: z.number().min(0).max(100).default(DEFAULT_MAX_CLOUD).describe("Maximum cloud coverage percentage."),
  source: z.enum(["sentinel-2", "landsat-8", "any"]).default("any").describe("Satellite source preference."),
  maxResults: z.number().int().min(1).max(MAX_TOP).default(DEFAULT_TOP).describe("Maximum number of results to return."),
});

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
      'Search satellite imagery metadata from Copernicus Data Space (Sentinel-2, Landsat) by bounding box and date range. Input: {"bbox":{"west":117,"east":122.5,"south":22,"north":26.5},"startDate":"2024-05-01","endDate":"2024-05-10","maxCloudCoverage":20}. Returns image metadata with acquisition date, cloud coverage, thumbnail links, and browser links. Actual image download requires separate authentication. For named regions, call RegionResolve first to get bbox.',
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
  const { regionName, bbox, startDate, endDate, maxCloudCoverage, source, maxResults } = input;

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

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  parentSignal: AbortSignal | undefined
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("request_timeout"), timeoutMs);
  const abortFromParent = () => controller.abort(parentSignal?.reason ?? "aborted");
  if (parentSignal?.aborted) abortFromParent();
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
