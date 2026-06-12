import assert from "node:assert/strict";

const {
  buildAgentLoopTaskResultFromStop,
  getTaskFinishFromAgentLoopEvent,
  getTaskFinishFromStreamEvent,
  isNativeAgentLoopProgressEvent,
} = await import("../../../src/lib/taskStreamLifecycle.ts");

const loopStop = {
  type: "loop_stop",
  taskId: "task-native",
  turn: 4,
  result: {
    finalAnswer: "完整结果",
    turns: 4,
    stoppedBy: "final_answer",
    logFilePath: "S:/Projects/projects_new/logs/agent-loop-test.jsonl",
    observations: [
      {
        toolCallId: "tool-1",
        toolName: "RegionMark",
        ok: true,
        output: {
          gisData: {
            type: "region",
            regions: [{ id: "region-1", name: "台湾海峡" }],
          },
        },
      },
    ],
  },
};

assert.deepEqual(getTaskFinishFromAgentLoopEvent(loopStop), {
  status: "completed",
  logFilePath: "S:/Projects/projects_new/logs/agent-loop-test.jsonl",
});

assert.deepEqual(getTaskFinishFromAgentLoopEvent({
  ...loopStop,
  result: { ...loopStop.result, stoppedBy: "model_error", finalAnswer: "模型错误" },
}), {
  status: "failed",
  logFilePath: "S:/Projects/projects_new/logs/agent-loop-test.jsonl",
});

assert.equal(getTaskFinishFromAgentLoopEvent({ type: "tool_call", taskId: "task-native" }), undefined);

const result = buildAgentLoopTaskResultFromStop(loopStop);
assert.equal(result.mode, "agent_loop");
assert.equal(result.message, "完整结果");
assert.equal(result.turns, 4);
assert.equal(result.stoppedBy, "final_answer");
assert.equal(result.logFilePath, "S:/Projects/projects_new/logs/agent-loop-test.jsonl");
assert.equal(result.observations.length, 1);

assert.deepEqual(getTaskFinishFromStreamEvent(loopStop), {
  status: "completed",
  logFilePath: "S:/Projects/projects_new/logs/agent-loop-test.jsonl",
});
assert.equal(getTaskFinishFromStreamEvent({ type: "completed", logFilePath: "legacy.log" }), undefined);
assert.equal(getTaskFinishFromStreamEvent({ type: "failed" }), undefined);

assert.equal(isNativeAgentLoopProgressEvent({ type: "tool_observation" }), true);
assert.equal(isNativeAgentLoopProgressEvent({ type: "tool_progress" }), true);
assert.equal(isNativeAgentLoopProgressEvent({ type: "step_update" }), false);

console.log("task stream lifecycle test passed");
