import "dotenv/config";

const { buildRegionMarkTool } = await import("../src/modules/agent-loop/tools/domain/gis/regionMark.ts");

const tool = buildRegionMarkTool();
const output = await tool.execute(
  {
    name: "日本",
    geometryRef: {
      schema: "region_geom",
      catalog: "region_resolve_catalog",
      sourceTable: "international",
      sourceId: "85",
      stableId: "85",
    },
    regionType: "monitor",
  },
  {
    taskId: "test",
    query: "test",
    observations: [],
  }
);

const json = JSON.stringify(output);
console.log("Output size:", json.length, "chars");
console.log("maxResultSizeChars:", 40000);
console.log("Truncated?", !!output.truncated);
console.log("gisData exists?", !!output.gisData);

if (output.gisData) {
  const r = output.gisData.regions[0];
  console.log("Coordinates count:", r.coordinates.length);
  console.log("CameraView:", JSON.stringify(output.gisData.cameraView));
}
