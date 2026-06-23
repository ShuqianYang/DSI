import type { ToolDefinition } from "../../_shared/types.js";
import { buildOilSpillDetectMockTool } from "./oilSpillDetect.js";
import { buildWeatherFetchMockTool } from "./weatherFetch.js";
import { buildOilDriftTraceMockTool } from "./oilDriftTrace.js";

export function buildOilSpillMockTools(): ToolDefinition[] {
  return [
    buildOilSpillDetectMockTool(),
    buildWeatherFetchMockTool(),
    buildOilDriftTraceMockTool(),
  ];
}
