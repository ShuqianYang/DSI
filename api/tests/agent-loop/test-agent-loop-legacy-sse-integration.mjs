import "dotenv/config";
import assert from "node:assert/strict";
import { z } from "zod";
import { eq } from "drizzle-orm";

const { runAgentLoop } = await import("../../src/modules/agent-loop/runAgentLoop.ts");
const { createLegacySseAdapter } = await import("../../src/modules/tasks/agentLoopEventAdapter.ts");
const { ToolRegistry } = await import("../../src/modules/agent-loop/tools/_shared/toolRegistry.ts");
const { db } = await import("../../src/config/database.ts");
const { tasks } = await import("../../src/db/schema.ts");

const taskId = crypto.randomUUID();
const query = "查询台湾海峡附近当前有哪些飞机";
const rawEvents = [];
const legacyEvents = [];

const registry = new ToolRegistry();
registry.register({
  name: "FakeAircraftQuery",
  description: "Fake aircraft query for legacy SSE adapter integration test.",
  kind: "domain",
  inputSchema: z.object({ region: z.string() }),
  async execute() {
    return {
      returnedRows: 1,
      gisData: {
        type: "aircraft",
        entities: [{ id: "ac-1", coordinates: [120, 24] }],
      },
      operations: [{ type: "flyTo", target: "taiwan-strait" }],
    };
  },
});

const decisions = [
  {
    type: "tool_calls",
    content: "查询航空器数据",
    toolCalls: [
      {
        id: "tool-1",
        toolName: "FakeAircraftQuery",
        input: { region: "taiwan-strait" },
        reason: "需要查询指定区域飞机",
      },
    ],
  },
  {
    type: "final_answer",
    content: "查询完成。",
  },
];

const modelClient = {
  async decide() {
    const next = decisions.shift();
    if (!next) throw new Error("unexpected extra model call");
    return next;
  },
};

const adapter = createLegacySseAdapter({
  taskId,
  query,
  emit: (event) => legacyEvents.push(event),
});

await db.insert(tasks).values({ id: taskId, query, status: "running" });

try {
  const result = await runAgentLoop({
    taskId,
    query,
    registry,
    modelClient,
    maxTurns: 3,
    onEvent: (event) => {
      rawEvents.push(event);
      adapter.handle(event);
    },
  });

  assert.equal(result.finalAnswer, "查询完成。");
  assert(rawEvents.some((event) => event.type === "tool_call"));
  assert(rawEvents.some((event) => event.type === "tool_observation"));
  assert(legacyEvents.some((event) => event.type === "planning_done"));
  assert(legacyEvents.some((event) => event.type === "routing_done"));

  const completedStep = legacyEvents.find(
    (event) => event.type === "step_update" && event.status === "completed",
  );
  assert(completedStep);
  assert.equal(completedStep.actionId, "tool-1");
  assert.equal(completedStep.actionType, "FakeAircraftQuery");
  assert.equal(completedStep.gisData.type, "aircraft");
  assert.deepEqual(completedStep.operations, [{ type: "flyTo", target: "taiwan-strait" }]);
} finally {
  await db.delete(tasks).where(eq(tasks.id, taskId));
}

process.exit(0);
