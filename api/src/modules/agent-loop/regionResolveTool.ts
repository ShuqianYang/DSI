import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ToolDefinition, ToolExecutionContext } from "./types.js";

const CHINA_GEOJSON_SOURCE = "public/geo/china.geojson";
const EAST_CHINA_SEA_SOURCE = "public/geo/eastern_china_sea.geojson";
const DEFAULT_MAX_CANDIDATES = 5;
const DEFAULT_MIN_CONFIDENCE = 0.8;
const MAX_RESULT_SIZE_CHARS = 40_000;

const RegionResolveInputSchema = z
  .strictObject({
    regionName: z.string().trim().min(1).optional(),
    query: z.string().trim().min(1).optional(),
    maxCandidates: z.number().int().min(1).max(20).default(DEFAULT_MAX_CANDIDATES),
    minConfidence: z.number().min(0).max(1).default(DEFAULT_MIN_CONFIDENCE),
  })
  .refine((input) => Boolean(input.regionName || input.query), "RegionResolve requires either regionName or query.");

type RegionResolveInput = z.infer<typeof RegionResolveInputSchema>;

interface Bbox {
  west: number;
  east: number;
  south: number;
  north: number;
}

interface RegionCandidate {
  id: string;
  name: string;
  aliases: string[];
  source: "geojson_asset";
  sourcePath: string;
  confidence: number;
  matchType: "exact_name" | "exact_alias" | "query_contains_name" | "query_contains_alias" | "partial";
  bbox: Bbox;
}

type RegionResolveOutput =
  | {
      resolved: true;
      selected: RegionCandidate;
      candidates: RegionCandidate[];
    }
  | {
      resolved: false;
      candidates: RegionCandidate[];
      requirement: {
        type: "region_geometry_missing" | "region_match_ambiguous";
        message: string;
      };
    };

interface RegionCatalogEntry {
  id: string;
  name: string;
  aliases: string[];
  sourcePath: string;
  bbox: Bbox;
}

interface GeoJsonFeatureCollection {
  type?: string;
  features?: GeoJsonFeature[];
}

interface GeoJsonFeature {
  type?: string;
  properties?: Record<string, unknown>;
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
}

let catalogPromise: Promise<RegionCatalogEntry[]> | undefined;

export function buildRegionResolveTool(): ToolDefinition {
  return {
    name: "RegionResolve",
    aliases: ["region-resolve"],
    description:
      'Resolve a named region from local GeoJSON assets into an authoritative bbox. Input: {"regionName":"东海"} or {"query":"请圈选福建省"}. Supports only configured local assets such as public/geo/china.geojson and public/geo/eastern_china_sea.geojson; it never searches the web or invents boundaries.',
    kind: "domain",
    inputSchema: RegionResolveInputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    maxResultSizeChars: MAX_RESULT_SIZE_CHARS,
    async execute(input, context) {
      const parsed = RegionResolveInputSchema.parse(input);
      return executeRegionResolve(parsed, context);
    },
  };
}

