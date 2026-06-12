import assert from "node:assert/strict";
import "dotenv/config";

const { buildRegionResolveTool } = await import("../../src/modules/agent-loop/tools/domain/gis/regionResolve.ts");
const { buildRegionMarkTool } = await import("../../src/modules/agent-loop/tools/domain/gis/regionMark.ts");
const { buildDefaultToolRegistry } = await import("../../src/modules/agent-loop/tools/_shared/toolRegistry.ts");
const { buildAgentLoopTaskResult } = await import("../../src/modules/tasks/agentLoopResultProjection.ts");

function createContext() {
  return {
    taskId: "region-test-task",
    query: "mark region",
    observations: [],
  };
}

{
  const resolveTool = buildRegionResolveTool();
  const markTool = buildRegionMarkTool();
  const resolved = await resolveTool.execute({ regionName: "\u53f0\u6e7e\u6d77\u5ce1" }, createContext());
  assert.equal(resolved.resolved, true);

  const output = await markTool.execute(
    {
      name: resolved.selected.name,
      geometryRef: resolved.selected.geometryRef,
      bbox: resolved.selected.bbox,
      label: "\u53f0\u6e7e\u6d77\u5ce1\u76d1\u63a7\u533a",
    },
    createContext()
  );

  assert.equal(output.dataSource, "postgis");
  assert.equal(output.regionName, "\u53f0\u6e7e\u6d77\u5ce1");
  assert.deepEqual(output.bbox, resolved.selected.bbox);
  assert.equal(output.gisData.cameraView.type, "fit-bbox");
  assert.deepEqual(output.gisData.cameraView.bbox, resolved.selected.bbox);
  assert.deepEqual(output.gisData.regions[0].coordinates, [
    [117, 22],
    [122.5, 22],
    [122.5, 26.5],
    [117, 26.5],
    [117, 22],
  ]);
  assert.equal(output.gisData.regions[0].label.text, "\u53f0\u6e7e\u6d77\u5ce1\u76d1\u63a7\u533a");
}

{
  const tool = buildRegionMarkTool();

  await assert.rejects(
    () => tool.execute({ name: "台湾海峡" }, createContext()),
    /RegionMark requires geometryRef, bbox, or polygon/,
    "RegionMark must not guess named-region geometry"
  );
}

{
  const tool = buildRegionMarkTool();
  const output = await tool.execute(
    {
      name: "台湾海峡测试区",
      bbox: { west: 119.5, east: 122.5, south: 22, north: 25.5 },
    },
    createContext()
  );

  assert.equal(output.dataSource, "user_input");
  assert.equal(output.regionName, "台湾海峡测试区");
  assert.deepEqual(output.gisData.regions[0].coordinates, [
    [119.5, 22],
    [122.5, 22],
    [122.5, 25.5],
    [119.5, 25.5],
    [119.5, 22],
  ]);
  assert.equal(output.gisData.type, "region");
  assert.equal(output.gisData.cameraView.type, "fit-bbox");
  assert.deepEqual(output.gisData.cameraView, {
    type: "fit-bbox",
    bbox: {
      west: 119.5,
      east: 122.5,
      south: 22,
      north: 25.5,
    },
  });
}

{
  const tool = buildRegionMarkTool();
  const output = await tool.execute(
    {
      name: "多边形测试区",
      bbox: { west: 1, east: 2, south: 1, north: 2 },
      polygon: [
        [120, 22],
        [121, 22],
        [120.5, 23],
      ],
      regionType: "control",
      label: "自定义标签",
      style: {
        fill: true,
        fillColor: "rgba(0, 100, 255, 0.1)",
        outlineColor: "#00E0FF",
        outlineWidth: 4,
      },
    },
    createContext()
  );

  assert.deepEqual(output.gisData.regions[0].coordinates, [
    [120, 22],
    [121, 22],
    [120.5, 23],
    [120, 22],
  ]);
  assert.equal(output.gisData.regions[0].type, "control");
  assert.equal(output.gisData.regions[0].label.text, "自定义标签");
  assert.equal(output.gisData.regions[0].style.outlineColor, "#00E0FF");
  assert.deepEqual(output.bbox, { west: 1, east: 2, south: 1, north: 2 });
}

{
  const tool = buildRegionMarkTool();
  const parsed = tool.inputSchema.safeParse({
    name: "非法 bbox",
    bbox: { west: 122, east: 119, south: 22, north: 25 },
  });

  assert.equal(parsed.success, false);
}

{
  const registry = buildDefaultToolRegistry();
  assert(registry.get("RegionMark"));
  assert(registry.get("region-mark"));
}

{
  const result = buildAgentLoopTaskResult({
    finalAnswer: "done",
    turns: 1,
    stoppedBy: "final_answer",
    observations: [
      {
        toolCallId: "tool-region",
        toolName: "RegionMark",
        ok: true,
        output: {
          gisData: {
            type: "region",
            regions: [{ id: "region-test" }],
          },
        },
      },
    ],
  });

  assert.equal(result["tool-region"].gisData.type, "region");
}

console.log("region mark tool test passed");
