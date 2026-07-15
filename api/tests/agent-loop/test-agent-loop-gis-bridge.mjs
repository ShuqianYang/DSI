import assert from "node:assert/strict";

const {
  extractGisPushesFromTaskResult,
} = await import("../../../src/lib/agentLoopGisBridge.ts");

{
  const pushes = extractGisPushesFromTaskResult("task-gis", {
    mode: "agent_loop",
    observations: [
      {
        toolCallId: "call-native",
        toolName: "RegionMark",
        ok: true,
        output: {
          gisData: {
            type: "region",
            regions: [{ id: "native-region" }],
          },
        },
      },
    ],
    "call-projected": {
      success: true,
      gisData: {
        type: "wind-field",
        windField: { speed: [4] },
      },
      metadata: {
        toolCallId: "call-projected",
        toolName: "WeatherFetch",
      },
    },
  });

  assert.equal(pushes.length, 2);
  assert.equal(pushes[0].key, "task-gis:call-native");
  assert.equal(pushes[0].source, "agent-loop-result");
  assert.equal(pushes[1].key, "task-gis:call-projected");
  assert.equal(pushes[1].source, "dashboard-result");
  assert.equal(pushes[1].toolCallId, "call-projected");
  assert.equal(pushes[1].toolName, "WeatherFetch");
  assert.equal(pushes[1].gisData.type, "wind-field");
}

{
  const pushes = extractGisPushesFromTaskResult("task-gis", {
    mode: "agent_loop",
    observations: [
      {
        toolCallId: "call-dupe",
        toolName: "RegionMark",
        ok: true,
        output: {
          gisData: {
            type: "region",
            regions: [{ id: "native-region" }],
          },
        },
      },
    ],
    "call-dupe": {
      success: true,
      gisData: {
        type: "region",
        regions: [{ id: "projected-region" }],
      },
      metadata: {
        toolCallId: "call-dupe",
        toolName: "RegionMark",
      },
    },
  });

  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].source, "agent-loop-result");
  assert.equal(pushes[0].gisData.regions[0].id, "native-region");
}

console.log("agent loop gis bridge test passed");
