import assert from "node:assert/strict";

const { buildAgentLoopTaskResult } = await import("../src/modules/tasks/agentLoopResultProjection.ts");

{
  const result = buildAgentLoopTaskResult({
    finalAnswer: "done",
    turns: 2,
    stoppedBy: "final_answer",
    observations: [
      {
        toolCallId: "tool-weather",
        toolName: "WeatherFetch",
        ok: true,
        output: {
          summary: "weather done",
          gisData: {
            type: "wind-field",
            windField: { speed: [4] },
          },
        },
      },
      {
        toolCallId: "tool-failed",
        toolName: "WeatherFetch",
        ok: false,
        error: { code: "tool_execution_error", message: "failed" },
      },
    ],
  });

  assert.equal(result.message, "done");
  assert.equal(result.mode, "agent_loop");
  assert.equal(result.observations.length, 2);
  assert.equal(result["tool-weather"].gisData.type, "wind-field");
  assert.equal(result["tool-weather"].metadata.toolName, "WeatherFetch");
  assert.equal(result["tool-failed"].success, false);
  assert.equal(result["tool-failed"].error.message, "failed");
}

console.log("agent loop result projection test passed");
