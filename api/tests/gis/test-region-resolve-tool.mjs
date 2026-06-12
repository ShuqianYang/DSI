import assert from "node:assert/strict";
import "dotenv/config";

const { buildRegionResolveTool } = await import("../../src/modules/agent-loop/tools/domain/gis/regionResolve.ts");
const { buildRegionMarkTool } = await import("../../src/modules/agent-loop/tools/domain/gis/regionMark.ts");
const { buildDefaultToolRegistry } = await import("../../src/modules/agent-loop/tools/_shared/toolRegistry.ts");

const EAST_CHINA_SEA = "\u4e2d\u56fd\u4e1c\u6d77";
const EAST_SEA_ALIAS = "\u4e1c\u6d77";
const FUJIAN = "\u798f\u5efa\u7701";
const TAIWAN_STRAIT = "\u53f0\u6e7e\u6d77\u5ce1";
const FUZHOU = "\u798f\u5dde\u5e02";
const TAICHUNG = "\u53f0\u4e2d\u5e02";
const PHILIPPINES = "\u83f2\u5f8b\u5bbe";
const GUANGXI = "\u5e7f\u897f";
const GUANGXI_FULL = "\u5e7f\u897f\u58ee\u65cf\u81ea\u6cbb\u533a";
const INVALID_GUANGXI_ALIAS = "\u5e7f\u897f\u58ee\u65cf";
const BEIJING = "\u5317\u4eac";
const BEIJING_FULL = "\u5317\u4eac\u5e02";

function createContext(query = "resolve region") {
  return {
    taskId: "region-resolve-test-task",
    query,
    observations: [],
  };
}

function assertValidBbox(bbox) {
  assert.equal(typeof bbox.west, "number");
  assert.equal(typeof bbox.east, "number");
  assert.equal(typeof bbox.south, "number");
  assert.equal(typeof bbox.north, "number");
  assert.equal(bbox.west < bbox.east, true);
  assert.equal(bbox.south < bbox.north, true);
}

{
  const tool = buildRegionResolveTool();
  const output = await tool.execute({ regionName: EAST_SEA_ALIAS }, createContext());

  assert.equal(output.resolved, true);
  assert.equal(output.selected.name, EAST_CHINA_SEA);
  assert.equal(output.selected.source, "geojson_asset");
  assert.equal(output.selected.sourcePath, "public/geo/eastern_china_sea.geojson");
  assert.equal(output.selected.matchType, "exact_alias");
  assert.equal(output.selected.confidence, 1);
  assertValidBbox(output.selected.bbox);
  assert.equal(output.selected.bbox.west, 118.478046);
  assert.equal(output.selected.bbox.east, 131.132204);
}

{
  const tool = buildRegionResolveTool();
  const output = await tool.execute({ query: `\u8bf7\u5708\u9009${EAST_CHINA_SEA}\u5e76\u67e5\u8be2\u98ce\u573a` }, createContext());

  assert.equal(output.resolved, true);
  assert.equal(output.selected.name, EAST_CHINA_SEA);
  assert.equal(output.selected.matchType, "query_contains_name");
}

{
  const tool = buildRegionResolveTool();
  const output = await tool.execute({ regionName: FUJIAN }, createContext());

  assert.equal(output.resolved, true);
  assert.equal(output.selected.name, FUJIAN);
  assert.equal(output.selected.source, "postgis");
  assert.equal(output.selected.sourceTable, "china_province");
  assert.equal(output.selected.stableId, "350000");
  assert.equal(output.selected.geometryRef.schema, "region_geom");
  assert.equal(output.selected.geometryRef.catalog, "region_resolve_catalog");
  assert.equal(output.selected.matchType, "exact_name");
  assertValidBbox(output.selected.bbox);
}

{
  const tool = buildRegionResolveTool();
  const output = await tool.execute({ regionName: BEIJING }, createContext());

  assert.equal(output.resolved, true);
  assert.equal(output.selected.name, BEIJING_FULL);
  assert.notEqual(output.selected.sourceTable, "international", "capital alias should not beat the direct Beijing administrative region");
  assert(["china_city", "china_province"].includes(output.selected.sourceTable));
  assert.equal(output.selected.stableId, "110000");
  assert.deepEqual(output.selected.bbox, {
    west: 115.423411,
    east: 117.514583,
    south: 39.442758,
    north: 41.0608,
  });
  assert.equal(
    output.candidates.some((candidate) => candidate.name === "\u4e2d\u56fd"),
    true,
    "China can remain a candidate, but must not be selected for Beijing"
  );
}

