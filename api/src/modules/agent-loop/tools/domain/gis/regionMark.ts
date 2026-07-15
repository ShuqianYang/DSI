import { z } from "zod";
import { getGeoDatabasePool } from "../../../../../config/geoDatabase.js";
import type { ToolDefinition, ToolExecutionContext } from "../../_shared/types.js";

const DEFAULT_OUTLINE_COLOR = "#0064FF";
const DEFAULT_OUTLINE_WIDTH = 3;
const DEFAULT_FILL = false;
const MAX_POLYGON_POINTS = 500;
const MAX_RESULT_SIZE_CHARS = 40_000;

const CoordinatePairSchema = z
  .tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ])
  .describe("[lng, lat] in WGS84.");

const BboxSchema = z
  .strictObject({
    west: z.number().min(-180).max(180),
    east: z.number().min(-180).max(180),
    south: z.number().min(-90).max(90),
    north: z.number().min(-90).max(90),
  })
  .refine((bbox) => bbox.west < bbox.east, "bbox.west must be less than bbox.east")
  .refine((bbox) => bbox.south < bbox.north, "bbox.south must be less than bbox.north");

const GeometryRefSchema = z.strictObject({
  schema: z.literal("region_geom"),
  catalog: z.literal("region_resolve_catalog"),
  sourceTable: z.string().trim().min(1),
  sourceId: z.string().trim().min(1),
  stableId: z.string().trim().min(1),
});

const RegionStyleSchema = z.strictObject({
  fill: z.boolean().optional(),
  fillColor: z.string().trim().min(1).optional(),
  outlineColor: z.string().trim().min(1).optional(),
  outlineWidth: z.number().positive().max(20).optional(),
});

const RegionMarkInputSchema = z
  .strictObject({
    name: z.string().trim().min(1),
    geometryRef: GeometryRefSchema.optional(),
    bbox: BboxSchema.optional(),
    polygon: z.array(CoordinatePairSchema).min(3).max(MAX_POLYGON_POINTS).optional(),
    regionType: z.enum(["monitor", "control", "service"]).default("monitor"),
    label: z.string().trim().min(1).optional(),
    style: RegionStyleSchema.optional(),
  })
  .refine((input) => Boolean(input.geometryRef || input.bbox || input.polygon), "RegionMark requires geometryRef, bbox, or polygon.");

type RegionMarkInput = z.infer<typeof RegionMarkInputSchema>;
type CoordinatePair = [number, number];

interface Bbox {
  west: number;
  east: number;
  south: number;
  north: number;
}

interface GeometryRef {
  schema: "region_geom";
  catalog: "region_resolve_catalog";
  sourceTable: string;
  sourceId: string;
  stableId: string;
}

type RegionMarkDataSource = "user_input" | "postgis";

interface RegionMarkOutput {
  summary: string;
  dataSource: RegionMarkDataSource;
  regionName: string;
  bbox: Bbox;
  geometryRef?: GeometryRef;
  gisData: {
    type: "region";
    regions: Array<{
      id: string;
      name: string;
      type: "monitor" | "control" | "service";
      coordinates: CoordinatePair[];
      style: {
        fill: boolean;
        fillColor?: string;
        outlineColor: string;
        outlineWidth: number;
      };
      label: {
        text: string;
        position: CoordinatePair;
      };
    }>;
    cameraView: {
      type: "fit-bbox";
      bbox: Bbox;
    };
  };
}

interface RegionGeometryRow {
  geojson: string;
  geometry_type: string;
  bbox_west: number;
  bbox_east: number;
  bbox_south: number;
  bbox_north: number;
  center_lon: number;
  center_lat: number;
}

interface GeoJsonGeometry {
  type?: string;
  coordinates?: unknown;
}

interface PreparedRegionGeometry {
  dataSource: RegionMarkDataSource;
  coordinates: CoordinatePair[];
  bbox: Bbox;
  labelPosition: CoordinatePair;
  geometryRef?: GeometryRef;
}

export function buildRegionMarkTool(): ToolDefinition {
  return {
    name: "RegionMark",
    displayName: "区域标注",
    aliases: ["region-mark"],
    description:
      'Create a visible GIS region layer from RegionResolve selected.geometryRef or explicit WGS84 geometry. Input: {"name":"台湾海峡","geometryRef":{"schema":"region_geom","catalog":"region_resolve_catalog","sourceTable":"custom_region","sourceId":"92","stableId":"92"},"bbox":{"west":117,"east":122.5,"south":22,"north":26.5}} or {"name":"区域","polygon":[[120,22],[121,22],[120.5,23]]}. Use RegionResolve first for named places. This tool does not resolve named places or guess region boundaries.',
    kind: "domain",
    inputSchema: RegionMarkInputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    maxResultSizeChars: MAX_RESULT_SIZE_CHARS,
    validateInput(input) {
      assertHasGeometry(input as RegionMarkInput);
    },
    async execute(input, context) {
      const parsed = RegionMarkInputSchema.parse(input);
      assertHasGeometry(parsed);
      return executeRegionMark(parsed, context);
    },
  };
}

