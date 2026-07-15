import assert from "node:assert/strict";

const { buildLoopStopEventFromTaskResult } = await import("../../src/modules/tasks/agentLoopSseMode.ts");

{
  const event = buildLoopStopEventFromTaskResult({
    taskId: "task-1",
    status: "completed",
    result: {
      mode: "agent_loop",
      message: "complete answer",
      turns: 3,
      stoppedBy: "final_answer",
      logFilePath: "S:/Projects/projects_new/logs/agent-loop-task-1.jsonl",
      observations: [
        {
          toolCallId: "call-1",
          toolName: "RegionMark",
          ok: true,
          output: { gisData: { type: "region" } },
        },
      ],
    },
  });

  assert.equal(event?.type, "loop_stop");
  assert.equal(event.taskId, "task-1");
  assert.equal(event.turn, 3);
  assert.equal(event.result.finalAnswer, "complete answer");
  assert.equal(event.result.stoppedBy, "final_answer");
  assert.equal(event.result.logFilePath, "S:/Projects/projects_new/logs/agent-loop-task-1.jsonl");
  assert.equal(event.result.observations[0].toolName, "RegionMark");
}

{
  const event = buildLoopStopEventFromTaskResult({
    taskId: "task-2",
    status: "failed",
    error: "model unavailable",
    result: null,
  });

  assert.equal(event?.type, "loop_stop");
  assert.equal(event.result.finalAnswer, "model unavailable");
  assert.equal(event.result.stoppedBy, "model_error");
  assert.equal(event.result.turns, 0);
  assert.deepEqual(event.result.observations, []);
}

{
  const event = buildLoopStopEventFromTaskResult({
    taskId: "task-3",
    status: "completed",
    result: { message: "legacy result" },
  });

  assert.equal(event, undefined);
}

console.log("agent loop sse mode tests passed");
