import type { ModelClient } from "../../src/modules/agent-loop/modelClient.js";
import type {
  AgentLoopEvent,
  NormalizedAgentDecision,
  ToolObservation,
} from "../../src/modules/agent-loop/tools/_shared/types.js";
import type { AgentLoopTaskResult } from "../../src/modules/tasks/agentLoopResultProjection.js";

export const OIL_SPILL_MOCK_SCENARIO = "oil-spill-mock";
export const OIL_SPILL_MOCK_TOOLS = [
  "OilSpillDetectMock",
  "WeatherFetchMock",
  "OilDriftTraceMock",
  "AisFetchMock",
  "AisMatchSuspectsMock",
  "AisSuspectRankingMock",
] as const;
export const OIL_SPILL_MOCK_QUERY = "/演示:油污溯源";

const MOCK_TOOL_SEQUENCE = [
  {
    id: "oil-spill-region-resolve-1",
    toolName: "RegionResolve",
    input: { regionName: "中国东海" },
    reason: "Resolve the requested oil-spill demo region before the deterministic replay.",
  },
  {
    id: "oil-spill-region-mark-1",
    toolName: "RegionMark",
    input: { name: "中国东海", bbox: { west: 122.5, east: 123.5, south: 29.5, north: 30.8 } },
    reason: "Mark the resolved region before showing oil-spill overlays.",
  },
  {
    id: "oil-spill-detect-1",
    toolName: "OilSpillDetectMock",
    input: { region: "中国东海" },
    reason: "Detect the deterministic East China Sea oil-spill SAR overlay.",
  },
  {
    id: "oil-spill-weather-1",
    toolName: "WeatherFetchMock",
    input: { region: "东海油膜片区" },
    reason: "Fetch deterministic wind and current inputs for the replay.",
  },
  {
    id: "oil-spill-drift-1",
    toolName: "OilDriftTraceMock",
    input: {},
    reason: "Trace the deterministic drift path back to the pollution origin.",
  },
  {
    id: "oil-spill-ais-1",
    toolName: "AisFetchMock",
    input: { region: "中国东海" },
    reason: "Fetch deterministic AIS candidate vessels.",
  },
  {
    id: "oil-spill-match-1",
    toolName: "AisMatchSuspectsMock",
    input: {},
    reason: "Match deterministic AIS vessels against the pollution origin.",
  },
  {
    id: "oil-spill-ranking-1",
    toolName: "AisSuspectRankingMock",
    input: {},
    reason: "Rank deterministic suspect vessels.",
  },
] as const;

export interface OilSpillMockValidationInput {
  rawEvents: AgentLoopEvent[];
  projectedResult: AgentLoopTaskResult;
}

export interface OilSpillMockValidationReport {
  toolOrder: string[];
  queryDataCalled: boolean;
  gisOutputs: number;
  primarySuspectMmsi: string;
  finalAnswerReceived: boolean;
}

export function createOilSpillMockSmokeModelClient(): ModelClient {
  return {
    async decide(input): Promise<NormalizedAgentDecision> {
      const skillObservation = findObservation(input.observations, "Skill");
      if (!skillObservation) {
        return {
          type: "tool_calls",
          content: "Loading the deterministic oil-spill tracing skill before using mock tools.",
          toolCalls: [
            {
              id: "oil-spill-skill-1",
              toolName: "Skill",
              input: { skill: "oil-spill-tracing", args: input.query || OIL_SPILL_MOCK_QUERY },
              reason: "Oil-spill mock tools are hidden until the oil-spill tracing skill is loaded.",
            },
          ],
        };
      }

      if (!skillObservation.ok) {
        return {
          type: "final_answer",
          content: `Skill(oil-spill-tracing) failed: ${skillObservation.error?.message ?? "unknown error"}.`,
        };
      }

      for (const toolCall of MOCK_TOOL_SEQUENCE) {
        if (!findObservation(input.observations, toolCall.toolName)) {
          const nextToolCall = toolCall.toolName === "RegionMark"
            ? { ...toolCall, input: buildRegionMarkInput(findObservation(input.observations, "RegionResolve")) }
            : toolCall;
          return {
            type: "tool_calls",
            content: `Running ${nextToolCall.toolName} for the deterministic oil-spill replay.`,
            toolCalls: [{ ...nextToolCall }],
          };
        }
      }

      const ranking = findObservation(input.observations, "AisSuspectRankingMock");
      const primary = objectRecord(arrayValue(objectRecord(ranking?.output).primary)?.[0]);
      const name = readString(primary.name) ?? "unknown vessel";
      const mmsi = readString(primary.mmsi) ?? "unknown MMSI";
      return {
        type: "final_answer",
        content: `东海漏油确定性回放完成。首要疑似肇事船为 ${name}，MMSI ${mmsi}。`,
      };
    },
  };
}

