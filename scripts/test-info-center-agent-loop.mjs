import assert from "node:assert/strict";

const {
  buildInfoCenterAgentLoopView,
  shouldCloseInfoCenterStreamForEvent,
  shouldRefreshInfoCenterForStreamEvent,
} = await import("../src/lib/infoCenterAgentLoop.ts");

{
  const view = buildInfoCenterAgentLoopView({
    taskId: "task-info-1",
    result: {
      mode: "agent_loop",
      message: "已完成区域圈选。",
      stoppedBy: "final_answer",
      turns: 2,
      observations: [
        {
          toolCallId: "call-region-mark",
          toolName: "RegionMark",
          ok: true,
          output: {
            summary: "已圈选台湾海峡。",
            gisData: { type: "region", regions: [{ id: "taiwan-strait" }] },
          },
        },
      ],
    },
  });

  assert.ok(view);
  assert.equal(view.message, "已完成区域圈选。");
  assert.equal(view.toolSummaries.length, 1);
  assert.equal(view.toolSummaries[0].toolName, "RegionMark");
  assert.equal(view.gisDataItems.length, 1);
}

assert.equal(buildInfoCenterAgentLoopView({ taskId: "legacy", result: null }), null);
assert.equal(buildInfoCenterAgentLoopView({ taskId: "legacy", result: { mode: "legacy" } }), null);

assert.equal(shouldRefreshInfoCenterForStreamEvent({ type: "tool_observation" }), true);
assert.equal(shouldRefreshInfoCenterForStreamEvent({ type: "loop_stop" }), true);
assert.equal(shouldRefreshInfoCenterForStreamEvent({ type: "step_update" }), true);
assert.equal(shouldRefreshInfoCenterForStreamEvent({ type: "completed" }), true);
assert.equal(shouldRefreshInfoCenterForStreamEvent({ type: "connected" }), false);
assert.equal(shouldRefreshInfoCenterForStreamEvent({ type: "assistant_message" }), false);

assert.equal(shouldCloseInfoCenterStreamForEvent({ type: "loop_stop" }), true);
assert.equal(shouldCloseInfoCenterStreamForEvent({ type: "tool_observation" }), false);

console.log("test-info-center-agent-loop passed");
