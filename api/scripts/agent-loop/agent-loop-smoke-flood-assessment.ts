import type { ModelClient } from "../../src/modules/agent-loop/modelClient.js";
import type {
  AgentLoopEvent,
  NormalizedAgentDecision,
  ToolObservation,
} from "../../src/modules/agent-loop/tools/_shared/types.js";
import type { AgentLoopTaskResult } from "../../src/modules/tasks/agentLoopResultProjection.js";

export const FLOOD_ASSESSMENT_SCENARIO = "flood-assessment";
export const FLOOD_ASSESSMENT_TOOLS = [
  "FloodPreImageMock",
  "FloodPostImageMock",
  "FloodAssessmentMock",
] as const;
export const FLOOD_ASSESSMENT_QUERY = "/演示:洪水灾后评估 湖南石门县 暴雨洪涝";

const FLOOD_REGION = "湖南石门县";
const FLOOD_REGION_BBOX = {
  west: 110.89344101467812,
  south: 29.880513149375275,
  east: 110.89603739300453,
  north: 29.88216900048024,
} as const;

const MOCK_TOOL_SEQUENCE = [
  {
    id: "flood-region-resolve-1",
    toolName: "RegionResolve",
    input: { regionName: FLOOD_REGION },
    reason: "Resolve the requested flood demo region before the deterministic replay.",
  },
  {
    id: "flood-region-mark-1",
    toolName: "RegionMark",
    input: { name: FLOOD_REGION, bbox: FLOOD_REGION_BBOX },
    reason: "Mark the resolved region before showing flood imagery overlays.",
  },
  {
    id: "flood-pre-1",
    toolName: "FloodPreImageMock",
    input: { region: FLOOD_REGION },
    reason: "Fetch deterministic pre-flood imagery via legacy queryData with local fallback.",
  },
  {
    id: "flood-post-1",
    toolName: "FloodPostImageMock",
    input: { region: FLOOD_REGION, callbackTimeoutMs: 1 },
    reason: "Submit deterministic post-flood imagery demand and fall back when disabled.",
  },
  {
    id: "flood-assessment-1",
    toolName: "FloodAssessmentMock",
    input: { region: FLOOD_REGION },
    reason: "Assess deterministic flood damage from flood.geojson and pre/post imagery.",
  },
] as const;

export interface FloodAssessmentValidationInput {
  rawEvents: AgentLoopEvent[];
  projectedResult: AgentLoopTaskResult;
}

export interface FloodAssessmentValidationReport {
  toolOrder: string[];
  gisOutputs: number;
  floodedAreaKm2: number;
  finalAnswerReceived: boolean;
}

export function createFloodAssessmentSmokeModelClient(): ModelClient {
  return {
    async decide(input): Promise<NormalizedAgentDecision> {
      const skillObservation = findObservation(input.observations, "Skill");
      if (!skillObservation) {
        return {
          type: "tool_calls",
          content: "Loading the deterministic flood assessment skill before using mock tools.",
          toolCalls: [
            {
              id: "flood-skill-1",
              toolName: "Skill",
              input: { skill: "flood-assessment", args: input.query || FLOOD_ASSESSMENT_QUERY },
              reason: "Flood assessment mock tools are hidden until the flood-assessment skill is loaded.",
            },
          ],
        };
      }

      if (!skillObservation.ok) {
        return {
          type: "final_answer",
          content: `Skill(flood-assessment) failed: ${skillObservation.error?.message ?? "unknown error"}.`,
        };
      }

      for (const toolCall of MOCK_TOOL_SEQUENCE) {
        if (!findObservation(input.observations, toolCall.toolName)) {
          const nextToolCall = toolCall.toolName === "RegionMark"
            ? { ...toolCall, input: buildRegionMarkInput(findObservation(input.observations, "RegionResolve")) }
            : toolCall;
          return {
            type: "tool_calls",
            content: `Running ${nextToolCall.toolName} for the deterministic flood assessment replay.`,
            toolCalls: [{ ...nextToolCall }],
          };
        }
      }

      return {
        type: "final_answer",
        content:
          "湖南石门县洪水灾后评估确定性回放完成。洪水前影像走 queryData 查询，洪水后需求提报失败时已使用本地回退影像；已基于 flood.geojson 输出张家渡大桥、道路中断和淹没区评估，灾后影像同范围覆盖灾前影像。",
      };
    },
  };
}

