import assert from "node:assert/strict";

const {
  clearAgentLoopFrontendTrace,
  copyAgentLoopFrontendTrace,
  getAgentLoopFrontendTrace,
  recordAgentLoopUpdate,
  recordGisPush,
  recordTaskFinished,
  recordTaskStreamEvent,
  serializeAgentLoopFrontendTrace,
} = await import("../src/lib/agentLoopFrontendTrace.ts");

clearAgentLoopFrontendTrace("task-trace-1");

recordTaskStreamEvent(
  "task-trace-1",
  { type: "tool_call", taskId: "task-trace-1", toolName: "RegionResolve" },
  { kind: "agent-loop", event: { type: "tool_call", toolName: "RegionResolve" } },
);

recordAgentLoopUpdate(
  "task-trace-1",
  { type: "tool_call", taskId: "task-trace-1", toolName: "RegionResolve" },
  {
    steps: [
      {
        id: "call-1",
        name: "RegionResolve",
        status: "running",
        detail: "resolve region",
        category: "tool",
        toolName: "RegionResolve",
      },
    ],
  },
);

recordGisPush(
  "task-trace-1",
  {
    type: "region",
    cameraView: { type: "fit-bbox", bbox: { west: 118, south: 24, east: 131, north: 33 } },
    regions: [{ id: "east-china-sea" }],
  },
  "agent-loop:tool_observation",
);

recordTaskFinished(
  "task-trace-1",
  "completed",
  "S:\\Projects\\projects_new\\logs\\agent-loop-task-trace-1.jsonl",
);

const trace = getAgentLoopFrontendTrace("task-trace-1");
assert.equal(trace.taskId, "task-trace-1");
assert.equal(trace.backendLogFilePath, "S:\\Projects\\projects_new\\logs\\agent-loop-task-trace-1.jsonl");
assert.equal(trace.events.length, 4);
assert.equal(trace.events[0].kind, "sse");
assert.equal(trace.events[0].rawType, "tool_call");
assert.equal(trace.events[1].kind, "agent_loop_update");
assert.equal(trace.events[1].summary, "RegionResolve: running");
assert.equal(trace.events[2].kind, "gis_push");
assert.equal(trace.events[2].summary, "gisData=region source=agent-loop:tool_observation");
assert.equal(trace.events[3].kind, "task_finished");

const serialized = serializeAgentLoopFrontendTrace("task-trace-1");
const parsed = JSON.parse(serialized);
assert.equal(parsed.taskId, "task-trace-1");
assert.equal(parsed.events.length, 4);

let copied = "";
const didCopy = await copyAgentLoopFrontendTrace("task-trace-1", async (text) => {
  copied = text;
});
assert.equal(didCopy, true);
assert.equal(JSON.parse(copied).taskId, "task-trace-1");

clearAgentLoopFrontendTrace("task-trace-1");
assert.equal(getAgentLoopFrontendTrace("task-trace-1").events.length, 0);

console.log("test-agent-loop-frontend-trace passed");