async function executeRegionMark(input: RegionMarkInput, context: ToolExecutionContext): Promise<RegionMarkOutput> {
  const prepared = input.geometryRef
    ? await preparePostgisGeometry(input.geometryRef)
    : prepareUserGeometry(input);

  const labelText = input.label ?? input.name;
  const regionId = `region-${safeIdSegment(input.name)}`;

  context.onProgress?.({
    stage: "complete",
    message: `Prepared GIS region ${input.name}`,
    data: {
      dataSource: prepared.dataSource,
      bbox: prepared.bbox,
      points: prepared.coordinates.length,
      geometryRef: prepared.geometryRef,
    },
  });

  // Simplify coordinates for large polygons to avoid output truncation
  const simplifiedCoordinates = simplifyCoordinates(prepared.coordinates, MAX_POLYGON_POINTS);

  return {
    summary: `Prepared GIS region: ${input.name}.`,
    dataSource: prepared.dataSource,
    regionName: input.name,
    bbox: prepared.bbox,
    ...(prepared.geometryRef ? { geometryRef: prepared.geometryRef } : {}),
    gisData: {
      type: "region",
      regions: [
        {
          id: regionId,
          name: input.name,
          type: input.regionType,
          coordinates: simplifiedCoordinates,
          style: normalizeStyle(input.style),
          label: {
            text: labelText,
            position: prepared.labelPosition,
          },
        },
      ],
      cameraView: {
        type: "fit-bbox",
        bbox: cloneBbox(prepared.bbox),
      },
    },
  };
}

async function preparePostgisGeometry(geometryRef: GeometryRef): Promise<PreparedRegionGeometry> {
  const row = await queryRegionGeometry(geometryRef);
  const geometry = JSON.parse(row.geojson) as GeoJsonGeometry;
  const coordinates = normalizePolygon(extractPrimaryRing(geometry));
  return {
    dataSource: "postgis",
    coordinates,
    bbox: {
      west: roundCoord(row.bbox_west),
      east: roundCoord(row.bbox_east),
      south: roundCoord(row.bbox_south),
      north: roundCoord(row.bbox_north),
    },
    labelPosition: [roundCoord(row.center_lon), roundCoord(row.center_lat)],
    geometryRef: { ...geometryRef },
  };
}

async function queryRegionGeometry(geometryRef: GeometryRef): Promise<RegionGeometryRow> {
  const pool = getGeoDatabasePool();
  const result = await pool.query<RegionGeometryRow>(
    `
    SELECT
      ST_AsGeoJSON(geom)::text AS geojson,
      GeometryType(geom) AS geometry_type,
      ST_XMin(ST_Envelope(geom)) AS bbox_west,
      ST_XMax(ST_Envelope(geom)) AS bbox_east,
      ST_YMin(ST_Envelope(geom)) AS bbox_south,
      ST_YMax(ST_Envelope(geom)) AS bbox_north,
      ST_X(ST_PointOnSurface(geom)) AS center_lon,
      ST_Y(ST_PointOnSurface(geom)) AS center_lat
    FROM region_geom.region_resolve_catalog
    WHERE source_table = $1
      AND source_id = $2
      AND stable_id = $3
    LIMIT 1;
    `,
    [geometryRef.sourceTable, geometryRef.sourceId, geometryRef.stableId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`RegionMark could not find geometryRef ${geometryRef.sourceTable}:${geometryRef.sourceId}:${geometryRef.stableId}.`);
  }

  if (!["POLYGON", "MULTIPOLYGON", "ST_POLYGON", "ST_MULTIPOLYGON"].includes(row.geometry_type.toUpperCase())) {
    throw new Error(`RegionMark geometryRef must resolve to Polygon or MultiPolygon, got ${row.geometry_type}.`);
  }

  return row;
}

function prepareUserGeometry(input: RegionMarkInput): PreparedRegionGeometry {
  const coordinates = normalizePolygon(input.polygon ?? polygonFromBbox(input.bbox!));
  const bbox = input.bbox ?? bboxFromPolygon(coordinates);
  return {
    dataSource: "user_input",
    coordinates,
    bbox,
    labelPosition: centerFromBbox(bbox),
  };
}

function assertHasGeometry(input: Pick<RegionMarkInput, "geometryRef" | "bbox" | "polygon">): void {
  if (!input.geometryRef && !input.bbox && !input.polygon) {
    throw new Error("RegionMark requires geometryRef, bbox, or polygon. It will not guess named-region geometry.");
  }
}

