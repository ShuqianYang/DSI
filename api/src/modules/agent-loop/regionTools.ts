import { z } from "zod";
import type { ToolDefinition, ToolExecutionContext } from "./types.js";

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

const RegionStyleSchema = z.strictObject({
  fill: z.boolean().optional(),
  fillColor: z.string().trim().min(1).optional(),
  outlineColor: z.string().trim().min(1).optional(),
  outlineWidth: z.number().positive().max(20).optional(),
});

const RegionMarkInputSchema = z
  .strictObject({
    name: z.string().trim().min(1),
    bbox: BboxSchema.optional(),
    polygon: z.array(CoordinatePairSchema).min(3).max(MAX_POLYGON_POINTS).optional(),
    regionType: z.enum(["monitor", "control", "service"]).default("monitor"),
    label: z.string().trim().min(1).optional(),
    style: RegionStyleSchema.optional(),
  })
  .refine((input) => Boolean(input.bbox || input.polygon), "RegionMark requires either bbox or polygon.");

type RegionMarkInput = z.infer<typeof RegionMarkInputSchema>;
type CoordinatePair = [number, number];

interface Bbox {
  west: number;
  east: number;
  south: number;
  north: number;
}

interface RegionMarkOutput {
  summary: string;
  dataSource: "user_input";
  regionName: string;
  bbox: Bbox;
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

export function buildRegionMarkTool(): ToolDefinition {
  return {
    name: "RegionMark",
    aliases: ["region-mark"],
    description:
      'Create a GIS region layer from explicit user-provided WGS84 geometry. Input: {"name":"台湾海峡测试区","bbox":{"west":119.5,"east":122.5,"south":22,"north":25.5}} or {"name":"区域","polygon":[[120,22],[121,22],[120.5,23]]}. This tool does not resolve named places or guess region boundaries.',
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
      const parsed = input as RegionMarkInput;
      assertHasGeometry(parsed);
      return executeRegionMark(parsed, context);
    },
  };
}

function executeRegionMark(input: RegionMarkInput, context: ToolExecutionContext): Promise<RegionMarkOutput> {
  const coordinates = normalizePolygon(input.polygon ?? polygonFromBbox(input.bbox!));
  const bbox = input.bbox ?? bboxFromPolygon(coordinates);
  const labelText = input.label ?? input.name;
  const labelPosition = centerFromBbox(bbox);
  const regionId = `region-${safeIdSegment(input.name)}`;

  context.onProgress?.({
    stage: "complete",
    message: `Prepared GIS region ${input.name}`,
    data: {
      dataSource: "user_input",
      bbox,
      points: coordinates.length,
    },
  });

  return Promise.resolve({
    summary: `Prepared GIS region: ${input.name}.`,
    dataSource: "user_input",
    regionName: input.name,
    bbox,
    gisData: {
      type: "region",
      regions: [
        {
          id: regionId,
          name: input.name,
          type: input.regionType,
          coordinates,
          style: normalizeStyle(input.style),
          label: {
            text: labelText,
            position: labelPosition,
          },
        },
      ],
      cameraView: {
        type: "fit-bbox",
        bbox,
      },
    },
  });
}

function assertHasGeometry(input: Pick<RegionMarkInput, "bbox" | "polygon">): void {
  if (!input.bbox && !input.polygon) {
    throw new Error("RegionMark requires either bbox or polygon. It will not guess named-region geometry.");
  }
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

function normalizeStyle(style: RegionMarkInput["style"]): RegionMarkOutput["gisData"]["regions"][number]["style"] {
  return {
    fill: style?.fill ?? DEFAULT_FILL,
    ...(style?.fillColor ? { fillColor: style.fillColor } : {}),
    outlineColor: style?.outlineColor ?? DEFAULT_OUTLINE_COLOR,
    outlineWidth: style?.outlineWidth ?? DEFAULT_OUTLINE_WIDTH,
  };
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
