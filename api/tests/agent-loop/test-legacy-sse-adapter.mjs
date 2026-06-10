import assert from "node:assert/strict";

const {
  createLegacySseAdapter,
  createLegacyStepUpdateFromTaskStep,
  extractLegacyPayload,
} = await import("../../src/modules/tasks/agentLoopEventAdapter.ts");

const taskId = "11111111-1111-1111-1111-111111111111";
const query = "查询台湾海峡附近当前有哪些飞机";

{
  const emitted = [];
  const adapter = createLegacySseAdapter({
    taskId,
    query,
    emit: (event) => emitted.push(event),
  });

  adapter.handle({
    type: "agent_turn",
    taskId,
    turn: 1,
    maxTurns: 10,
    message: "Agent loop turn 1/10",
  });

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].type, "planning_done");
  assert.equal(emitted[0].taskId, taskId);
  assert.equal(emitted[0].plan.goal, query);

  adapter.handle({
    type: "agent_turn",
    taskId,
    turn: 2,
    maxTurns: 10,
    message: "Agent loop turn 2/10",
  });

  assert.equal(emitted.filter((event) => event.type === "planning_done").length, 1);
}

{
  const emitted = [];
  const adapter = createLegacySseAdapter({
    taskId,
    query,
    emit: (event) => emitted.push(event),
  });

  adapter.handle({
    type: "assistant_message",
    taskId,
    turn: 1,
    message: {
      role: "assistant",
      content: "需要查询数据库",
      toolCalls: [
        {
          id: "tool-1",
          toolName: "SqlQuery",
          input: { sql: "select 1" },
          reason: "查询飞机数据",
        },
      ],
    },
  });

  assert.deepEqual(emitted.map((event) => event.type), ["routing", "routing_done"]);
  assert.equal(emitted[1].actions[0].id, "tool-1");
  assert.equal(emitted[1].actions[0].type, "SqlQuery");
  assert.equal(emitted[1].actions[0].description, "查询飞机数据");
}

{
  const emitted = [];
  const adapter = createLegacySseAdapter({
    taskId,
    query,
    emit: (event) => emitted.push(event),
  });

  adapter.handle({
    type: "tool_call",
    taskId,
    turn: 1,
    toolCallId: "tool-1",
    toolName: "SqlQuery",
    reason: "查询飞机数据",
  });

  assert.equal(emitted[0].type, "step_update");
  assert.equal(emitted[0].actionId, "tool-1");
  assert.equal(emitted[0].actionType, "SqlQuery");
  assert.equal(emitted[0].status, "running");
  assert.equal(emitted[0].name, "SqlQuery");
  assert.match(emitted[0].detail, /查询飞机数据/);
}

{
  const emitted = [];
  const adapter = createLegacySseAdapter({
    taskId,
    query,
    emit: (event) => emitted.push(event),
  });

  adapter.handle({
    type: "tool_observation",
    taskId,
    turn: 1,
    toolCallId: "tool-1",
    toolName: "SqlQuery",
    ok: true,
    observation: {
      toolCallId: "tool-1",
      toolName: "SqlQuery",
      ok: true,
      output: {
        returnedRows: 2,
        gisData: { type: "aircraft", entities: [{ id: "ac-1" }] },
        operations: [{ type: "flyTo", target: "taiwan-strait" }],
      },
    },
  });

  assert.equal(emitted[0].type, "step_update");
  assert.equal(emitted[0].status, "completed");
  assert.equal(emitted[0].gisData.type, "aircraft");
  assert.deepEqual(emitted[0].operations, [{ type: "flyTo", target: "taiwan-strait" }]);
  assert.match(emitted[0].detail, /returnedRows/);
}

{
  const emitted = [];
  const adapter = createLegacySseAdapter({
    taskId,
    query,
    emit: (event) => emitted.push(event),
  });

  adapter.handle({
    type: "tool_observation",
    taskId,
    turn: 1,
    toolCallId: "tool-2",
    toolName: "Read",
    ok: false,
    observation: {
      toolCallId: "tool-2",
      toolName: "Read",
      ok: false,
      error: { code: "not_found", message: "file not found" },
    },
  });

  assert.equal(emitted[0].status, "failed");
  assert.match(emitted[0].detail, /file not found/);
}

{
  const payload = extractLegacyPayload({
    observation: {
      output: {
        data: {
          gisData: { type: "region", regions: [{ id: "r1" }] },
        },
        operations: [{ type: "drawRegion" }],
      },
    },
  });

  assert.equal(payload.gisData.type, "region");
  assert.deepEqual(payload.operations, [{ type: "drawRegion" }]);
}

{
  const stepUpdate = createLegacyStepUpdateFromTaskStep({
    id: "step-1",
    actionType: "SqlQuery",
    actionConfig: {
      id: "tool-1",
      name: "SqlQuery",
      reason: "查询数据",
      _order: 3,
    },
    status: "completed",
    result: {
      observation: {
        output: {
          data: {
            gisData: { type: "aircraft", entities: [{ id: "ac-1" }] },
          },
        },
      },
    },
    error: null,
  });

  assert.equal(stepUpdate.type, "step_update");
  assert.equal(stepUpdate.stepIndex, 2);
  assert.equal(stepUpdate.actionId, "tool-1");
  assert.equal(stepUpdate.actionType, "SqlQuery");
  assert.equal(stepUpdate.gisData.type, "aircraft");
}
