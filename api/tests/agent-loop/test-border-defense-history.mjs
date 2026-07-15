import assert from "node:assert/strict";

const { outcomeFromTaskResult, stepsFromTaskResult } = await import(
  "../../../src/lib/borderDefenseRun.ts"
);

const result = {
  message: "done",
  turns: 2,
  stoppedBy: "final_answer",
  observations: [
    { toolCallId: "skill-1", toolName: "Skill", ok: true, output: { loaded: true } },
    {
      toolCallId: "report-1",
      toolName: "DailyReport",
      ok: true,
      output: {
        report_content: "fallback",
        generation: { status: "degraded", modelUsed: false, error: "timeout" },
      },
    },
  ],
};

const steps = stepsFromTaskResult(result);
assert.deepEqual(steps.map((step) => step.name), ["Skill", "Agent Turn 1", "DailyReport", "Agent Turn 2"]);
assert.ok(steps.every((step) => step.status === "completed"));

const outcome = outcomeFromTaskResult(result);
assert.equal(outcome?.outcome, "warning");
assert.match(outcome?.reason || "", /降级报告/);

console.log("border-defense history replay tests passed");
