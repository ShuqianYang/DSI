import type { ModelClient } from "../../src/modules/agent-loop/modelClient.js";
import type {
  AgentLoopEvent,
  NormalizedAgentDecision,
  ToolObservation,
} from "../../src/modules/agent-loop/tools/_shared/types.js";
import type { AgentLoopTaskResult } from "../../src/modules/tasks/agentLoopResultProjection.js";

export const EARTHQUAKE_ASSESSMENT_SCENARIO = "earthquake-assessment";
export const EARTHQUAKE_ASSESSMENT_TOOLS = [
  "EarthquakePreImageMock",
  "EarthquakePostImageMock",
  "EarthquakeAssessmentMock",
] as const;
export const EARTHQUAKE_ASSESSMENT_QUERY = "/演示:地震灾后评估 广西柳州市柳南区 6.2级地震";

const EARTHQUAKE_REGION = "广西柳州市柳南区";
const EARTHQUAKE_REGION_BBOX = {
  west: 109.25894741025947,
  south: 24.36555725731195,
  east: 109.26069621053718,
  north: 24.366585886456956,
} as const;

const MOCK_TOOL_SEQUENCE = [
  {
    id: "earthquake-region-resolve-1",
    toolName: "RegionResolve",
    input: { regionName: EARTHQUAKE_REGION },
    reason: "Resolve the requested earthquake demo region before the deterministic replay.",
  },
  {
    id: "earthquake-region-mark-1",
    toolName: "RegionMark",
    input: { name: EARTHQUAKE_REGION, bbox: EARTHQUAKE_REGION_BBOX },
    reason: "Mark the resolved region before showing earthquake imagery overlays.",
  },
  {
    id: "earthquake-pre-1",
    toolName: "EarthquakePreImageMock",
    input: { region: EARTHQUAKE_REGION },
    reason: "Fetch deterministic pre-earthquake imagery via legacy queryData with local fallback.",
  },
  {
    id: "earthquake-post-1",
    toolName: "EarthquakePostImageMock",
    input: { region: EARTHQUAKE_REGION, callbackTimeoutMs: 1 },
    reason: "Submit deterministic post-earthquake imagery demand and fall back when disabled.",
  },
  {
    id: "earthquake-assessment-1",
    toolName: "EarthquakeAssessmentMock",
    input: { region: EARTHQUAKE_REGION },
    reason: "Assess deterministic earthquake damage from the pre/post image replay.",
  },
] as const;

export interface EarthquakeAssessmentValidationInput {
  rawEvents: AgentLoopEvent[];
  projectedResult: AgentLoopTaskResult;
}

export interface EarthquakeAssessmentValidationReport {
  toolOrder: string[];
  gisOutputs: number;
  earthquakeMagnitude: number;
  finalAnswerReceived: boolean;
}

export function createEarthquakeAssessmentSmokeModelClient(): ModelClient {
  return {
    async decide(input): Promise<NormalizedAgentDecision> {
      const skillObservation = findObservation(input.observations, "Skill");
      if (!skillObservation) {
        return {
          type: "tool_calls",
          content: "Loading the deterministic earthquake assessment skill before using mock tools.",
          toolCalls: [
            {
              id: "earthquake-skill-1",
              toolName: "Skill",
              input: { skill: "earthquake-assessment", args: input.query || EARTHQUAKE_ASSESSMENT_QUERY },
              reason: "Earthquake assessment mock tools are hidden until the earthquake-assessment skill is loaded.",
            },
          ],
        };
      }

      if (!skillObservation.ok) {
        return {
          type: "final_answer",
          content: `Skill(earthquake-assessment) failed: ${skillObservation.error?.message ?? "unknown error"}.`,
        };
      }

      for (const toolCall of MOCK_TOOL_SEQUENCE) {
        if (!findObservation(input.observations, toolCall.toolName)) {
          const nextToolCall = toolCall.toolName === "RegionMark"
            ? { ...toolCall, input: buildRegionMarkInput(findObservation(input.observations, "RegionResolve")) }
            : toolCall;
          return {
            type: "tool_calls",
            content: `Running ${nextToolCall.toolName} for the deterministic earthquake assessment replay.`,
            toolCalls: [{ ...nextToolCall }],
          };
        }
      }

      return {
        type: "final_answer",
        content:
          "广西柳州市柳南区地震灾后评估确定性回放完成。震前影像走 queryData 查询，震后需求提报失败时已使用本地回退影像；5.2级地震综合风险等级中等，建议核查建筑受损、道路阻断和供电线路。",
      };
    },
  };
}

