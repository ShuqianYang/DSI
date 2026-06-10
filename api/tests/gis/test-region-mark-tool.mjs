import assert from "node:assert/strict";

const { buildRegionMarkTool } = await import("../../src/modules/agent-loop/regionTools.ts");
const { buildDefaultToolRegistry } = await import("../../src/modules/agent-loop/toolRegistry.ts");
const { buildAgentLoopTaskResult } = await import("../../src/modules/tasks/agentLoopResultProjection.ts");

function createContext() {
  return {
    taskId: "region-test-task",
    query: "mark region",
    observations: [],
  };
}

{
  const tool = buildRegionMarkTool();

  await assert.rejects(
    () => tool.execute({ name: "台湾海峡" }, createContext()),
    /RegionMark requires either bbox or polygon/,
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
