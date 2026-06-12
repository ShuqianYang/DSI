import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getGeoDatabasePool } from "../../../../../config/geoDatabase.js";
import type { ToolDefinition, ToolExecutionContext } from "../../_shared/types.js";

const CHINA_GEOJSON_SOURCE = "public/geo/china.geojson";
const EAST_CHINA_SEA_SOURCE = "public/geo/eastern_china_sea.geojson";
const REGION_RESOLVE_SCHEMA = process.env.REGION_RESOLVE_SCHEMA ?? "region_geom";
const REGION_RESOLVE_CATALOG = process.env.REGION_RESOLVE_CATALOG ?? "region_resolve_catalog";
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

type RegionMatchType = "exact_name" | "exact_alias" | "query_contains_name" | "query_contains_alias" | "partial";
type RegionSource = "postgis" | "geojson_asset";

interface GeometryRef {
  schema: "region_geom";
  catalog: "region_resolve_catalog";
  sourceTable: string;
  sourceId: string;
  stableId: string;
}

interface RegionCandidate {
  id: string;
  name: string;
  aliases: string[];
  source: RegionSource;
  sourcePath?: string;
  sourceTable?: string;
  sourceId?: string;
  stableId?: string;
  level?: string;
  parentId?: string;
  nameEn?: string;
  geometryRef?: GeometryRef;
  geometryType?: string;
  confidence: number;
  matchType: RegionMatchType;
  bbox: Bbox;
  center?: [number, number];
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
  source: RegionSource;
  sourcePath?: string;
  sourceTable?: string;
  sourceId?: string;
  stableId?: string;
  level?: string;
  parentId?: string;
  nameEn?: string;
  geometryRef?: GeometryRef;
  geometryType?: string;
  bbox: Bbox;
  center?: [number, number];
}