export function installMockFloodAssessmentFetch(): () => void {
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
    throw new Error(`Unexpected fetch in flood assessment smoke: ${url}`);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

export function validateFloodAssessmentSmoke(
  input: FloodAssessmentValidationInput,
): FloodAssessmentValidationReport {
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

  const preImage = requireObservation(observations, "FloodPreImageMock");
  assertCondition(readString(objectRecord(preImage.observation.output).imageUrl), "FloodPreImageMock returned no imageUrl.");

  const postImage = requireObservation(observations, "FloodPostImageMock");
  assertCondition(readString(objectRecord(postImage.observation.output).imageUrl), "FloodPostImageMock returned no imageUrl.");

  const assessment = requireObservation(observations, "FloodAssessmentMock");
  const assessmentOutput = objectRecord(assessment.observation.output);
  const summary = objectRecord(assessmentOutput.summary);
  const floodedAreaKm2 = Number(summary.floodedAreaKm2);
  assertCondition(Number.isFinite(floodedAreaKm2) && floodedAreaKm2 >= 0, "Unexpected flooded area.");
  assertImageOverlaysCoverInPlace(objectRecord(assessmentOutput.gisData), "pre-flood-imagery", "post-flood-imagery");

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
    floodedAreaKm2,
    finalAnswerReceived,
  };
}

function assertImageOverlaysCoverInPlace(gisData: Record<string, unknown>, preId: string, postId: string): void {
  assertCondition(gisData.compareMode === undefined, "Flood assessment should not request side-by-side compare mode.");
  assertCondition(gisData.compareConfig === undefined, "Flood assessment should not return compareConfig.");
  const overlays = Array.isArray(gisData.imageOverlays) ? gisData.imageOverlays.map(objectRecord) : [];
  const pre = overlays.find((overlay) => overlay.id === preId);
  const post = overlays.find((overlay) => overlay.id === postId);
  assertCondition(Boolean(pre), `Missing ${preId} overlay.`);
  assertCondition(Boolean(post), `Missing ${postId} overlay.`);
  assertCondition(pre?.alpha === 1 && post?.alpha === 1, "Flood pre/post overlays should be fully opaque.");
  assertCondition(
    JSON.stringify(pre?.rectangle) === JSON.stringify(post?.rectangle),
    "Flood post overlay should cover the pre overlay on the same bounds.",
  );
}

function assertToolOrder(toolOrder: string[]): void {
  let previousIndex = toolOrder.indexOf("Skill");
  assertCondition(previousIndex >= 0, `Missing Skill in tool observation order: ${toolOrder.join(" -> ")}`);

  for (const tool of MOCK_TOOL_SEQUENCE) {
    const index = toolOrder.indexOf(tool.toolName);
    assertCondition(index >= 0, `Missing ${tool.toolName} in tool observation order: ${toolOrder.join(" -> ")}`);
    assertCondition(index > previousIndex, `Unexpected flood assessment tool order: ${toolOrder.join(" -> ")}`);
    previousIndex = index;
  }
}

function buildRegionMarkInput(regionResolve: ToolObservation | undefined): Record<string, unknown> {
  if (regionResolve?.ok) {
    const selected = objectRecord(objectRecord(regionResolve.output).selected);
    const name = readString(selected.name) ?? FLOOD_REGION;
    const bbox = objectRecord(selected.bbox);
    const geometryRef = objectRecord(selected.geometryRef);
    const hasGeometryRef = Object.keys(geometryRef).length > 0;
    const hasBbox = Object.keys(bbox).length > 0;

    if (hasGeometryRef) return { name, geometryRef };
    if (hasBbox) return { name, bbox };
  }

  return { name: FLOOD_REGION, bbox: FLOOD_REGION_BBOX };
}

function findObservation(observations: ToolObservation[], toolName: string): ToolObservation | undefined {
  return observations.find((observation) => observation.toolName === toolName);
}

function requireObservation(
  observations: Array<Extract<AgentLoopEvent, { type: "tool_observation" }>>,
  toolName: string,
): Extract<AgentLoopEvent, { type: "tool_observation" }> {
  const observation = observations.find((event) => event.toolName === toolName);
  if (!observation) throw new Error(`Missing ${toolName} tool_observation.`);
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
  if (!condition) throw new Error(message);
}
