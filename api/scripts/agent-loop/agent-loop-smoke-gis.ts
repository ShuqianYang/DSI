import type { ModelClient } from "../../src/modules/agent-loop/modelClient.js";
import type {
  AgentLoopEvent,
  NormalizedAgentDecision,
  ToolObservation,
} from "../../src/modules/agent-loop/tools/_shared/types.js";
import type { LegacySseEvent } from "../../src/modules/tasks/agentLoopEventAdapter.js";
import type { AgentLoopTaskResult } from "../../src/modules/tasks/agentLoopResultProjection.js";

export const GIS_TOOLCHAIN_SCENARIO = "gis-toolchain";
export const GIS_TOOLCHAIN_TOOLS = ["RegionResolve", "RegionMark", "WeatherFetch"] as const;
export const GIS_TOOLCHAIN_QUERY = "\u5708\u9009\u53f0\u6e7e\u6d77\u5ce1\u5e76\u67e5\u8be2\u8fd9\u4e2a\u533a\u57df\u7684\u98ce\u573a\u3002";

interface Bbox {
  west: number;
  east: number;
  south: number;
  north: number;
}

export interface GisToolchainValidationInput {
  rawEvents: AgentLoopEvent[];
  legacyEvents: LegacySseEvent[];
  projectedResult: AgentLoopTaskResult;
}

export interface GisToolchainValidationReport {
  toolOrder: string[];
  legacyRegionGisData: boolean;
  legacyWindFieldGisData: boolean;
  projectedRegionGisData: boolean;
  projectedWindFieldGisData: boolean;
}

export function createGisToolchainSmokeModelClient(): ModelClient {
  return {
    async decide(input): Promise<NormalizedAgentDecision> {
      const resolveObservation = findObservation(input.observations, "RegionResolve");
      if (!resolveObservation) {
        return {
          type: "tool_calls",
          content: "Resolving the named GIS region before marking it.",
          toolCalls: [
            {
              id: "gis-resolve-1",
              toolName: "RegionResolve",
              input: { regionName: "\u53f0\u6e7e\u6d77\u5ce1" },
              reason: "Resolve the user's named region into local geometry.",
            },
          ],
        };
      }

      if (!isResolvedRegionObservation(resolveObservation)) {
        return {
          type: "final_answer",
          content:
            "RegionResolve could not resolve the requested named region from local GeoJSON assets.",
        };
      }

      const bbox = resolveObservation.output.selected.bbox;
      const geometryRef = objectRecord(resolveObservation.output.selected.geometryRef);
      const name = readString(resolveObservation.output.selected.name) ?? "\u53f0\u6e7e\u6d77\u5ce1";
      const markObservation = findObservation(input.observations, "RegionMark");
      if (!markObservation) {
        return {
          type: "tool_calls",
          content: "Marking the resolved GIS region on the map.",
          toolCalls: [
            {
              id: "gis-mark-1",
              toolName: "RegionMark",
              input: {
                name,
                ...(Object.keys(geometryRef).length > 0 ? { geometryRef } : {}),
                bbox,
                regionType: "monitor",
                label: name,
              },
              reason: "Create a map region layer from the resolved geometry reference.",
            },
          ],
        };
      }

      const weatherObservation = findObservation(input.observations, "WeatherFetch");
      if (!weatherObservation) {
        return {
          type: "tool_calls",
          content: "Fetching weather over the marked GIS region.",
          toolCalls: [
            {
              id: "gis-weather-1",
              toolName: "WeatherFetch",
              input: {
                bbox,
                grid: { rows: 2, cols: 2 },
                lookbackDays: 1,
                timezone: "Asia/Shanghai",
                requestTimeoutMs: 5_000,
              },
              reason: "Fetch a wind-field layer for the marked bbox.",
            },
          ],
        };
      }

      return {
        type: "final_answer",
        content: "GIS toolchain smoke completed: region resolved, map region marked, and wind field fetched.",
      };
    },
  };
}

export function installMockOpenMeteoFetch(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "api.open-meteo.com" && url.pathname === "/v1/forecast") {
      const count = countCommaSeparatedParam(url, "latitude");
      const payload = Array.from({ length: count }, (_, index) => ({
        hourly: {
          wind_speed_10m: [null, roundMetric(6 + index * 0.5)],
          wind_direction_10m: [null, 90 + index * 15],
        },
      }));
      return jsonResponse(payload);
    }

    if (url.hostname === "marine-api.open-meteo.com" && url.pathname === "/v1/marine") {
      return jsonResponse({
        hourly: {
          ocean_current_velocity: [null, 0.4],
          ocean_current_direction: [null, 135],
        },
      });
    }

    if (!originalFetch) {
      throw new Error(`Unexpected fetch in GIS smoke mock: ${url.href}`);
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}

