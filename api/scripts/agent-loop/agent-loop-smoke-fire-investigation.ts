import type { ModelClient } from "../../src/modules/agent-loop/modelClient.js";
import type {
  AgentLoopEvent,
  NormalizedAgentDecision,
  ToolObservation,
} from "../../src/modules/agent-loop/tools/_shared/types.js";
import type { AgentLoopTaskResult } from "../../src/modules/tasks/agentLoopResultProjection.js";

export const FIRE_INVESTIGATION_SCENARIO = "fire-investigation";
export const FIRE_INVESTIGATION_TOOLS = [
  "FireDetectMock",
  "FireSatelliteMock",
  "FireAssessmentMock",
  "FireReportMock",
] as const;
export const FIRE_INVESTIGATION_QUERY = "/演示:火情研判";

const FIRE_REGION_BBOX = {
  west: 76.967,
  south: 43.241,
  east: 77.029,
  north: 43.286,
} as const;

const MOCK_TOOL_SEQUENCE = [
  {
    id: "fire-region-resolve-1",
    toolName: "RegionResolve",
    input: { regionName: "Kensai" },
    reason: "Resolve the requested fire demo region before the deterministic replay.",
  },
  {
    id: "fire-region-mark-1",
    toolName: "RegionMark",
    input: { name: "Kensai", bbox: FIRE_REGION_BBOX },
    reason: "Mark the resolved region before showing fire overlays.",
  },
  {
    id: "fire-detect-1",
    toolName: "FireDetectMock",
    input: { region: "Kensai" },
    reason: "Detect the deterministic Kensai fire center and burned area.",
  },
  {
    id: "fire-satellite-1",
    toolName: "FireSatelliteMock",
    input: { region: "Kensai" },
    reason: "Overlay deterministic post-fire imagery.",
  },
  {
    id: "fire-assessment-1",
    toolName: "FireAssessmentMock",
    input: { region: "Kensai" },
    reason: "Assess deterministic fire intensity, spread, and wind field.",
  },
  {
    id: "fire-report-1",
    toolName: "FireReportMock",
    input: { region: "Kensai" },
    reason: "Produce the final structured fire investigation report.",
  },
] as const;

export interface FireInvestigationValidationInput {
  rawEvents: AgentLoopEvent[];
  projectedResult: AgentLoopTaskResult;
}

export interface FireInvestigationValidationReport {
  toolOrder: string[];
  gisOutputs: number;
  burnedAreaHectares: number;
  finalAnswerReceived: boolean;
}

export function createFireInvestigationSmokeModelClient(): ModelClient {
  return {
    async decide(input): Promise<NormalizedAgentDecision> {
      const skillObservation = findObservation(input.observations, "Skill");
      if (!skillObservation) {
        return {
          type: "tool_calls",
          content: "Loading the deterministic fire investigation skill before using mock tools.",
          toolCalls: [
            {
              id: "fire-skill-1",
              toolName: "Skill",
              input: { skill: "fire-investigation", args: input.query || FIRE_INVESTIGATION_QUERY },
              reason: "Fire investigation mock tools are hidden until the fire-investigation skill is loaded.",
            },
          ],
        };
      }

      if (!skillObservation.ok) {
        return {
          type: "final_answer",
          content: `Skill(fire-investigation) failed: ${skillObservation.error?.message ?? "unknown error"}.`,
        };
      }

      for (const toolCall of MOCK_TOOL_SEQUENCE) {
        if (!findObservation(input.observations, toolCall.toolName)) {
          const nextToolCall = toolCall.toolName === "RegionMark"
            ? { ...toolCall, input: buildRegionMarkInput(findObservation(input.observations, "RegionResolve")) }
            : toolCall;
          return {
            type: "tool_calls",
            content: `Running ${nextToolCall.toolName} for the deterministic fire investigation replay.`,
            toolCalls: [{ ...nextToolCall }],
          };
        }
      }

      return {
        type: "final_answer",
        content: "Kensai 火情研判确定性回放完成。烧毁面积约 1200 公顷，风险等级高，建议持续监测并部署边境巡查。",
      };
    },
  };
}

export function installMockFireInvestigationFetch(_options: {
  httpStatus?: number;
  networkError?: boolean;
} = {}): () => void {
  // Fire investigation mock tools do not perform external HTTP calls.
  return () => {};
}

