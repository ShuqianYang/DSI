import { z } from "zod";
import type { ToolDefinition, ToolExecutionContext } from "../../_shared/types.js";

const USGS_API_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const GDACS_RSS_URL = "https://www.gdacs.org/xml/rss.xml";
const DEFAULT_TIME_RANGE = "30d";
const DEFAULT_MIN_MAGNITUDE = 4.0;
const MAX_RESULT_SIZE_CHARS = 40_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

const BboxSchema = z
  .strictObject({
    west: z.number().min(-180).max(180),
    east: z.number().min(-180).max(180),
    south: z.number().min(-90).max(90),
    north: z.number().min(-90).max(90),
  })
  .refine((bbox) => bbox.west < bbox.east, "bbox.west must be less than bbox.east")
  .refine((bbox) => bbox.south < bbox.north, "bbox.south must be less than bbox.north");

const DisasterQueryInputSchema = z.strictObject({
  regionName: z.string().trim().min(1).optional().describe("Named region for context (e.g. '台湾海峡'). The tool uses bbox for actual spatial query; regionName is for display only."),
  bbox: BboxSchema.optional().describe("Bounding box for spatial query. Preferred over regionName."),
  disasterType: z.enum(["earthquake", "flood", "typhoon", "fire", "all"]).default("all").describe("Type of disaster to query. 'all' includes all supported types."),
  timeRange: z.enum(["24h", "7d", "30d", "1y"]).default(DEFAULT_TIME_RANGE).describe("Time window for the query."),
  minMagnitude: z.number().min(0).max(10).default(DEFAULT_MIN_MAGNITUDE).describe("Minimum magnitude for earthquakes (ignored for other disaster types)."),
});

type DisasterQueryInput = z.infer<typeof DisasterQueryInputSchema>;

interface DisasterEvent {
  id: string;
  type: "earthquake" | "flood" | "typhoon" | "fire" | "volcano";
  title: string;
  time: string;
  location: { lat: number; lon: number };
  magnitude?: number;
  depth?: number;
  severity?: string;
  affectedArea?: {
    west: number;
    east: number;
    south: number;
    north: number;
  };
  sourceUrl: string;
  source: "usgs" | "gdacs";
}

interface DisasterQueryOutput {
  summary: string;
  query: {
    regionName?: string;
    bbox?: { west: number; east: number; south: number; north: number };
    disasterType: string;
    timeRange: string;
    minMagnitude: number;
  };
  events: DisasterEvent[];
  totalCount: number;
  dataSource: "usgs" | "gdacs" | "mixed";
  gisData: {
    type: "entity";
    entities: Array<{
      id: string;
      name: string;
      type: "earthquake" | "fire" | "flood" | "typhoon";
      coordinates: [number, number]; // [lng, lat]
      importance: "high" | "medium" | "low";
      status: "normal" | "warning" | "danger";
      description?: string;
    }>;
  };
}

export function buildDisasterQueryTool(): ToolDefinition {
  return {
    name: "DisasterQuery",
    aliases: ["disaster-query"],
    description:
      'Query recent disaster events (earthquakes, floods, typhoons, fires) from public APIs (USGS, GDACS) within a bounding box or global scope. Input: {"bbox":{"west":117,"east":122.5,"south":22,"north":26.5},"disasterType":"earthquake","timeRange":"30d","minMagnitude":4.0}. Returns a list of events with time, location, magnitude, and source links. For named regions, call RegionResolve first to get bbox, then pass it to this tool.',
    kind: "domain",
    inputSchema: DisasterQueryInputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    maxResultSizeChars: MAX_RESULT_SIZE_CHARS,
    async execute(input, context) {
      const parsed = DisasterQueryInputSchema.parse(input);
      return executeDisasterQuery(parsed, context);
    },
  };
}

async function executeDisasterQuery(input: DisasterQueryInput, context: ToolExecutionContext): Promise<DisasterQueryOutput> {
  const { regionName, bbox, disasterType, timeRange, minMagnitude } = input;

  // If no bbox provided, default to global scope
  const queryBbox = bbox ?? { west: -180, east: 180, south: -90, north: 90 };
  const { startTime, endTime } = parseTimeRange(timeRange);

  context.onProgress?.({
    stage: "start",
    message: `Querying ${disasterType} events in ${regionName ?? "global"} for ${timeRange}`,
  });

  const events: DisasterEvent[] = [];
  const sources: string[] = [];

  // Query USGS for earthquakes
  if (disasterType === "earthquake" || disasterType === "all") {
    try {
      const usgsEvents = await queryUsgsEarthquake(queryBbox, startTime, endTime, minMagnitude, context.signal);
      events.push(...usgsEvents);
      sources.push("usgs");
    } catch (error) {
      context.onProgress?.({
        stage: "warning",
        message: `USGS query failed: ${formatErrorMessage(error)}`,
      });
    }
  }

  // Query GDACS for floods, typhoons, fires, volcanoes
  if (disasterType !== "earthquake") {
    try {
      const gdacsEvents = await queryGdacs(disasterType, queryBbox, startTime, endTime, context.signal);
      events.push(...gdacsEvents);
      sources.push("gdacs");
    } catch (error) {
      context.onProgress?.({
        stage: "warning",
        message: `GDACS query failed: ${formatErrorMessage(error)}`,
      });
    }
  }

  // Sort by time descending
  events.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  const uniqueEvents = deduplicateEvents(events);

  context.onProgress?.({
    stage: "complete",
    message: `Found ${uniqueEvents.length} disaster event(s) from ${sources.join("+") ?? "none"}`,
    data: {
      totalCount: uniqueEvents.length,
      sources,
    },
  });

  return {
    summary: buildSummary(uniqueEvents, regionName, disasterType, timeRange),
    query: {
      regionName,
      bbox: queryBbox,
      disasterType,
      timeRange,
      minMagnitude,
    },
    events: uniqueEvents,
    totalCount: uniqueEvents.length,
    dataSource: sources.length > 1 ? "mixed" : (sources[0] as "usgs" | "gdacs") ?? "usgs",
    gisData: buildDisasterGisData(uniqueEvents),
  };
}

