import type { ToolDefinition } from "../../_shared/types.js";
import { buildEarthquakeAssessmentMockTool } from "./earthquakeAssessment.js";
import { buildEarthquakePostImageMockTool } from "./earthquakePostImage.js";
import { buildEarthquakePreImageMockTool } from "./earthquakePreImage.js";
import { buildFloodAssessmentMockTool } from "./floodAssessment.js";
import { buildFloodPostImageMockTool } from "./floodPostImage.js";
import { buildFloodPreImageMockTool } from "./floodPreImage.js";

export function buildEarthquakeAssessmentMockTools(): ToolDefinition[] {
  return [
    buildEarthquakePreImageMockTool(),
    buildEarthquakePostImageMockTool(),
    buildEarthquakeAssessmentMockTool(),
  ];
}

export function buildFloodAssessmentMockTools(): ToolDefinition[] {
  return [
    buildFloodPreImageMockTool(),
    buildFloodPostImageMockTool(),
    buildFloodAssessmentMockTool(),
  ];
}
