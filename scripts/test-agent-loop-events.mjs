import assert from "node:assert/strict";
const {
  extractGisDataFromAgentLoopEvent,
  formatAgentLoopTraceLine,
  parseTaskStreamEvent,
} = await import("../src/lib/agentLoopEvents.ts");

const gisData = {
  type: "region",
  cameraView: { type: "fit-bbox", bbox: { west: 118, south: 22, east: 122, north: 26 } },
  regions: [{ id: "taiwan-strait" }],
};

const nativeObservation = {
  type: "tool_observation",
  taskId: "task-1",
  turn: 1,
  toolCallId: "call-region-mark",
  toolName: "RegionMark",
  ok: true,
  observation: {
    toolCallId: "call-region-mark",
    toolName: "RegionMark",
    ok: true,
    output: { gisData },
  },
};

{
  const parsed = parseTaskStreamEvent(nativeObservation);
  assert.equal(parsed.kind, "agent-loop");
  assert.equal(parsed.event.type, "tool_observation");
  assert.deepEqual(extractGisDataFromAgentLoopEvent(parsed.event), gisData);
}

{
  const parsed = parseTaskStreamEvent({ type: "step_update", actionId: "legacy-1" });
  assert.equal(parsed.kind, "legacy");
}

{
  const parsed = parseTaskStreamEvent({ type: "connected", taskId: "task-1" });
  assert.equal(parsed.kind, "control");
}

{
  const parsed = parseTaskStreamEvent({ type: "something_else" });
  assert.equal(parsed.kind, "unknown");
}

{
  const line = formatAgentLoopTraceLine("task-1", nativeObservation);
  assert.match(line, /tool_observation/);
  assert.match(line, /RegionMark/);
  assert.match(line, /gisData=region/);
}

console.log("test-agent-loop-events passed");