// ─── USGS Earthquake API ───

async function queryUsgsEarthquake(
  bbox: { west: number; east: number; south: number; north: number },
  startTime: string,
  endTime: string,
  minMagnitude: number,
  signal: AbortSignal | undefined
): Promise<DisasterEvent[]> {
  const params = new URLSearchParams({
    format: "geojson",
    minlatitude: String(bbox.south),
    maxlatitude: String(bbox.north),
    minlongitude: String(bbox.west),
    maxlongitude: String(bbox.east),
    starttime: startTime,
    endtime: endTime,
    minmagnitude: String(minMagnitude),
    orderby: "time",
  });

  const url = `${USGS_API_URL}?${params}`;
  const data = await fetchJson(url, DEFAULT_REQUEST_TIMEOUT_MS, signal);

  if (!isRecord(data) || !Array.isArray(data.features)) {
    throw new Error("USGS API returned unexpected format");
  }

  return data.features.map((feature: unknown): DisasterEvent => {
    const f = feature as Record<string, unknown>;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const geo = (f.geometry ?? {}) as Record<string, unknown>;
    const coords = Array.isArray(geo.coordinates) ? geo.coordinates : [0, 0];

    return {
      id: String(props.code ?? f.id ?? "unknown"),
      type: "earthquake",
      title: String(props.title ?? "Unknown earthquake"),
      time: new Date(Number(props.time) || 0).toISOString(),
      location: { lat: Number(coords[1]) || 0, lon: Number(coords[0]) || 0 },
      magnitude: Number(props.mag) || undefined,
      depth: Number(coords[2]) || undefined,
      severity: magnitudeToSeverity(Number(props.mag)),
      sourceUrl: String(props.url ?? ""),
      source: "usgs",
    };
  });
}

// ─── GDACS RSS API ───

async function queryGdacs(
  disasterType: string,
  bbox: { west: number; east: number; south: number; north: number },
  startTime: string,
  endTime: string,
  signal: AbortSignal | undefined
): Promise<DisasterEvent[]> {
  // GDACS RSS provides recent events globally; we filter by bbox and time client-side
  const data = await fetchJson(GDACS_RSS_URL, DEFAULT_REQUEST_TIMEOUT_MS, signal);

  // GDACS RSS returns XML; we'll use a simple text extraction approach
  // For now, fallback to empty results if XML parsing is needed
  // TODO: Implement proper RSS XML parsing if GDACS JSON endpoint is unavailable
  if (typeof data === "string") {
    return parseGdacsRss(data, disasterType, bbox, startTime, endTime);
  }

  return [];
}