export function installMockEarthquakeAssessmentFetch(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/agent/queryData")) {
      return jsonResponse({
        state: true,
        value: { records: [] },
      });
    }
    if (url.endsWith("/agent/zh/demand")) {
      return jsonResponse({ state: false, message: "daily demand disabled for smoke" }, 503);
    }
    if (originalFetch) return originalFetch(input, init);
    throw new Error(`Unexpected fetch in earthquake assessment smoke: ${url}`);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

export function validateEarthquakeAssessmentSmoke(
  input: EarthquakeAssessmentValidationInput,
): EarthquakeAssessmentValidationReport {
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

  const preImage = requireObservation(observations, "EarthquakePreImageMock");
  const preOutput = objectRecord(preImage.observation.output);
  assertCondition(readString(preOutput.imageUrl), "EarthquakePreImageMock returned no imageUrl.");

  const postImage = requireObservation(observations, "EarthquakePostImageMock");
  const postOutput = objectRecord(postImage.observation.output);
  assertCondition(readString(postOutput.imageUrl), "EarthquakePostImageMock returned no imageUrl.");

  const assessment = requireObservation(observations, "EarthquakeAssessmentMock");
  const assessmentOutput = objectRecord(assessment.observation.output);
  const earthquakeMagnitude = Number(assessmentOutput.earthquakeMagnitude);
  assertCondition(Number.isFinite(earthquakeMagnitude) && earthquakeMagnitude > 0, "Unexpected earthquake magnitude.");
  assertImageOverlaysCoverInPlace(objectRecord(assessmentOutput.gisData), "earthquake-pre-image", "earthquake-post-image");

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
    earthquakeMagnitude,
    finalAnswerReceived,
  };
}

function assertImageOverlaysCoverInPlace(gisData: Record<string, unknown>, preId: string, postId: string): void {
  assertCondition(gisData.compareMode === undefined, "Earthquake assessment should not request side-by-side compare mode.");
  assertCondition(gisData.compareConfig === undefined, "Earthquake assessment should not return compareConfig.");
  const overlays = Array.isArray(gisData.imageOverlays) ? gisData.imageOverlays.map(objectRecord) : [];
  const pre = overlays.find((overlay) => overlay.id === preId);
  const post = overlays.find((overlay) => overlay.id === postId);
  assertCondition(Boolean(pre), `Missing ${preId} overlay.`);
  assertCondition(Boolean(post), `Missing ${postId} overlay.`);
  assertCondition(pre?.alpha === 1 && post?.alpha === 1, "Earthquake pre/post overlays should be fully opaque.");
  assertCondition(
    JSON.stringify(pre?.rectangle) === JSON.stringify(post?.rectangle),
    "Earthquake post overlay should cover the pre overlay on the same bounds.",
  );
}

function assertToolOrder(toolOrder: string[]): void {
  let previousIndex = toolOrder.indexOf("Skill");
  assertCondition(previousIndex >= 0, `Missing Skill in tool observation order: ${toolOrder.join(" -> ")}`);

  for (const tool of MOCK_TOOL_SEQUENCE) {
    const index = toolOrder.indexOf(tool.toolName);
    assertCondition(index >= 0, `Missing ${tool.toolName} in tool observation order: ${toolOrder.join(" -> ")}`);
    assertCondition(index > previousIndex, `Unexpected earthquake assessment tool order: ${toolOrder.join(" -> ")}`);
    previousIndex = index;
  }
}

function buildRegionMarkInput(regionResolve: ToolObservation | undefined): Record<string, unknown> {
  if (regionResolve?.ok) {
    const selected = objectRecord(objectRecord(regionResolve.output).selected);
    const name = readString(selected.name) ?? EARTHQUAKE_REGION;
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

  return { name: EARTHQUAKE_REGION, bbox: EARTHQUAKE_REGION_BBOX };
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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
