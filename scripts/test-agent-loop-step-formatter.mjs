import assert from "node:assert/strict";
const {
  formatAgentLoopThinkingUpdate,
  summarizeToolObservation,
} = await import("../src/lib/agentLoopStepFormatter.ts");

{
  const update = formatAgentLoopThinkingUpdate({
    type: "tool_call",
    taskId: "task-1",
    turn: 1,
    toolCallId: "call-region-resolve",
    toolName: "RegionResolve",
    reason: "Resolve named region before map linkage.",
  });

  assert.equal(update.steps.length, 1);
  assert.deepEqual(update.steps[0], {
    id: "call-region-resolve",
    name: "RegionResolve",
    status: "running",
    detail: "Resolve named region before map linkage.",
    category: "tool",
    eventType: "tool_call",
    toolName: "RegionResolve",
    toolCallId: "call-region-resolve",
  });
}

{
  const event = {
    type: "tool_observation",
    taskId: "task-1",
    turn: 1,
    toolCallId: "call-region-resolve",
    toolName: "RegionResolve",
    ok: true,
    observation: {
      toolCallId: "call-region-resolve",
      toolName: "RegionResolve",
      ok: true,
      output: {
        resolved: true,
        selected: {
          name: "中国东海",
          bbox: { west: 118, east: 131, south: 24, north: 33 },
        },
      },
    },
  };

  assert.equal(summarizeToolObservation(event), "已解析区域：中国东海");

  const update = formatAgentLoopThinkingUpdate(event);
  assert.equal(update.steps[0].status, "completed");
  assert.equal(update.steps[0].detail, "已解析区域：中国东海");
  assert.equal(update.steps[0].category, "tool");
}

{
  const update = formatAgentLoopThinkingUpdate({
    type: "tool_observation",
    taskId: "task-1",
    turn: 2,
    toolCallId: "call-region-mark",
    toolName: "RegionMark",
    ok: true,
    observation: {
      toolCallId: "call-region-mark",
      toolName: "RegionMark",
      ok: true,
      output: {
        regionName: "中国东海",
        gisData: {
          type: "region",
          cameraView: {
            type: "fit-bbox",
            bbox: { west: 118, east: 131, south: 24, north: 33 },
          },
        },
      },
    },
  });

  assert.equal(update.steps[0].detail, "地图区域已生成：中国东海");
  assert.equal(update.steps[0].category, "gis");
}

{
  const update = formatAgentLoopThinkingUpdate({
    type: "loop_stop",
    taskId: "task-1",
    turn: 4,
    result: {
      finalAnswer: "已完成区域圈选和风场查询。",
      turns: 4,
      observations: [],
      stoppedBy: "final_answer",
      logFilePath: "S:\\Projects\\projects_new\\logs\\agent-loop-task-1.jsonl",
    },
  });

  assert.equal(update.content, "已完成区域圈选和风场查询。");
  assert.equal(update.logFilePath, "S:\\Projects\\projects_new\\logs\\agent-loop-task-1.jsonl");
  assert.equal(update.completeOpenStepsAs, "completed");
  assert.equal(update.steps[0].name, "Loop Stop");
  assert.equal(update.steps[0].category, "result");
}

console.log("test-agent-loop-step-formatter passed");