function parseGdacsRss(
  xmlText: string,
  disasterType: string,
  bbox: { west: number; east: number; south: number; north: number },
  startTime: string,
  endTime: string
): DisasterEvent[] {
  const events: DisasterEvent[] = [];
  const startMs = new Date(startTime).getTime();
  const endMs = new Date(endTime).getTime();

  // Simple regex-based RSS parsing for GDACS
  const itemRegex = /<item>[\s\S]*?<\/item>/g;
  const items = xmlText.match(itemRegex) ?? [];

  for (const item of items) {
    const titleMatch = item.match(/<title>(.*?)<\/title>/);
    const linkMatch = item.match(/<link>(.*?)<\/link>/);
    const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);
    const latMatch = item.match(/<geo:lat>(.*?)<\/geo:lat>/);
    const lonMatch = item.match(/<geo:long>(.*?)<\/geo:long>/);
    const categoryMatch = item.match(/<category>(.*?)<\/category>/);

    if (!titleMatch || !pubDateMatch) continue;

    const title = decodeXmlEntities(titleMatch[1]);
    const eventTime = new Date(pubDateMatch[1]).getTime();
    if (eventTime < startMs || eventTime > endMs) continue;

    const lat = latMatch ? Number(latMatch[1]) : NaN;
    const lon = lonMatch ? Number(lonMatch[1]) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      if (lon < bbox.west || lon > bbox.east || lat < bbox.south || lat > bbox.north) continue;
    }

    const category = categoryMatch ? categoryMatch[1].toLowerCase() : "";
    const type = gdacsCategoryToType(category);

    // Filter by disaster type if not "all"
    if (disasterType !== "all" && type !== disasterType) continue;

    events.push({
      id: `gdacs-${eventTime}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      title,
      time: new Date(eventTime).toISOString(),
      location: { lat: Number.isFinite(lat) ? lat : 0, lon: Number.isFinite(lon) ? lon : 0 },
      severity: extractGdacsSeverity(title),
      sourceUrl: linkMatch ? linkMatch[1] : "https://www.gdacs.org",
      source: "gdacs",
    });
  }

  return events;
}

// ─── Helpers ───

function parseTimeRange(range: string): { startTime: string; endTime: string } {
  const end = new Date();
  const start = new Date(end);

  switch (range) {
    case "24h":
      start.setHours(start.getHours() - 24);
      break;
    case "7d":
      start.setDate(start.getDate() - 7);
      break;
    case "30d":
      start.setDate(start.getDate() - 30);
      break;
    case "1y":
      start.setFullYear(start.getFullYear() - 1);
      break;
    default:
      start.setDate(start.getDate() - 30);
  }

  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
}

function magnitudeToSeverity(mag: number): string {
  if (mag >= 7) return "严重";
  if (mag >= 6) return "重大";
  if (mag >= 5) return "中等";
  if (mag >= 4) return "轻微";
  return "微弱";
}

function gdacsCategoryToType(category: string): DisasterEvent["type"] {
  if (category.includes("earthquake") || category.includes("eq")) return "earthquake";
  if (category.includes("flood") || category.includes("fl")) return "flood";
  if (category.includes("tc") || category.includes("cyclone") || category.includes("typhoon")) return "typhoon";
  if (category.includes("fire") || category.includes("wildfire") || category.includes("wf")) return "fire";
  if (category.includes("volcano") || category.includes("vo")) return "volcano";
  return "earthquake"; // default
}

function extractGdacsSeverity(title: string): string {
  if (title.includes("Red alert")) return "红色警报";
  if (title.includes("Orange alert")) return "橙色警报";
  if (title.includes("Green alert")) return "绿色警报";
  return "未分级";
}

function deduplicateEvents(events: DisasterEvent[]): DisasterEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.source}:${event.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSummary(events: DisasterEvent[], regionName: string | undefined, disasterType: string, timeRange: string): string {
  if (events.length === 0) {
    return `未在 ${regionName ?? "指定区域"} 查询到 ${disasterType === "all" ? "任何灾情" : disasterType} 事件（${timeRange}）。`;
  }

  const typeCounts = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.type] = (acc[event.type] || 0) + 1;
    return acc;
  }, {});

  const typeSummary = Object.entries(typeCounts)
    .map(([type, count]) => `${translateDisasterType(type)} ${count} 起`)
    .join("，");

  const latest = events[0];
  let summary = `在 ${regionName ?? "指定区域"} 查询到 ${events.length} 起灾情事件（${timeRange}）：${typeSummary}。`;
  if (latest) {
    summary += ` 最新事件：${latest.title}（${latest.time.slice(0, 10)}）`;
    if (latest.magnitude) summary += `，震级 ${latest.magnitude}`;
    summary += "。";
  }
  return summary;
}

function translateDisasterType(type: string): string {
  const map: Record<string, string> = {
    earthquake: "地震",
    flood: "洪水",
    typhoon: "台风",
    fire: "火灾",
    volcano: "火山",
  };
  return map[type] ?? type;
}

function buildDisasterGisData(events: DisasterEvent[]): DisasterQueryOutput["gisData"] {
  const entities = events
    .filter((e) => Number.isFinite(e.location.lon) && Number.isFinite(e.location.lat))
    .map((e) => {
      const magnitude = e.magnitude ?? 0;
      const importance = magnitude >= 6 ? "high" : magnitude >= 5 ? "medium" : "low";
      const status = magnitude >= 6 ? "danger" : magnitude >= 4.5 ? "warning" : "normal";
      const entityType = e.type === "volcano" ? "fire" : e.type; // map volcano to fire for GIS display

      let description = `${e.title} | ${e.time.slice(0, 10)}`;
      if (e.magnitude) description += ` | 震级 ${e.magnitude}`;
      if (e.severity) description += ` | ${e.severity}`;

      return {
        id: `disaster-${e.source}-${e.id}`,
        name: e.title,
        type: entityType as "earthquake" | "fire" | "flood" | "typhoon",
        coordinates: [e.location.lon, e.location.lat] as [number, number],
        importance: importance as "high" | "medium" | "low",
        status: status as "normal" | "warning" | "danger",
        description,
      };
    });

  return {
    type: "entity",
    entities,
  };
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/<\!\[CDATA\[(.*?)\]\]>/g, "$1");
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
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("xml") || contentType.includes("rss")) {
      return await response.text();
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