interface PostgisCatalogRow {
  source_table: string;
  source_id: string;
  stable_id: string;
  name: string;
  name_en: string | null;
  level: string;
  parent_id: string | null;
  aliases: string[] | null;
  geometry_type: string;
  bbox_west: number;
  bbox_east: number;
  bbox_south: number;
  bbox_north: number;
  center_lon: number;
  center_lat: number;
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

let geojsonCatalogPromise: Promise<RegionCatalogEntry[]> | undefined;
let postgisCatalogPromise: Promise<RegionCatalogEntry[]> | undefined;

export function buildRegionResolveTool(): ToolDefinition {
  return {
    name: "RegionResolve",
    aliases: ["region-resolve"],
    description:
      'Resolve a named region from PostGIS region_geom.region_resolve_catalog into bbox + geometryRef. Input: {"regionName":"台湾海峡"} or {"query":"请圈选福建省"}. This tool only resolves geometry references; it does not create a visible map layer. When the user asks to 圈选/标出/高亮 a named region, call RegionResolve first, then call RegionMark with selected.geometryRef and reuse selected.bbox for downstream data tools. If resolved=false, do not guess a bbox.',
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
  const searchText = normalizeText(input.regionName ?? input.query ?? context.query);
  const queryText = normalizeText(input.query ?? context.query);
  const maxCandidates = input.maxCandidates;
  const minConfidence = input.minConfidence;
  const hasExplicitRegionName = Boolean(input.regionName);

  let catalog: RegionCatalogEntry[];
  try {
    catalog = await loadCatalogForResolve(context);
  } catch (error) {
    return {
      resolved: false,
      candidates: [],
      requirement: {
        type: "region_geometry_missing",
        message: `Region catalog is unavailable: ${formatErrorMessage(error)}. Ask the user to provide bbox/polygon or add the region to the PostGIS region catalog.`,
      },
    };
  }

  context.onProgress?.({
    stage: "start",
    message: `Resolving region from ${catalog.length} region catalog row(s)`,
  });

  const candidates = catalog
    .map((entry) => scoreEntry(entry, searchText, queryText, hasExplicitRegionName))
    .filter((candidate): candidate is RegionCandidate => Boolean(candidate))
    .sort(compareCandidates)
    .slice(0, maxCandidates);

  const selected = candidates[0];
  if (selected && selected.confidence >= minConfidence) {
    context.onProgress?.({
      stage: "complete",
      message: `Resolved ${selected.name} from ${describeCandidateSource(selected)}`,
      data: {
        selected,
      },
    });
    return {
      resolved: true,
      selected: cloneCandidate(selected),
      candidates: candidates.map(cloneCandidate),
    };
  }

  const requirementType = candidates.length > 0 ? "region_match_ambiguous" : "region_geometry_missing";
  return {
    resolved: false,
    candidates: candidates.map(cloneCandidate),
    requirement: {
      type: requirementType,
      message:
        requirementType === "region_match_ambiguous"
          ? "RegionResolve found candidates but none met the confidence threshold. Ask the user to choose a candidate or provide bbox/polygon."
          : "Missing region geometry. Ask the user to provide bbox/polygon or add the region to the PostGIS region catalog.",
    },
  };
}

async function loadCatalogForResolve(context: ToolExecutionContext): Promise<RegionCatalogEntry[]> {
  const sourceMode = process.env.REGION_RESOLVE_SOURCE ?? "postgis";
  if (sourceMode === "geojson") {
    return loadGeojsonCatalog();
  }

  try {
    const postgisCatalog = await loadPostgisCatalog();
    const geojsonFallback = await tryLoadGeojsonCatalog();
    return mergeCatalogs(postgisCatalog, geojsonFallback);
  } catch (error) {
    if (sourceMode === "postgis") {
      context.onProgress?.({
        stage: "warning",
        message: `PostGIS region catalog unavailable, falling back to local GeoJSON: ${formatErrorMessage(error)}`,
      });
      const fallback = await tryLoadGeojsonCatalog();
      if (fallback.length > 0) return fallback;
    }
    return [];
  }
}

async function loadPostgisCatalog(): Promise<RegionCatalogEntry[]> {
  postgisCatalogPromise ??= queryPostgisCatalog();
  try {
    return await postgisCatalogPromise;
  } catch (error) {
    postgisCatalogPromise = undefined;
    throw error;
  }
}

async function queryPostgisCatalog(): Promise<RegionCatalogEntry[]> {
  const pool = getGeoDatabasePool();
  const result = await pool.query<PostgisCatalogRow>(`
    SELECT
      source_table,
      source_id,
      stable_id,
      name,
      name_en,
      level,
      parent_id,
      aliases,
      GeometryType(geom) AS geometry_type,
      ST_XMin(ST_Envelope(geom)) AS bbox_west,
      ST_XMax(ST_Envelope(geom)) AS bbox_east,
      ST_YMin(ST_Envelope(geom)) AS bbox_south,
      ST_YMax(ST_Envelope(geom)) AS bbox_north,
      ST_X(ST_PointOnSurface(geom)) AS center_lon,
      ST_Y(ST_PointOnSurface(geom)) AS center_lat
    FROM ${REGION_RESOLVE_SCHEMA}.${REGION_RESOLVE_CATALOG}
    WHERE geom IS NOT NULL
      AND name IS NOT NULL
      AND source_table IS NOT NULL
      AND source_id IS NOT NULL
      AND stable_id IS NOT NULL;
  `);

  return result.rows.map(toPostgisEntry);
}

function toPostgisEntry(row: PostgisCatalogRow): RegionCatalogEntry {
  return {
    id: `${row.source_table}:${row.stable_id}`,
    name: row.name,
    aliases: normalizeAliases(row.aliases ?? [row.name, row.name_en].filter((value): value is string => Boolean(value))),
    source: "postgis",
    sourceTable: row.source_table,
    sourceId: row.source_id,
    stableId: row.stable_id,
    level: row.level,
    parentId: row.parent_id ?? undefined,
    nameEn: row.name_en ?? undefined,
    geometryType: row.geometry_type,
    geometryRef: {
      schema: "region_geom",
      catalog: "region_resolve_catalog",
      sourceTable: row.source_table,
      sourceId: row.source_id,
      stableId: row.stable_id,
    },
    bbox: {
      west: roundCoord(row.bbox_west),
      east: roundCoord(row.bbox_east),
      south: roundCoord(row.bbox_south),
      north: roundCoord(row.bbox_north),
    },
    center: [roundCoord(row.center_lon), roundCoord(row.center_lat)],
  };
}

async function tryLoadGeojsonCatalog(): Promise<RegionCatalogEntry[]> {
  try {
    return await loadGeojsonCatalog();
  } catch {
    return [];
  }
}

async function loadGeojsonCatalog(): Promise<RegionCatalogEntry[]> {
  geojsonCatalogPromise ??= buildGeojsonCatalog();
  try {
    return await geojsonCatalogPromise;
  } catch (error) {
    geojsonCatalogPromise = undefined;
    throw error;
  }
}

async function buildGeojsonCatalog(): Promise<RegionCatalogEntry[]> {
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
      source: "geojson_asset",
      sourcePath: CHINA_GEOJSON_SOURCE,
      level: "province",
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
      source: "geojson_asset",
      sourcePath: EAST_CHINA_SEA_SOURCE,
      level: "sea",
      bbox,
    });
  }
  return entries;
}

