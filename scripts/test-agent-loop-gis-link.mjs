import assert from "node:assert/strict";

const {
  buildAgentLoopGisLinkId,
  buildAgentLoopGisOutputLinkId,
} = await import("../src/lib/agentLoopGisLink.ts");

assert.equal(
  buildAgentLoopGisLinkId("task-1", "call-region-mark"),
  "agent-loop:task-1:call-region-mark",
);

assert.equal(
  buildAgentLoopGisOutputLinkId({
    taskId: "task-1",
    toolCallId: "call-region-mark",
    index: 7,
  }),
  "agent-loop:task-1:call-region-mark",
);

assert.equal(
  buildAgentLoopGisOutputLinkId({
    taskId: "task-1",
    index: 0,
  }),
  "agent-loop:task-1:idx-0",
);

assert.equal(
  buildAgentLoopGisOutputLinkId({
    taskId: "task-1",
    index: 1,
  }),
  "agent-loop:task-1:idx-1",
);

console.log("test-agent-loop-gis-link passed");