{
  const tool = buildRegionResolveTool();
  const output = await tool.execute({ regionName: TAIWAN_STRAIT }, createContext());

  assert.equal(output.resolved, true);
  assert.equal(output.selected.name, TAIWAN_STRAIT);
  assert.equal(output.selected.source, "postgis");
  assert.equal(output.selected.sourceTable, "custom_region");
  assert.equal(output.selected.level, "strait");
  assert.equal(output.selected.geometryRef.sourceId, "92");
  assert.equal(output.selected.geometryRef.stableId, "92");
  assert.equal(output.selected.matchType, "exact_name");
  assert.deepEqual(output.selected.bbox, { west: 117, east: 122.5, south: 22, north: 26.5 });
  assert.equal(JSON.stringify(output).includes("coordinates"), false, "RegionResolve observation must not include geometry coordinates");
}

{
  const tool = buildRegionResolveTool();
  const output = await tool.execute({ regionName: FUZHOU }, createContext());

  assert.equal(output.resolved, true);
  assert.equal(output.selected.name, FUZHOU);
  assert.equal(output.selected.source, "postgis");
  assert.equal(output.selected.sourceTable, "china_city");
  assert.equal(output.selected.stableId, "350100");
  assert.equal(output.selected.level, "city");
}

{
  const tool = buildRegionResolveTool();
  const output = await tool.execute({ regionName: TAICHUNG }, createContext());

  assert.equal(output.resolved, true);
  assert.equal(output.selected.name, TAICHUNG);
  assert.equal(output.selected.source, "postgis");
  assert.equal(output.selected.sourceTable, "taiwan");
  assert.equal(output.selected.level, "taiwan_admin");
}

{
  const tool = buildRegionResolveTool();
  const output = await tool.execute({ regionName: PHILIPPINES }, createContext());

  assert.equal(output.resolved, true);
  assert.equal(output.selected.name, PHILIPPINES);
  assert.equal(output.selected.source, "postgis");
  assert.equal(output.selected.sourceTable, "international");
  assert.equal(output.selected.level, "country");
}

{
  const tool = buildRegionResolveTool();
  const output = await tool.execute({ regionName: "\u4e2d\u56fd\u4e1c", minConfidence: 0.95 }, createContext());

  assert.equal(output.resolved, false);
  assert(output.candidates.length > 0);
  assert(output.candidates.some((candidate) => candidate.name === EAST_CHINA_SEA));
}

{
  const tool = buildRegionResolveTool();
  const output = await tool.execute({ regionName: "\u4e1c", minConfidence: 0.95 }, createContext());

  assert.equal(output.resolved, false);
  assert.equal(output.candidates.length, 0, "single-character fuzzy matches should not return broad candidates");
}

{
  const tool = buildRegionResolveTool();
  const output = await tool.execute({ regionName: GUANGXI }, createContext());

  assert.equal(output.resolved, true);
  assert.equal(output.selected.name, GUANGXI_FULL);
  assert(output.selected.aliases.includes(GUANGXI));
  assert.equal(output.selected.aliases.includes(INVALID_GUANGXI_ALIAS), false);
}

{
  const registry = buildDefaultToolRegistry();
  assert(registry.get("RegionResolve"));
  assert(registry.get("region-resolve"));
}

{
  const resolveTool = buildRegionResolveTool();
  const markTool = buildRegionMarkTool();
  const resolved = await resolveTool.execute({ regionName: EAST_SEA_ALIAS }, createContext());
  const marked = await markTool.execute(
    {
      name: resolved.selected.name,
      bbox: resolved.selected.bbox,
    },
    createContext()
  );

  assert.equal(marked.gisData.type, "region");
  assert.deepEqual(marked.gisData.cameraView.bbox, resolved.selected.bbox);
}

console.log("region resolve tool test passed");
