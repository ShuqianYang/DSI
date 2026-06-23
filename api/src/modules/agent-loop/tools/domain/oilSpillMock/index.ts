import type { ToolDefinition } from "../../_shared/types.js";
import { buildOilSpillDetectMockTool } from "./oilSpillDetect.js";
import { buildWeatherFetchMockTool } from "./weatherFetch.js";
import { buildOilDriftTraceMockTool } from "./oilDriftTrace.js";
import { buildAisFetchMockTool } from "./aisFetch.js";
import { buildAisMatchSuspectsMockTool } from "./aisMatchSuspects.js";
import { buildAisSuspectRankingMockTool } from "./aisSuspectRanking.js";

export function buildOilSpillMockTools(): ToolDefinition[] {
  return [
    buildOilSpillDetectMockTool(),
    buildWeatherFetchMockTool(),
    buildOilDriftTraceMockTool(),
    buildAisFetchMockTool(),
    buildAisMatchSuspectsMockTool(),
    buildAisSuspectRankingMockTool(),
  ];
}
