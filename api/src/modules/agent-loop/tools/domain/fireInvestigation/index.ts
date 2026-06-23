import type { ToolDefinition } from "../../_shared/types.js";
import { buildFireAssessmentMockTool } from "./fireAssessment.js";
import { buildFireDetectMockTool } from "./fireDetect.js";
import { buildFireReportMockTool } from "./fireReport.js";
import { buildFireSatelliteMockTool } from "./fireSatellite.js";

export function buildFireInvestigationMockTools(): ToolDefinition[] {
  return [
    buildFireDetectMockTool(),
    buildFireSatelliteMockTool(),
    buildFireAssessmentMockTool(),
    buildFireReportMockTool(),
  ];
}