async function executeRegionResolve(
  input: RegionResolveInput,
  context: ToolExecutionContext
): Promise<RegionResolveOutput> {
  let catalog: RegionCatalogEntry[];
  try {
    catalog = await loadRegionCatalog();
  } catch (error) {
    return {
      resolved: false,
      candidates: [],
      requirement: {
        type: "region_geometry_missing",
        message: `Local GeoJSON region assets are unavailable: ${formatErrorMessage(error)}. Ask the user to provide bbox/polygon or add a GeoJSON asset for this region.`,
      },
    };
  }

  const searchText = normalizeText(input.regionName ?? input.query ?? context.query);
  const queryText = normalizeText(input.query ?? context.query);
  const maxCandidates = input.maxCandidates;
  const minConfidence = input.minConfidence;

  context.onProgress?.({
    stage: "start",
    message: `Resolving region from ${catalog.length} local GeoJSON region(s)`,
  });

  const candidates = catalog
    .map((entry) => scoreEntry(entry, searchText, queryText, Boolean(input.regionName)))
    .filter((candidate): candidate is RegionCandidate => Boolean(candidate))
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name, "zh-Hans-CN"))
    .slice(0, maxCandidates);

  const selected = candidates[0];
  if (selected && selected.confidence >= minConfidence) {
    context.onProgress?.({
      stage: "complete",
      message: `Resolved ${selected.name} from ${selected.sourcePath}`,
      data: {
        selected,
      },
    });
    return {
      resolved: true,
      selected,
      candidates,
    };
  }

  const requirementType = candidates.length > 0 ? "region_match_ambiguous" : "region_geometry_missing";
  return {
    resolved: false,
    candidates,
    requirement: {
      type: requirementType,
      message:
        requirementType === "region_match_ambiguous"
          ? "RegionResolve found local candidates but none met the confidence threshold. Ask the user to choose a candidate or provide bbox/polygon."
          : "Missing local region geometry. Ask the user to provide bbox/polygon or add a GeoJSON asset for this region.",
    },
  };
}

async function loadRegionCatalog(): Promise<RegionCatalogEntry[]> {
  catalogPromise ??= buildRegionCatalog();
  try {
    return await catalogPromise;
  } catch (error) {
    catalogPromise = undefined;
    throw error;
  }
}

async function buildRegionCatalog(): Promise<RegionCatalogEntry[]> {
  const [chinaEntries, eastChinaSeaEntries] = await Promise.all([
    loadChinaProvinceEntries(),
    loadEastChinaSeaEntries(),
  ]);
  return [...chinaEntries, ...eastChinaSeaEntries];
}

async function loadChinaProvinceEntries(): Promise<RegionCatalogEntry[]> {
  const collection = await readGeoJson(CHINA_GEOJSON_SOURCE);
  const entries: RegionCatalogEntry[] = [];
  for (const feature of collection.features ?? []) {
    const name = readString(feature.properties?.name);
    if (!name || !feature.geometry?.coordinates) continue;
    const bbox = bboxFromCoordinates(feature.geometry.coordinates);
    if (!bbox) continue;
    const adcode = readString(feature.properties?.adcode) ?? safeIdSegment(name);
    entries.push({
      id: `china-${adcode}`,
      name,
      aliases: buildChinaProvinceAliases(name),
      sourcePath: CHINA_GEOJSON_SOURCE,
      bbox,
    });
  }
  return entries;
}

async function loadEastChinaSeaEntries(): Promise<RegionCatalogEntry[]> {
  const collection = await readGeoJson(EAST_CHINA_SEA_SOURCE);
  const entries: RegionCatalogEntry[] = [];
  for (const feature of collection.features ?? []) {
    const bboxFromProps = bboxFromFeatureProperties(feature.properties);
    const bbox = bboxFromProps ?? (feature.geometry?.coordinates ? bboxFromCoordinates(feature.geometry.coordinates) : undefined);
    if (!bbox) continue;
    entries.push({
      id: "east-china-sea",
      name: "中国东海",
      aliases: ["东海", "中国东海", "Eastern China Sea", "East China Sea"],
      sourcePath: EAST_CHINA_SEA_SOURCE,
      bbox,
    });
  }
  return entries;
}

async function readGeoJson(sourcePath: string): Promise<GeoJsonFeatureCollection> {
  const absolutePath = path.join(getWorkspaceRoot(), sourcePath);
  const raw = await readFile(absolutePath, "utf8");
  return JSON.parse(raw) as GeoJsonFeatureCollection;
}

