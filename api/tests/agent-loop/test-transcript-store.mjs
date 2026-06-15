import assert from "node:assert/strict";

const {
  createBestEffortTranscriptStore,
  createDbTranscriptStore,
  disabledTranscriptStore,
} = await import("../../src/modules/agent-loop/transcriptStore.ts");

{
  const insertedRows = [];
  const db = {
    insert() {
      return {
        async values(row) {
          insertedRows.push(row);
        },
      };
    },
    select() {
      throw new Error("select should not be called by append");
    },
  };
  const store = createDbTranscriptStore(db);
  const circular = { name: "root" };
  circular.self = circular;

  await store.append({
    taskId: "11111111-1111-1111-1111-111111111111",
    turn: 1,
    sequence: 2,
    kind: "assistant_message",
    message: {
      role: "assistant",
      content: "hello",
      toolCalls: [
        {
          id: "call-1",
          toolName: "Demo",
          input: {
            circular,
            fn: function demo() {},
            symbol: Symbol.for("agent-transcript"),
          },
        },
      ],
    },
    metadata: {
      value: undefined,
      big: 12n,
    },
    createdAt: new Date("2026-06-12T00:00:00.000Z"),
  });

  assert.equal(insertedRows.length, 1);
  assert.equal(insertedRows[0].taskId, "11111111-1111-1111-1111-111111111111");
  assert.equal(insertedRows[0].kind, "assistant_message");
  assert.equal(insertedRows[0].message.toolCalls[0].input.circular.self, "[Circular]");
  assert.equal(insertedRows[0].message.toolCalls[0].input.fn, "[Function demo]");
  assert.equal(insertedRows[0].message.toolCalls[0].input.symbol, "Symbol(agent-transcript)");
  assert.equal(insertedRows[0].metadata.big, "12n");
  assert.equal(Object.hasOwn(insertedRows[0].metadata, "value"), false);
}

{
  const rows = [
    {
      taskId: "task-1",
      turn: 2,
      sequence: 2,
      kind: "loop_stop",
      message: null,
      messages: null,
      finalAnswer: "done",
      error: null,
      stoppedBy: "final_answer",
      metadata: {},
      createdAt: new Date("2026-06-12T00:00:02.000Z"),
    },
    {
      taskId: "task-1",
      turn: 1,
      sequence: 1,
      kind: "model_request",
      message: null,
      messages: [{ role: "user", content: "hi" }],
      finalAnswer: null,
      error: null,
      stoppedBy: null,
      metadata: { promptVersion: "v1" },
      createdAt: new Date("2026-06-12T00:00:01.000Z"),
    },
  ];
  const db = {
    insert() {
      throw new Error("insert should not be called by load");
    },
    select() {
      return {
        from() {
          return {
            where() {
              return {
                async orderBy() {
                  return rows;
                },
              };
            },
          };
        },
      };
    },
  };
  const store = createDbTranscriptStore(db);
  const loaded = await store.load("task-1");

  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].kind, "loop_stop");
  assert.equal(loaded[0].message, undefined);
  assert.equal(loaded[0].messages, undefined);
  assert.equal(loaded[0].finalAnswer, "done");
  assert.equal(loaded[0].stoppedBy, "final_answer");
  assert.deepEqual(loaded[1].messages, [{ role: "user", content: "hi" }]);
  assert.deepEqual(loaded[1].metadata, { promptVersion: "v1" });
}

assert.deepEqual(await disabledTranscriptStore.load("missing-task"), []);

{
  const warnings = [];
  const store = createBestEffortTranscriptStore(
    {
      async append() {
        throw new Error("database temporarily unavailable");
      },
      async load(taskId) {
        return [{ taskId, turn: 1, sequence: 1, kind: "loop_stop" }];
      },
    },
    {
      warn(...args) {
        warnings.push(args);
      },
    }
  );

  await store.append({
    taskId: "task-2",
    turn: 1,
    sequence: 1,
    kind: "model_request",
    messages: [{ role: "user", content: "hi" }],
  });

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], "[AgentTranscript] append failed:");
  assert.equal(warnings[0][1], "database temporarily unavailable");
  assert.deepEqual(await store.load("task-2"), [
    { taskId: "task-2", turn: 1, sequence: 1, kind: "loop_stop" },
  ]);
}

console.log("transcript store test passed");