export function validateFireInvestigationSmoke(
  input: FireInvestigationValidationInput,
): FireInvestigationValidationReport {
  const observations = input.rawEvents.filter(
    (event): event is Extract<AgentLoopEvent, { type: "tool_observation" }> =>
      event.type === "tool_observation",
  );
  const toolOrder = observations.map((event) => event.toolName);
  assertToolOrder(toolOrder);

  let gisOutputs = 0;
  for (const toolName of MOCK_TOOL_SEQUENCE.map((tool) => tool.toolName)) {
    const event = requireObservation(observations, toolName);
    assertCondition(event.ok, `${toolName} observation failed.`);
    if (toolName !== "RegionResolve") {
      assertCondition(objectRecord(event.observation.output).gisData, `${toolName} did not return top-level gisData.`);
      gisOutputs += 1;
    }
  }

  const detect = requireObservation(observations, "FireDetectMock");
  const detectOutput = objectRecord(detect.observation.output);
  assertCondition(detectOutput.fireDetected === true, "FireDetectMock did not detect fire.");
  const burnedAreaHectares = Number(detectOutput.burnedAreaHectares);
  assertCondition(Number.isFinite(burnedAreaHectares) && burnedAreaHectares > 0, "Unexpected burned area.");

  const satellite = requireObservation(observations, "FireSatelliteMock");
  const satelliteGisData = objectRecord(objectRecord(satellite.observation.output).gisData);
  const overlays = Array.isArray(satelliteGisData.imageOverlays)
    ? satelliteGisData.imageOverlays.map(objectRecord)
    : [];
  assertCondition(overlays.length === 1, "FireSatelliteMock should only return the post-fire image overlay.");
  assertCondition(overlays[0]?.id === "fire-post-image", "FireSatelliteMock should not return a burn-mask overlay.");
  assertCondition(overlays[0]?.alpha === 1, "Fire post image overlay should be fully opaque.");

  const finalAnswer = input.rawEvents.find((event) => event.type === "loop_stop");
  const finalAnswerReceived =
    finalAnswer?.type === "loop_stop" &&
    (finalAnswer.result.stoppedBy === "final_answer" || finalAnswer.result.stoppedBy === "max_turns");
  assertCondition(finalAnswerReceived, "Agent did not produce a final answer.");

  assertCondition(
    input.projectedResult.stoppedBy === "final_answer" || input.projectedResult.stoppedBy === "max_turns",
    `Agent loop did not stop with final_answer/max_turns: ${input.projectedResult.stoppedBy}`,
  );

  return {
    toolOrder,
    gisOutputs,
    burnedAreaHectares,
    finalAnswerReceived,
  };
}

function assertToolOrder(toolOrder: string[]): void {
  let previousIndex = toolOrder.indexOf("Skill");
  assertCondition(previousIndex >= 0, `Missing Skill in tool observation order: ${toolOrder.join(" -> ")}`);

  for (const tool of MOCK_TOOL_SEQUENCE) {
    const index = toolOrder.indexOf(tool.toolName);
    assertCondition(index >= 0, `Missing ${tool.toolName} in tool observation order: ${toolOrder.join(" -> ")}`);
    assertCondition(index > previousIndex, `Unexpected fire investigation tool order: ${toolOrder.join(" -> ")}`);
    previousIndex = index;
  }
}

function buildRegionMarkInput(regionResolve: ToolObservation | undefined): Record<string, unknown> {
  if (regionResolve?.ok) {
    const selected = objectRecord(objectRecord(regionResolve.output).selected);
    const name = readString(selected.name) ?? "Kensai";
    const bbox = objectRecord(selected.bbox);
    const geometryRef = objectRecord(selected.geometryRef);
    const hasGeometryRef = Object.keys(geometryRef).length > 0;
    const hasBbox = Object.keys(bbox).length > 0;

    if (hasGeometryRef) {
      return { name, geometryRef };
    }
    if (hasBbox) {
      return { name, bbox };
    }
  }

  return { name: "Kensai", bbox: FIRE_REGION_BBOX };
}

function findObservation(observations: ToolObservation[], toolName: string): ToolObservation | undefined {
  return observations.find((observation) => observation.toolName === toolName);
}

function requireObservation(
  observations: Array<Extract<AgentLoopEvent, { type: "tool_observation" }>>,
  toolName: string,
): Extract<AgentLoopEvent, { type: "tool_observation" }> {
  const observation = observations.find((event) => event.toolName === toolName);
  if (!observation) {
    throw new Error(`Missing ${toolName} tool_observation.`);
  }
  return observation;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
