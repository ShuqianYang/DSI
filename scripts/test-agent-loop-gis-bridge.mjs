import assert from "node:assert/strict";

const {
  extractGisPushesFromAgentLoopEvent,
  extractGisPushesFromLegacySse,
  extractGisPushesFromTaskResult,
} = await import("../src/lib/agentLoopGisBridge.ts");

{
  const pushes = extractGisPushesFromAgentLoopEvent("task-gis-1", {
    type: "tool_observation",
    taskId: "task-gis-1",
    turn: 1,
    toolCallId: "call-region-mark",
    toolName: "RegionMark",
    ok: true,
    observation: {
      toolCallId: "call-region-mark",
      toolName: "RegionMark",
      ok: true,
      output: {
        gisData: {
          type: "region",
          regions: [{ id: "region-1" }],
        },
      },
    },
  });

  assert.equal(pushes.length, 1);
  assert.deepEqual(pushes[0], {
    key: "task-gis-1:call-region-mark",
    source: "agent-loop-event",
    toolCallId: "call-region-mark",
    toolName: "RegionMark",
    gisData: {
      type: "region",
      regions: [{ id: "region-1" }],
    },
  });
}

{
  const pushes = extractGisPushesFromAgentLoopEvent("task-gis-2", {
    type: "tool_observation",
    taskId: "task-gis-2",
    turn: 1,
    toolCallId: "call-weather",
    toolName: "WeatherFetch",
    ok: true,
    observation: {
      toolCallId: "call-weather",
      toolName: "WeatherFetch",
      ok: true,
      output: {
        data: {
          gisData: {
            type: "wind-field",
            windField: { points: [] },
          },
        },
      },
    },
  });

  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].key, "task-gis-2:call-weather");
  assert.equal(pushes[0].gisData.type, "wind-field");
}

{
  const pushes = extractGisPushesFromAgentLoopEvent("task-gis-3", {
    type: "loop_stop",
    taskId: "task-gis-3",
    turn: 2,
    result: {
      finalAnswer: "done",
      turns: 2,
      stoppedBy: "final_answer",
      observations: [
        {
          toolCallId: "call-region-mark",
          toolName: "RegionMark",
          ok: true,
          output: {
            gisData: {
              type: "region",
              regions: [{ id: "region-from-loop-stop" }],
            },
          },
        },
      ],
    },
  });

  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].source, "agent-loop-result");
  assert.equal(pushes[0].key, "task-gis-3:call-region-mark");
}

{
  const pushes = extractGisPushesFromTaskResult("task-gis-4", {
    mode: "agent_loop",
    message: "done",
    observations: [
      {
        toolCallId: "call-region-mark",
        toolName: "RegionMark",
        ok: true,
        output: {
          gisData: {
            type: "region",
            regions: [{ id: "native-result-region" }],
          },
        },
      },
    ],
    "call-region-mark": {
      success: true,
      gisData: {
        type: "region",
        regions: [{ id: "legacy-duplicate" }],
      },
    },
    "call-weather": {
      success: true,
      data: {
        gisData: {
          type: "wind-field",
          windField: { points: [] },
        },
      },
    },
  });

  assert.equal(pushes.length, 2);
  assert.equal(pushes[0].source, "agent-loop-result");
  assert.equal(pushes[0].key, "task-gis-4:call-region-mark");
  assert.equal(pushes[0].gisData.regions[0].id, "native-result-region");
  assert.equal(pushes[1].source, "legacy-result");
  assert.equal(pushes[1].key, "task-gis-4:call-weather");
  assert.equal(pushes[1].gisData.type, "wind-field");
}

{
  const pushes = extractGisPushesFromLegacySse("task-gis-5", {
    type: "step_update",
    status: "completed",
    actionId: "legacy-region-mark",
    actionType: "region-mark",
    gisData: {
      type: "region",
      regions: [{ id: "legacy-sse-region" }],
    },
  });

  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].source, "legacy-sse");
  assert.equal(pushes[0].key, "task-gis-5:legacy-region-mark");
  assert.equal(pushes[0].toolName, "region-mark");
}

assert.equal(extractGisPushesFromLegacySse("task-gis-6", { type: "step_update", status: "running" }).length, 0);
assert.equal(extractGisPushesFromTaskResult("task-gis-7", { mode: "agent_loop", observations: [] }).length, 0);

console.log("test-agent-loop-gis-bridge passed");
