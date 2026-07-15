import assert from "node:assert/strict";

const {
  buildAgentLoopTaskView,
} = await import("../src/lib/agentLoopTaskView.ts");

assert.equal(buildAgentLoopTaskView(null), null);
assert.equal(buildAgentLoopTaskView({ mode: "legacy", observations: [] }), null);

{
  const view = buildAgentLoopTaskView({
    mode: "agent_loop",
    message: "已完成区域圈选和天气查询。",
    stoppedBy: "final_answer",
    turns: 3,
    logFilePath: "S:\\Projects\\projects_new\\logs\\agent-loop-task.jsonl",
    observations: [
      {
        toolCallId: "call-region-mark",
        toolName: "RegionMark",
        ok: true,
        output: {
          regionName: "台湾海峡",
          summary: "已圈选台湾海峡。",
          gisData: {
            type: "region",
            regions: [{ id: "taiwan-strait" }],
          },
        },
      },
      {
        toolCallId: "call-weather",
        toolName: "WeatherFetch",
        ok: true,
        output: {
          data: {
            summary: "平均风速 12m/s。",
            gisData: {
              type: "wind-field",
              windField: { points: [] },
            },
          },
        },
      },
    ],
  });

  assert.ok(view);
  assert.equal(view.message, "已完成区域圈选和天气查询。");
  assert.equal(view.stoppedBy, "final_answer");
  assert.equal(view.logFilePath, "S:\\Projects\\projects_new\\logs\\agent-loop-task.jsonl");
  assert.equal(view.toolSummaries.length, 2);
  assert.deepEqual(view.toolSummaries[0], {
    toolCallId: "call-region-mark",
    toolName: "RegionMark",
    ok: true,
    summary: "已圈选台湾海峡。",
    gisDataType: "region",
  });
  assert.deepEqual(view.toolSummaries[1], {
    toolCallId: "call-weather",
    toolName: "WeatherFetch",
    ok: true,
    summary: "平均风速 12m/s。",
    gisDataType: "wind-field",
  });
  assert.equal(view.gisDataItems.length, 2);
  assert.equal(view.gisDataItems[0].toolName, "RegionMark");
  assert.equal(view.gisDataItems[1].gisData.type, "wind-field");
}

{
  const view = buildAgentLoopTaskView({
    mode: "agent_loop",
    message: "",
    stoppedBy: "model_error",
    observations: [
      {
        toolCallId: "call-failed",
        toolName: "WeatherFetch",
        ok: false,
        error: {
          code: "weather_failed",
          message: "Weather provider unavailable.",
        },
      },
    ],
  });

  assert.ok(view);
  assert.equal(view.toolSummaries[0].ok, false);
  assert.equal(view.toolSummaries[0].summary, "Weather provider unavailable.");
}

console.log("test-agent-loop-task-view passed");