function mergeCatalogs(primary: RegionCatalogEntry[], fallback: RegionCatalogEntry[]): RegionCatalogEntry[] {
  const seen = new Set(primary.map((entry) => normalizeText(entry.name)));
  const merged = [...primary];
  for (const entry of fallback) {
    if (!seen.has(normalizeText(entry.name))) {
      merged.push(entry);
    }
  }
  return merged;
}

function scoreEntry(
  entry: RegionCatalogEntry,
  searchText: string,
  queryText: string,
  hasExplicitRegionName: boolean
): RegionCandidate | undefined {
  const normalizedName = normalizeText(entry.name);
  const normalizedAliases = entry.aliases.map(normalizeText).filter((alias) => alias.length >= 2);

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
  matchType: RegionMatchType
): RegionCandidate {
  return {
    ...entry,
    aliases: [...entry.aliases],
    confidence,
    matchType,
    bbox: { ...entry.bbox },
    ...(entry.center ? { center: [...entry.center] as [number, number] } : {}),
    ...(entry.geometryRef ? { geometryRef: { ...entry.geometryRef } } : {}),
  };
}

function compareCandidates(a: RegionCandidate, b: RegionCandidate): number {
  return (
    b.confidence - a.confidence ||
    getMatchTypePriority(b.matchType) - getMatchTypePriority(a.matchType) ||
    getSourcePriority(b) - getSourcePriority(a) ||
    getLevelPriority(b.level) - getLevelPriority(a.level) ||
    a.name.length - b.name.length ||
    a.name.localeCompare(b.name, "zh-Hans-CN")
  );
}

function getMatchTypePriority(matchType: RegionMatchType): number {
  switch (matchType) {
    case "exact_name":
      return 100;
    case "exact_alias":
      return 90;
    case "query_contains_name":
      return 80;
    case "query_contains_alias":
      return 70;
    case "partial":
      return 60;
  }
}

function getLevelPriority(level: string | undefined): number {
  switch (level) {
    case "strait":
    case "sea":
    case "custom":
    case "strategy":
    case "ocean":
      return 95;
    case "country":
      return 90;
    case "province":
      return 80;
    case "city":
      return 70;
    case "taiwan_admin":
      return 65;
    case "district":
    case "town":
      return 60;
    default:
      return 50;
  }
}

function getSourcePriority(candidate: RegionCandidate): number {
  if (candidate.source === "geojson_asset") {
    return candidate.sourcePath === EAST_CHINA_SEA_SOURCE ? 98 : 10;
  }
  switch (candidate.sourceTable) {
    case "custom_region":
      return 100;
    case "sea_geom":
      return 90;
    case "china_province":
      return 80;
    case "china_city":
      return 70;
    case "taiwan":
      return 65;
    case "china_town":
      return 60;
    case "international":
      return 50;
    default:
      return 40;
  }
}

function cloneCandidate(candidate: RegionCandidate): RegionCandidate {
  return {
    ...candidate,
    aliases: [...candidate.aliases],
    bbox: { ...candidate.bbox },
    ...(candidate.center ? { center: [...candidate.center] as [number, number] } : {}),
    ...(candidate.geometryRef ? { geometryRef: { ...candidate.geometryRef } } : {}),
  };
}

function describeCandidateSource(candidate: RegionCandidate): string {
  if (candidate.source === "postgis") {
    return `${candidate.geometryRef?.schema}.${candidate.geometryRef?.catalog}/${candidate.sourceTable}:${candidate.sourceId}`;
  }
  return candidate.sourcePath ?? candidate.source;
}

async function readGeoJson(sourcePath: string): Promise<GeoJsonFeatureCollection> {
  const absolutePath = path.join(getWorkspaceRoot(), sourcePath);
  const raw = await readFile(absolutePath, "utf8");
  return JSON.parse(raw) as GeoJsonFeatureCollection;
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
    "壮族自治区",
    "回族自治区",
    "维吾尔自治区",
    "特别行政区",
    "自治区",
    "省",
    "市",
  ]) {
    if (name.endsWith(suffix)) {
      aliases.add(name.slice(0, -suffix.length));
      break;
    }
  }
  return Array.from(aliases).filter(Boolean);
}

function normalizeAliases(values: string[]): string[] {
  const aliases = new Set<string>();
  for (const value of values) {
    const alias = value.trim();
    if (alias) aliases.add(alias);
  }
  return Array.from(aliases);
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