export function validateGisToolchainSmoke(
  input: GisToolchainValidationInput
): GisToolchainValidationReport {
  const observations = input.rawEvents.filter(
    (event): event is Extract<AgentLoopEvent, { type: "tool_observation" }> =>
      event.type === "tool_observation"
  );
  const toolOrder = observations.map((event) => event.toolName);
  assertToolOrder(toolOrder);

  const resolve = requireObservation(observations, "RegionResolve");
  assertCondition(resolve.ok, "RegionResolve observation failed.");
  assertCondition(isResolvedRegionObservation(resolve.observation), "RegionResolve did not return resolved=true with selected.bbox.");
  const resolvedBbox = resolve.observation.output.selected.bbox;
  const resolvedGeometryRef = objectRecord(resolve.observation.output.selected.geometryRef);

  const mark = requireObservation(observations, "RegionMark");
  assertCondition(mark.ok, "RegionMark observation failed.");
  const markOutput = objectRecord(mark.observation.output);
  const markGisData = objectRecord(markOutput.gisData);
  const markCameraView = objectRecord(markOutput.cameraView ?? objectRecord(markGisData.cameraView));
  assertCondition(markGisData.type === "region", "RegionMark did not return gisData.type=region.");
  assertCondition(markCameraView.type === "fit-bbox", "RegionMark did not return cameraView.type=fit-bbox.");
  assertCondition(isBbox(objectRecord(markCameraView.bbox)), "RegionMark cameraView.bbox is missing or invalid.");
  assertCondition(
    sameBbox(objectRecord(markOutput.bbox), resolvedBbox),
    "RegionMark bbox drifted from RegionResolve.selected.bbox."
  );
  assertCondition(
    sameBbox(objectRecord(markCameraView.bbox), resolvedBbox),
    "RegionMark cameraView.bbox drifted from RegionResolve.selected.bbox."
  );
  if (Object.keys(resolvedGeometryRef).length > 0) {
    assertCondition(
      sameJson(objectRecord(markOutput.geometryRef), resolvedGeometryRef),
      "RegionMark did not reuse RegionResolve.selected.geometryRef."
    );
  }

  const weather = requireObservation(observations, "WeatherFetch");
  assertCondition(weather.ok, "WeatherFetch observation failed.");
  const weatherOutput = objectRecord(weather.observation.output);
  const weatherGisData = objectRecord(weatherOutput.gisData);
  const windField = objectRecord(weatherGisData.windField);
  assertCondition(weatherGisData.type === "wind-field", "WeatherFetch did not return gisData.type=wind-field.");
  assertCondition(arrayValue(windField.speed)?.length > 0, "WeatherFetch windField.speed is empty.");
  assertCondition(
    sameBbox(objectRecord(weatherOutput.bbox), resolvedBbox) || sameBbox(objectRecord(windField.bbox), resolvedBbox),
    "WeatherFetch bbox drifted from RegionResolve.selected.bbox."
  );

  const legacyRegionGisData = hasLegacyGisData(input.legacyEvents, "region");
  const legacyWindFieldGisData = hasLegacyGisData(input.legacyEvents, "wind-field");
  assertCondition(legacyRegionGisData, "Legacy SSE events did not expose region gisData.");
  assertCondition(legacyWindFieldGisData, "Legacy SSE events did not expose wind-field gisData.");

  const projectedRegionGisData = hasProjectedGisData(input.projectedResult, "region");
  const projectedWindFieldGisData = hasProjectedGisData(input.projectedResult, "wind-field");
  assertCondition(projectedRegionGisData, "Projected task.result did not expose region gisData.");
  assertCondition(projectedWindFieldGisData, "Projected task.result did not expose wind-field gisData.");

  return {
    toolOrder,
    legacyRegionGisData,
    legacyWindFieldGisData,
    projectedRegionGisData,
    projectedWindFieldGisData,
  };
}

function findObservation(observations: ToolObservation[], toolName: string): ToolObservation | undefined {
  return observations.find((observation) => observation.toolName === toolName);
}

function requireObservation(
  observations: Array<Extract<AgentLoopEvent, { type: "tool_observation" }>>,
  toolName: string
): Extract<AgentLoopEvent, { type: "tool_observation" }> {
  const observation = observations.find((event) => event.toolName === toolName);
  if (!observation) {
    throw new Error(`Missing ${toolName} tool_observation.`);
  }
  return observation;
}

function assertToolOrder(toolOrder: string[]): void {
  let previousIndex = -1;
  for (const toolName of GIS_TOOLCHAIN_TOOLS) {
    const index = toolOrder.indexOf(toolName);
    assertCondition(index >= 0, `Missing ${toolName} in tool observation order: ${toolOrder.join(" -> ")}`);
    assertCondition(index > previousIndex, `Unexpected GIS tool order: ${toolOrder.join(" -> ")}`);
    previousIndex = index;
  }
}

function isResolvedRegionObservation(
  observation: ToolObservation
): observation is ToolObservation & {
  output: { resolved: true; selected: { name?: unknown; bbox: Bbox } };
} {
  const output = objectRecord(observation.output);
  const selected = objectRecord(output.selected);
  return output.resolved === true && isBbox(objectRecord(selected.bbox));
}

function isBbox(value: Record<string, unknown>): value is Bbox {
  return ["west", "east", "south", "north"].every((key) => typeof value[key] === "number");
}

function sameBbox(value: Record<string, unknown>, expected: Bbox): boolean {
  return isBbox(value) && ["west", "east", "south", "north"].every((key) => value[key] === expected[key as keyof Bbox]);
}

function sameJson(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(left, Object.keys(left).sort()) === JSON.stringify(right, Object.keys(right).sort());
}

function hasLegacyGisData(events: LegacySseEvent[], type: string): boolean {
  return events.some((event) => {
    if (event.type !== "step_update" || event.status !== "completed") return false;
    return objectRecord(event.gisData).type === type;
  });
}

function hasProjectedGisData(result: AgentLoopTaskResult, type: string): boolean {
  return Object.entries(result).some(([key, value]) => {
    if (["message", "mode", "turns", "stoppedBy", "observations"].includes(key)) return false;
    return objectRecord(objectRecord(value).gisData).type === type;
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function countCommaSeparatedParam(url: URL, name: string): number {
  const value = url.searchParams.get(name);
  if (!value) return 1;
  return value.split(",").filter(Boolean).length || 1;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(2));
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
