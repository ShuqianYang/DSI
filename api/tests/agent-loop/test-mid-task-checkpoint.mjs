import assert from "node:assert/strict";

const { createMidTaskCheckpointWriter } = await import(
  "../../src/modules/agent-loop/midTaskCheckpoint.ts"
);
const { createSessionMemoryTrigger } = await import(
  "../../src/modules/agent-loop/sessionMemoryTrigger.ts"
);

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockDb() {
  const inserts = [];
  return {
    inserts,
    insert(table) {
      return {
        values(row) {
          inserts.push({ table: table?.constructor?.name ?? "table", row });
          return Promise.resolve();
        },
      };
    },
  };
}

function createTestMessages() {
  return [
    { role: "user", content: "查询台湾海峡风场数据" },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call-1",
          toolName: "WeatherFetch",
          input: { region: "Taiwan Strait", dataType: "wind" },
        },
      ],
    },
    {
      role: "tool",
      toolCallId: "call-1",
      toolName: "WeatherFetch",
      content: JSON.stringify({ windSpeed: 15, windDirection: "NE" }),
    },
  ];
}

function createTestObservations() {
  return [
    {
      toolCallId: "call-1",
      toolName: "WeatherFetch",
      ok: true,
      output: { windSpeed: 15, windDirection: "NE" },
    },
  ];
}

// ---------------------------------------------------------------------------
// Test 1: writeCheckpoint writes isCheckpoint=true snapshot
// ---------------------------------------------------------------------------

{
  const db = createMockDb();
  const trigger = createSessionMemoryTrigger();
  const writer = createMidTaskCheckpointWriter({
    db,
    trigger,
    userId: "user-test-1",
  });

  await writer.writeCheckpoint({
    taskId: "task-1",
    userId: "user-test-1",
    query: "查询台湾海峡风场数据",
    messages: createTestMessages(),
    observations: createTestObservations(),
    turn: 3,
  });

  assert.equal(db.inserts.length, 1, "should have 1 insert");
  const row = db.inserts[0].row;
  assert.equal(row.isCheckpoint, true, "isCheckpoint should be true");
  assert.equal(row.taskId, "task-1");
  assert.equal(row.userId, "user-test-1");
  assert.equal(row.query, "查询台湾海峡风场数据");

  console.log("Test 1 passed: writeCheckpoint writes isCheckpoint=true snapshot");
}

// ---------------------------------------------------------------------------
// Test 2: Checkpoint does NOT contain summary or embedding (both null)
// ---------------------------------------------------------------------------

{
  const db = createMockDb();
  const trigger = createSessionMemoryTrigger();
  const writer = createMidTaskCheckpointWriter({
    db,
    trigger,
    userId: "user-test-1",
  });

  await writer.writeCheckpoint({
    taskId: "task-1",
    userId: "user-test-1",
    query: "test",
    messages: createTestMessages(),
    observations: createTestObservations(),
    turn: 2,
  });

  const row = db.inserts[0].row;
  assert.equal(row.summary, null, "summary should be null");
  assert.equal(row.embedding, undefined, "embedding should not be set");

  console.log("Test 2 passed: checkpoint does not contain summary or embedding");
}

// ---------------------------------------------------------------------------
// Test 3: Checkpoint contains correct messages and toolSummary
// ---------------------------------------------------------------------------

{
  const db = createMockDb();
  const trigger = createSessionMemoryTrigger();
  const writer = createMidTaskCheckpointWriter({
    db,
    trigger,
    userId: "user-test-1",
  });

  const messages = createTestMessages();
  const observations = createTestObservations();

  await writer.writeCheckpoint({
    taskId: "task-1",
    userId: "user-test-1",
    query: "test query",
    messages,
    observations,
    turn: 4,
  });

  const row = db.inserts[0].row;
  assert.ok(row.messages, "messages should be set");
  assert.ok(Array.isArray(row.toolSummary), "toolSummary should be an array");
  assert.equal(row.toolSummary.length, 1, "should have 1 tool summary entry");
  assert.equal(row.toolSummary[0].toolName, "WeatherFetch");
  assert.equal(row.toolSummary[0].ok, true);
  assert.deepEqual(row.toolSummary[0].inputParams, {
    region: "Taiwan Strait",
    dataType: "wind",
  });

  console.log("Test 3 passed: checkpoint contains correct messages and toolSummary");
}

// ---------------------------------------------------------------------------
// Test 4: checkpointTurn field correctly records the turn
// ---------------------------------------------------------------------------

