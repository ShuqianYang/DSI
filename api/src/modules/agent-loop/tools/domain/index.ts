import type { ToolRegistry } from "../_shared/toolRegistry.js";
import { buildSqlQuerySchemaTool } from "./sql/schema.js";
import { buildSqlQueryTool } from "./sql/query.js";
import { buildWeatherFetchTool } from "./weather/weather.js";
import { buildDisasterQueryTool } from "./disaster/disaster.js";
import { buildSatelliteImageSearchTool } from "./satellite/satellite.js";
import { buildImageAnalysisTool } from "./satellite/imageAnalysis.js";
import { buildRegionResolveTool } from "./gis/regionResolve.js";
import { buildRegionMarkTool } from "./gis/regionMark.js";
import { buildDailyReportTool } from "./dailyReport/dailyReport.js";

export function registerDomainTools(registry: ToolRegistry): void {
  for (const tool of buildDomainTools()) {
    registry.register(tool);
  }
}

export function buildDomainTools(): ReturnType<typeof buildSqlQueryTool>[] {
  return [
    buildSqlQuerySchemaTool(),
    buildSqlQueryTool(),
    buildWeatherFetchTool(),
    buildDisasterQueryTool(),
    buildSatelliteImageSearchTool(),
    buildImageAnalysisTool(),
    buildRegionResolveTool(),
    buildRegionMarkTool(),
    buildDailyReportTool(),
  ];
}
