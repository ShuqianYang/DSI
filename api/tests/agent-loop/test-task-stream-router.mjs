import assert from "node:assert/strict";

const { routeTaskStreamEvent } = await import("../../../src/lib/taskStreamRouter.ts");
const { createTaskStreamModeTracker } = await import("../../../src/lib/taskStreamLifecycle.ts");

{
  const tracker = createTaskStreamModeTracker();
  const routed = routeTaskStreamEvent({
    taskId: "task-native",
    event: { type: "tool_call", taskId: "task-native", turn: 1, toolCallId: "call-1", toolName: "RegionMark" },
    tracker,
  });

  assert.equal(routed.kind, "agent-loop");
  assert.equal(routed.event.type, "tool_call");

  const legacy = routeTaskStreamEvent({
    taskId: "task-native",
    event: { type: "step_update", actionId: "call-1", status: "completed" },
    tracker,
  });

  assert.equal(legacy.kind, "ignored-legacy");
}

{
  const tracker = createTaskStreamModeTracker();
  tracker.preferNative("task-prefer-native");

  const routed = routeTaskStreamEvent({
    taskId: "task-prefer-native",
    event: { type: "completed", taskId: "task-prefer-native", status: "completed" },
    tracker,
  });

  assert.equal(routed.kind, "ignored-legacy");
}

{
  const tracker = createTaskStreamModeTracker();
  const routed = routeTaskStreamEvent({
    taskId: "task-legacy-only",
    event: { type: "step_update", actionId: "legacy-1", status: "completed" },
    tracker,
  });

  assert.equal(routed.kind, "ignored-legacy");
  assert.equal(routed.event.type, "step_update");
}

{
  const tracker = createTaskStreamModeTracker();
  const routed = routeTaskStreamEvent({
    taskId: "task-control",
    event: { type: "connected", taskId: "task-control" },
    tracker,
  });

  assert.equal(routed.kind, "control");
}

{
  const tracker = createTaskStreamModeTracker();
  const routed = routeTaskStreamEvent({
    taskId: "task-subscription",
    event: { type: "subscription_completed", taskId: "task-subscription" },
    tracker,
  });

  assert.equal(routed.kind, "unknown");
}

console.log("task stream router test passed");