{
  const db = createMockDb();
  const trigger = createSessionMemoryTrigger();
  const writer = createMidTaskCheckpointWriter({
    db,
    trigger,
    userId: "user-test-1",
  });

  await writer.writeCheckpoint({
    taskId: "task-1",
    userId: "user-test-1",
    query: "test",
    messages: createTestMessages(),
    observations: createTestObservations(),
    turn: 7,
  });

  const row = db.inserts[0].row;
  assert.equal(row.checkpointTurn, 7, "checkpointTurn should be 7");
  assert.equal(row.turns, 7, "turns should be 7");
  assert.equal(row.stoppedBy, "checkpoint", "stoppedBy should be 'checkpoint'");
  assert.equal(row.finalAnswer, "", "finalAnswer should be empty string");

  console.log("Test 4 passed: checkpointTurn correctly records the turn");
}

// ---------------------------------------------------------------------------
// Test 5: DB error → only warns, does not throw
// ---------------------------------------------------------------------------

{
  const failingDb = {
    insert() {
      return {
        values() {
          return Promise.reject(new Error("DB connection lost"));
        },
      };
    },
  };
  const trigger = createSessionMemoryTrigger();
  const warnings = [];
  const writer = createMidTaskCheckpointWriter({
    db: failingDb,
    trigger,
    userId: "user-test-1",
    logger: {
      warn: (...args) => warnings.push(args),
      log: () => {},
    },
  });

  // Should not throw
  await writer.writeCheckpoint({
    taskId: "task-1",
    userId: "user-test-1",
    query: "test",
    messages: createTestMessages(),
    observations: createTestObservations(),
    turn: 3,
  });

  const checkpointWarning = warnings.find(
    (w) => typeof w[0] === "string" && w[0].includes("checkpoint write failed")
  );
  assert.ok(checkpointWarning, "should warn about checkpoint write failure");

  console.log("Test 5 passed: DB error → only warns, does not throw");
}

// ---------------------------------------------------------------------------
// Test 6: No userId → safe skip, no insert
// ---------------------------------------------------------------------------

{
  const db = createMockDb();
  const trigger = createSessionMemoryTrigger();
  const logs = [];
  const writer = createMidTaskCheckpointWriter({
    db,
    trigger,
    userId: null,
    logger: {
      warn: () => {},
      log: (...args) => logs.push(args),
    },
  });

  await writer.writeCheckpoint({
    taskId: "task-1",
    userId: null,
    query: "test",
    messages: createTestMessages(),
    observations: createTestObservations(),
    turn: 3,
  });

  assert.equal(db.inserts.length, 0, "should not insert without userId");
  const skipLog = logs.find(
    (l) => typeof l[0] === "string" && l[0].includes("skipped")
  );
  assert.ok(skipLog, "should log skip reason");

  console.log("Test 6 passed: no userId → safe skip");
}

// ---------------------------------------------------------------------------
// Test 7: markCheckpoint is called after successful write (resets counters)
// ---------------------------------------------------------------------------

{
  const db = createMockDb();
  const trigger = createSessionMemoryTrigger();
  const writer = createMidTaskCheckpointWriter({
    db,
    trigger,
    userId: "user-test-1",
  });

  // Record some tool calls and tokens before checkpoint
  trigger.updateTokenEstimate(35_000);
  trigger.updateTokenEstimate(41_000);
  trigger.recordToolCalls(5);

  // State before checkpoint
  const stateBefore = trigger.getState();
  assert.ok(stateBefore.tokensSinceLastCheckpoint > 0, "should have token increment before checkpoint");
  assert.ok(stateBefore.toolCallsSinceLastCheckpoint > 0, "should have tool call increment before checkpoint");

  await writer.writeCheckpoint({
    taskId: "task-1",
    userId: "user-test-1",
    query: "test",
    messages: createTestMessages(),
    observations: createTestObservations(),
    turn: 3,
  });

  // State after checkpoint — counters should be reset
  const stateAfter = trigger.getState();
  assert.equal(stateAfter.tokensSinceLastCheckpoint, 0, "tokens should be reset after checkpoint");
  assert.equal(stateAfter.toolCallsSinceLastCheckpoint, 0, "tool calls should be reset after checkpoint");
  assert.equal(stateAfter.checkpointCount, 1, "checkpoint count should be 1");
  assert.equal(stateAfter.lastCheckpointTurn, 3, "last checkpoint turn should be 3");

  console.log("Test 7 passed: markCheckpoint resets counters after successful write");
}

console.log("All mid-task-checkpoint tests passed");
