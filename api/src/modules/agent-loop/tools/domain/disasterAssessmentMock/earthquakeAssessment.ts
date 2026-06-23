import { z } from "zod";
import type { ToolDefinition } from "../../_shared/types.js";
import {
  EARTHQUAKE_ASSESSMENT,
  EARTHQUAKE_DEFAULT_REGION,
  EARTHQUAKE_MAGNITUDE,
} from "./earthquakeMockData.js";
import { buildEarthquakeAssessmentGisData } from "./earthquakeShared.js";

const InputSchema = z.strictObject({
  region: z.string().trim().min(1).default(EARTHQUAKE_DEFAULT_REGION),
});

type EarthquakeAssessmentInput = z.infer<typeof InputSchema>;

export function buildEarthquakeAssessmentMockTool(): ToolDefinition {
  return {
    name: "EarthquakeAssessmentMock",
    aliases: ["earthquake-assessment"],
    description:
      "Deterministic mock earthquake damage assessment for the Guangxi Liuzhou Liunan demo. Returns affected objects, road/building impact, and GIS focus metadata.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute(input) {
      const parsed = InputSchema.parse(input) as EarthquakeAssessmentInput;

      return {
        summary:
          `${parsed.region} ${EARTHQUAKE_MAGNITUDE}级地震震后评估：` +
          `疑似倒塌建筑 ${EARTHQUAKE_ASSESSMENT.collapsedBuildings} 处，` +
          `受损建筑 ${EARTHQUAKE_ASSESSMENT.damagedBuildings} 处，` +
          `道路阻断 ${EARTHQUAKE_ASSESSMENT.blockedRoadSegments} 段，` +
          `综合风险等级为中等。`,
        region: parsed.region,
        earthquakeMagnitude: EARTHQUAKE_MAGNITUDE,
        riskLevel: EARTHQUAKE_ASSESSMENT.riskLevel,
        assessment: EARTHQUAKE_ASSESSMENT,
        gisData: buildEarthquakeAssessmentGisData(parsed.region),
        metadata: {
          capability: "earthquake-assessment",
          responseType: "earthquake_assessment",
          mock: true,
        },
      };
    },
  };
}
