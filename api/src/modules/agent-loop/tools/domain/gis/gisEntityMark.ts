import { z } from "zod";
import type { ToolDefinition, ToolExecutionContext } from "../../_shared/types.js";

const MAX_ENTITIES = 100;
const MAX_RESULT_SIZE_CHARS = 60_000;

const EntityStatusSchema = z.enum(["normal", "warning", "danger"]).default("normal");
const EntityImportanceSchema = z.enum(["high", "medium", "low"]).default("medium");
const BusinessEntityTypeSchema = z.enum([
  "alarm_event",
  "device",
  "checkpoint",
  "department",
  "vehicle",
  "person",
  "other",
]).default("other");

const GisEntityInputSchema = z.strictObject({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  businessType: BusinessEntityTypeSchema,
  status: EntityStatusSchema,
  importance: EntityImportanceSchema,
  description: z.string().trim().min(1).optional(),
  sourceTable: z.string().trim().min(1).optional(),
  sourceId: z.string().trim().min(1).optional(),
});

const GisEntityMarkInputSchema = z.strictObject({
  name: z.string().trim().min(1),
  entities: z.array(GisEntityInputSchema).min(1).max(MAX_ENTITIES),
  cameraMode: z.enum(["fit-entities", "none"]).default("fit-entities"),
});

type GisEntityMarkInput = z.infer<typeof GisEntityMarkInputSchema>;
export function buildGisEntityMarkTool(): ToolDefinition {
  return {
    name: "GisEntityMark",
    displayName: "GIS 点位标注",
    aliases: ["gis-entity-mark", "entity-mark"],
    description:
      'Create visible GIS point entities from query rows that contain WGS84 longitude/latitude. Use after MysqlQuery returns border-defense detail rows with coordinates. Input: {"name":"设备位置","entities":[{"id":"dev-1","name":"一号摄像头","businessType":"device","longitude":87.62,"latitude":43.82,"status":"normal"}]}.',
    kind: "domain",
    inputSchema: GisEntityMarkInputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    maxResultSizeChars: MAX_RESULT_SIZE_CHARS,
    async execute(input, context) {
      const parsed = GisEntityMarkInputSchema.parse(input);
      return executeGisEntityMark(parsed, context);
    },
  };
}

async function executeGisEntityMark(input: GisEntityMarkInput, context: ToolExecutionContext) {
  const entities = input.entities.map((entity) => ({
    id: entity.id,
    name: entity.name,
    type: "base" as const,
    coordinates: [roundCoord(entity.longitude), roundCoord(entity.latitude)] as [number, number],
    importance: entity.importance,
    status: entity.status,
    description: buildDescription(entity),
    dataSource: entity.sourceTable ?? entity.businessType,
  }));

  const bbox = bboxFromEntities(entities);
  const gisData = {
    type: "entity" as const,
    entities,
    eventName: input.name,
    ...(input.cameraMode === "fit-entities" && bbox
      ? {
          cameraView: {
            type: "fit-bbox" as const,
            bbox,
          },
        }
      : {}),
  };

  context.onProgress?.({
    stage: "complete",
    message: `Prepared ${entities.length} GIS entities for ${input.name}`,
    data: {
      entityCount: entities.length,
      bbox,
    },
  });

  return {
    summary: `Prepared ${entities.length} GIS point entities for ${input.name}.`,
    entityCount: entities.length,
    gisData,
  };
}

function buildDescription(entity: z.infer<typeof GisEntityInputSchema>): string {
  const parts = [
    entity.description,
    `业务类型: ${entity.businessType}`,
    entity.sourceTable ? `来源表: ${entity.sourceTable}` : undefined,
    entity.sourceId ? `来源ID: ${entity.sourceId}` : undefined,
  ].filter(Boolean);
  return parts.join(" | ");
}

function bboxFromEntities(
  entities: Array<{ coordinates: [number, number] }>,
): { west: number; east: number; south: number; north: number } | undefined {
  if (entities.length === 0) return undefined;
  const lngs = entities.map((entity) => entity.coordinates[0]);
  const lats = entities.map((entity) => entity.coordinates[1]);
  const west = Math.min(...lngs);
  const east = Math.max(...lngs);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const padding = 0.02;
  return {
    west: roundCoord(west === east ? west - padding : west),
    east: roundCoord(west === east ? east + padding : east),
    south: roundCoord(south === north ? south - padding : south),
    north: roundCoord(south === north ? north + padding : north),
  };
}

function roundCoord(value: number): number {
  return Number(value.toFixed(6));
}