function scoreEntry(
  entry: RegionCatalogEntry,
  searchText: string,
  queryText: string,
  hasExplicitRegionName: boolean
): RegionCandidate | undefined {
  const normalizedName = normalizeText(entry.name);
  const normalizedAliases = entry.aliases.map(normalizeText);

  if (searchText === normalizedName) {
    return toCandidate(entry, 1, "exact_name");
  }

  if (normalizedAliases.some((alias) => searchText === alias)) {
    return toCandidate(entry, 1, "exact_alias");
  }

  if (!hasExplicitRegionName && queryText.includes(normalizedName)) {
    return toCandidate(entry, 0.92, "query_contains_name");
  }

  if (!hasExplicitRegionName) {
    const matchedAlias = normalizedAliases.find((alias) => queryText.includes(alias));
    if (matchedAlias) {
      return toCandidate(entry, 0.9, "query_contains_alias");
    }
  }

  if (searchText.length >= 2 && (normalizedName.includes(searchText) || normalizedAliases.some((alias) => alias.includes(searchText)))) {
    return toCandidate(entry, 0.6, "partial");
  }

  return undefined;
}

function toCandidate(
  entry: RegionCatalogEntry,
  confidence: number,
  matchType: RegionCandidate["matchType"]
): RegionCandidate {
  return {
    id: entry.id,
    name: entry.name,
    aliases: entry.aliases,
    source: "geojson_asset",
    sourcePath: entry.sourcePath,
    confidence,
    matchType,
    bbox: entry.bbox,
  };
}

function bboxFromFeatureProperties(properties: Record<string, unknown> | undefined): Bbox | undefined {
  const west = readNumber(properties?.min_x);
  const south = readNumber(properties?.min_y);
  const east = readNumber(properties?.max_x);
  const north = readNumber(properties?.max_y);
  if (west === undefined || south === undefined || east === undefined || north === undefined) return undefined;
  if (west >= east || south >= north) return undefined;
  return {
    west: roundCoord(west),
    east: roundCoord(east),
    south: roundCoord(south),
    north: roundCoord(north),
  };
}

function bboxFromCoordinates(coordinates: unknown): Bbox | undefined {
  const bounds = collectBounds(coordinates);
  if (!bounds) return undefined;
  return {
    west: roundCoord(bounds.west),
    east: roundCoord(bounds.east),
    south: roundCoord(bounds.south),
    north: roundCoord(bounds.north),
  };
}

function collectBounds(
  value: unknown,
  bounds: { west: number; east: number; south: number; north: number } | undefined = undefined
): { west: number; east: number; south: number; north: number } | undefined {
  if (!Array.isArray(value)) return bounds;
  if (typeof value[0] === "number" && typeof value[1] === "number") {
    const lng = value[0];
    const lat = value[1];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return bounds;
    if (!bounds) {
      return { west: lng, east: lng, south: lat, north: lat };
    }
    bounds.west = Math.min(bounds.west, lng);
    bounds.east = Math.max(bounds.east, lng);
    bounds.south = Math.min(bounds.south, lat);
    bounds.north = Math.max(bounds.north, lat);
    return bounds;
  }

  let nextBounds = bounds;
  for (const entry of value) {
    nextBounds = collectBounds(entry, nextBounds);
  }
  return nextBounds;
}

function buildChinaProvinceAliases(name: string): string[] {
  const aliases = new Set<string>([name]);
  for (const suffix of [
    "\u58ee\u65cf\u81ea\u6cbb\u533a",
    "\u56de\u65cf\u81ea\u6cbb\u533a",
    "\u7ef4\u543e\u5c14\u81ea\u6cbb\u533a",
    "\u7279\u522b\u884c\u653f\u533a",
    "\u81ea\u6cbb\u533a",
    "\u7701",
    "\u5e02",
  ]) {
    if (name.endsWith(suffix)) {
      aliases.add(name.slice(0, -suffix.length));
      break;
    }
  }
  return Array.from(aliases).filter(Boolean);
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function readString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function getWorkspaceRoot(): string {
  if (process.env.AGENT_WORKSPACE_ROOT) return path.resolve(process.env.AGENT_WORKSPACE_ROOT);
  return path.basename(process.cwd()).toLowerCase() === "api"
    ? path.resolve(process.cwd(), "..")
    : process.cwd();
}

function safeIdSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "region";
}

function roundCoord(value: number): number {
  return Number(value.toFixed(6));
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