function extractPrimaryRing(geometry: GeoJsonGeometry): CoordinatePair[] {
  if (geometry.type === "Polygon") {
    const polygon = geometry.coordinates;
    if (!Array.isArray(polygon)) throw new Error("RegionMark received invalid Polygon geometry.");
    return parseRing(polygon[0]);
  }

  if (geometry.type === "MultiPolygon") {
    const multiPolygon = geometry.coordinates;
    if (!Array.isArray(multiPolygon)) throw new Error("RegionMark received invalid MultiPolygon geometry.");
    const rings = multiPolygon
      .map((polygon) => (Array.isArray(polygon) ? parseRingOrUndefined(polygon[0]) : undefined))
      .filter((ring): ring is CoordinatePair[] => Boolean(ring));
    const largest = rings.sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)))[0];
    if (!largest) throw new Error("RegionMark received MultiPolygon geometry without polygon rings.");
    return largest;
  }

  throw new Error(`RegionMark only supports Polygon or MultiPolygon geometryRef output, got ${geometry.type ?? "unknown"}.`);
}

function parseRingOrUndefined(value: unknown): CoordinatePair[] | undefined {
  try {
    return parseRing(value);
  } catch {
    return undefined;
  }
}

function parseRing(value: unknown): CoordinatePair[] {
  if (!Array.isArray(value)) throw new Error("RegionMark received invalid polygon ring.");
  const ring = value.map((point) => {
    if (!Array.isArray(point) || typeof point[0] !== "number" || typeof point[1] !== "number") {
      throw new Error("RegionMark received invalid polygon coordinate.");
    }
    return [point[0], point[1]] as CoordinatePair;
  });
  if (ring.length < 3) throw new Error("RegionMark polygon ring must have at least 3 points.");
  return ring;
}

function polygonArea(ring: CoordinatePair[]): number {
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function polygonFromBbox(bbox: Bbox): CoordinatePair[] {
  return [
    [bbox.west, bbox.south],
    [bbox.east, bbox.south],
    [bbox.east, bbox.north],
    [bbox.west, bbox.north],
    [bbox.west, bbox.south],
  ];
}

function normalizePolygon(polygon: CoordinatePair[]): CoordinatePair[] {
  const normalized = polygon.map(([lng, lat]) => [roundCoord(lng), roundCoord(lat)] as CoordinatePair);
  const first = normalized[0]!;
  const last = normalized[normalized.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) {
    return normalized;
  }
  return [...normalized, first];
}

function bboxFromPolygon(polygon: CoordinatePair[]): Bbox {
  const lngs = polygon.map(([lng]) => lng);
  const lats = polygon.map(([, lat]) => lat);
  return {
    west: roundCoord(Math.min(...lngs)),
    east: roundCoord(Math.max(...lngs)),
    south: roundCoord(Math.min(...lats)),
    north: roundCoord(Math.max(...lats)),
  };
}

function centerFromBbox(bbox: Bbox): CoordinatePair {
  return [
    roundCoord((bbox.west + bbox.east) / 2),
    roundCoord((bbox.south + bbox.north) / 2),
  ];
}

function cloneBbox(bbox: Bbox): Bbox {
  return {
    west: bbox.west,
    east: bbox.east,
    south: bbox.south,
    north: bbox.north,
  };
}

function normalizeStyle(style: RegionMarkInput["style"]): RegionMarkOutput["gisData"]["regions"][number]["style"] {
  return {
    fill: style?.fill ?? DEFAULT_FILL,
    ...(style?.fillColor ? { fillColor: style.fillColor } : {}),
    outlineColor: style?.outlineColor ?? DEFAULT_OUTLINE_COLOR,
    outlineWidth: style?.outlineWidth ?? DEFAULT_OUTLINE_WIDTH,
  };
}

function simplifyCoordinates(coordinates: CoordinatePair[], maxPoints: number): CoordinatePair[] {
  if (coordinates.length <= maxPoints) return coordinates;

  // Always keep first and last points (they should be the same for a closed ring)
  if (coordinates.length < 3) return coordinates;

  const first = coordinates[0]!;
  const last = coordinates[coordinates.length - 1]!;
  const isClosed = first[0] === last[0] && first[1] === last[1];

  // Keep first point, sample middle, keep last point
  const innerCount = isClosed ? coordinates.length - 2 : coordinates.length - 2;
  const innerToKeep = maxPoints - 2;
  const step = innerCount / innerToKeep;

  const result: CoordinatePair[] = [first];
  for (let i = 0; i < innerToKeep; i++) {
    const idx = 1 + Math.floor(i * step);
    result.push(coordinates[idx]!);
  }
  result.push(last);

  return result;
}

function safeIdSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "user-input";
}

function roundCoord(value: number): number {
  return Number(value.toFixed(6));
}