export function installMockOilSpillMockFetch(options: {
  httpStatus?: number;
  networkError?: boolean;
} = {}): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/agent/queryData")) {
      if (!originalFetch) {
        throw new Error(`Unexpected fetch in oil-spill mock smoke: ${url}`);
      }
      return originalFetch(input, init);
    }

    if (options.networkError) {
      throw new Error("ECONNREFUSED");
    }
    if (options.httpStatus && options.httpStatus >= 400) {
      return new Response(null, { status: options.httpStatus, statusText: "Internal Server Error" });
    }
    return new Response(JSON.stringify({ state: true, value: { records: [] } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}

export function validateOilSpillMockSmoke(
  input: OilSpillMockValidationInput
): OilSpillMockValidationReport {
  const observations = input.rawEvents.filter(
    (event): event is Extract<AgentLoopEvent, { type: "tool_observation" }> =>
      event.type === "tool_observation"
  );
  const toolOrder = observations.map((event) => event.toolName);
  assertToolOrder(toolOrder);

  const detect = requireObservation(observations, "OilSpillDetectMock");
  assertCondition(detect.ok, "OilSpillDetectMock observation failed.");
  const detectOutput = objectRecord(detect.observation.output);
  assertCondition(detectOutput.shouldContinue === true, "OilSpillDetectMock did not continue the replay.");
  assertCondition(readString(detectOutput.imageSource) === "local-fallback", "Expected local SAR fallback.");

  let gisOutputs = 0;
  for (const toolName of MOCK_TOOL_SEQUENCE.map((tool) => tool.toolName)) {
    const event = requireObservation(observations, toolName);
    assertCondition(event.ok, `${toolName} observation failed.`);
    if (toolName !== "RegionResolve") {
      assertCondition(objectRecord(event.observation.output).gisData, `${toolName} did not return top-level gisData.`);
      gisOutputs += 1;
    }
  }

  const ranking = requireObservation(observations, "AisSuspectRankingMock");
  const rankingOutput = objectRecord(ranking.observation.output);
  const primary = objectRecord(arrayValue(rankingOutput.primary)?.[0]);
  const primarySuspectMmsi = readString(primary.mmsi) ?? "";
  assertCondition(primarySuspectMmsi === "413567890", "Unexpected primary suspect MMSI.");
  assertCondition(primary.score === 86, "Unexpected primary suspect score.");

  const finalAnswer = input.rawEvents.find((event) => event.type === "loop_stop");
  const finalAnswerReceived =
    finalAnswer?.type === "loop_stop" &&
    (finalAnswer.result.stoppedBy === "final_answer" || finalAnswer.result.stoppedBy === "max_turns");
  assertCondition(finalAnswerReceived, "Agent did not produce a final answer.");

  assertCondition(
    input.projectedResult.stoppedBy === "final_answer" || input.projectedResult.stoppedBy === "max_turns",
    `Agent loop did not stop with final_answer/max_turns: ${input.projectedResult.stoppedBy}`
  );

  return {
    toolOrder,
    queryDataCalled: true,
    gisOutputs,
    primarySuspectMmsi,
    finalAnswerReceived,
  };
}

function assertToolOrder(toolOrder: string[]): void {
  let previousIndex = toolOrder.indexOf("Skill");
  assertCondition(previousIndex >= 0, `Missing Skill in tool observation order: ${toolOrder.join(" -> ")}`);

  for (const tool of MOCK_TOOL_SEQUENCE) {
    const index = toolOrder.indexOf(tool.toolName);
    assertCondition(index >= 0, `Missing ${tool.toolName} in tool observation order: ${toolOrder.join(" -> ")}`);
    assertCondition(index > previousIndex, `Unexpected oil-spill mock tool order: ${toolOrder.join(" -> ")}`);
    previousIndex = index;
  }
}

function buildRegionMarkInput(regionResolve: ToolObservation | undefined): Record<string, unknown> {
  const selected = objectRecord(objectRecord(regionResolve?.output).selected);
  const name = readString(selected.name) ?? "中国东海";
  const bbox = objectRecord(selected.bbox);
  const geometryRef = objectRecord(selected.geometryRef);

  return {
    name,
    ...(Object.keys(geometryRef).length > 0 ? { geometryRef } : {}),
    ...(Object.keys(bbox).length > 0
      ? { bbox }
      : { bbox: { west: 122.5, east: 123.5, south: 29.5, north: 30.8 } }),
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

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
