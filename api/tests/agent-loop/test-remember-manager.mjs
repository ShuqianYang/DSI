import assert from "node:assert/strict";

const { createRememberManager } = await import(
  "../../src/modules/agent-loop/rememberManager.ts"
);

const currentTaskId = "00000000-0000-0000-0000-0000000000a1";
const currentUserId = "user-test-1";

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

function createMockTranscriptStore(entries = []) {
  const appends = [];
  return {
    appends,
    async append(entry) {
      appends.push(entry);
    },
    async load(_taskId) {
      return entries;
    },
  };
}

function createMockRememberInput(overrides = {}) {
  return {
    query: "查询台湾海峡的风场数据",
    finalAnswer: "台湾海峡当前风速 15m/s，风向东北。",
    result: {
      finalAnswer: "台湾海峡当前风速 15m/s，风向东北。",
      turns: 3,
      observations: [],
      stoppedBy: "final_answer",
    },
    messages: [
      { role: "user", content: "查询台湾海峡的风场数据" },
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
        content: JSON.stringify({
          toolCallId: "call-1",
          toolName: "WeatherFetch",
          ok: true,
          windSpeed: 15,
          windDirection: "NE",
        }),
      },
      { role: "assistant", content: "台湾海峡当前风速 15m/s，风向东北。" },
    ],
    observations: [
      {
        toolCallId: "call-1",
        toolName: "WeatherFetch",
        ok: true,
        output: { windSpeed: 15, windDirection: "NE" },
      },
    ],
    toolUseContext: {
      taskId: currentTaskId,
      query: "查询台湾海峡的风场数据",
      messages: [],
      observations: [],
      options: { tools: [] },
      readFileState: new Map(),
      todoState: [],
      nestedMemoryAttachmentTriggers: new Set(),
      dynamicSkillDirTriggers: new Set(),
      discoveredSkillNames: new Set(),
      invokedSkillSections: [],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 1: remember() writes conversation snapshot with correct fields
// ---------------------------------------------------------------------------

{
  const db = createMockDb();
  const transcriptStore = createMockTranscriptStore([
    {
      taskId: currentTaskId,
      turn: 1,
      sequence: 1,
      kind: "loop_stop",
      stoppedBy: "final_answer",
      finalAnswer: "台湾海峡当前风速 15m/s，风向东北。",
    },
  ]);
  const warnings = [];
  const logs = [];
  const manager = createRememberManager({
    db,
    currentTaskId,
    currentUserId,
    transcriptStore,
    logger: {
      warn: (...args) => warnings.push(args),
      log: (...args) => logs.push(args),
    },
  });

  const input = createMockRememberInput();
  await manager.remember(input);

  // Should have 1 insert (snapshot only, no episode without embeddingClient)
  assert.equal(db.inserts.length, 1, "should have 1 db insert (snapshot)");

  const snapshotRow = db.inserts[0].row;
  assert.equal(snapshotRow.taskId, currentTaskId);
  assert.equal(snapshotRow.userId, currentUserId);
  assert.equal(snapshotRow.query, input.query);
  assert.equal(snapshotRow.finalAnswer, input.finalAnswer);
  assert.equal(snapshotRow.turns, 3);
  assert.equal(snapshotRow.stoppedBy, "final_answer");
  assert.equal(snapshotRow.isCheckpoint, false);
  // summary should be null or a string (from summarizeTranscriptForContext)
  assert(
    snapshotRow.summary === null || typeof snapshotRow.summary === "string",
    "summary should be null or string"
  );
  // messages should be a JSONB-serializable value
  assert.ok(snapshotRow.messages, "messages should be set");
  // toolSummary should be an array
  assert.ok(Array.isArray(snapshotRow.toolSummary), "toolSummary should be array");

  console.log("Test 1 passed: remember() writes conversation snapshot correctly");
}

// ---------------------------------------------------------------------------
// Test 2: remember() writes transcript summary entry with preComputedSummary
// ---------------------------------------------------------------------------

{
  const db = createMockDb();
  const transcriptStore = createMockTranscriptStore([
    {
      taskId: currentTaskId,
      turn: 1,
      sequence: 5,
      kind: "loop_stop",
      stoppedBy: "final_answer",
      finalAnswer: "Done.",
    },
  ]);
  const manager = createRememberManager({
    db,
    currentTaskId,
    currentUserId,
    transcriptStore,
  });

  await manager.remember(createMockRememberInput());

  assert.equal(transcriptStore.appends.length, 1, "should append 1 transcript entry");
  const entry = transcriptStore.appends[0];
  assert.equal(entry.taskId, currentTaskId);
  assert.equal(entry.kind, "loop_stop");
  assert.equal(entry.stoppedBy, "final_answer");
  assert.equal(entry.finalAnswer, "台湾海峡当前风速 15m/s，风向东北。");
  assert.equal(entry.metadata.preComputedSummary, true);
  // sequence should be max(existing) + 1 = 5 + 1 = 6
  assert.equal(entry.sequence, 6);

  console.log("Test 2 passed: remember() writes transcript summary entry correctly");
}

// ---------------------------------------------------------------------------
// Test 3: toolSummary correctly extracted from observations + messages
// ---------------------------------------------------------------------------

{
  const db = createMockDb();
  const transcriptStore = createMockTranscriptStore([]);
  const manager = createRememberManager({
    db,
    currentTaskId,
    currentUserId,
    transcriptStore,
  });

  const input = createMockRememberInput({
    observations: [
      {
        toolCallId: "call-1",
        toolName: "WeatherFetch",
        ok: true,
        output: { windSpeed: 15, windDirection: "NE" },
      },
      {
        toolCallId: "call-2",
        toolName: "SatelliteImage",
        ok: false,
        error: { code: "NOT_FOUND", message: "No recent image" },
      },
    ],
    messages: [
      { role: "user", content: "test" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-1",
            toolName: "WeatherFetch",
            input: { region: "Taiwan Strait" },
          },
          {
            id: "call-2",
            toolName: "SatelliteImage",
            input: { lat: 25.0, lon: 121.0 },
          },
        ],
      },
    ],
  });

  await manager.remember(input);

  const snapshotRow = db.inserts[0].row;
  const toolSummary = snapshotRow.toolSummary;
  assert.equal(toolSummary.length, 2, "should have 2 tool summary entries");

  // First tool: WeatherFetch, ok=true
  assert.equal(toolSummary[0].toolName, "WeatherFetch");
  assert.equal(toolSummary[0].ok, true);
  assert.deepEqual(toolSummary[0].inputParams, { region: "Taiwan Strait" });
  assert.ok(toolSummary[0].outputPreview.length > 0, "outputPreview should not be empty");

  // Second tool: SatelliteImage, ok=false
  assert.equal(toolSummary[1].toolName, "SatelliteImage");
  assert.equal(toolSummary[1].ok, false);
  assert.deepEqual(toolSummary[1].inputParams, { lat: 25.0, lon: 121.0 });

  console.log("Test 3 passed: toolSummary extracted correctly from observations + messages");
}

// ---------------------------------------------------------------------------
// Test 4: remember() does not throw on DB errors (best-effort)
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
  const warnings = [];
  const transcriptStore = createMockTranscriptStore([]);
  const manager = createRememberManager({
    db: failingDb,
    currentTaskId,
    currentUserId,
    transcriptStore,
    logger: {
      warn: (...args) => warnings.push(args),
      log: () => {},
    },
  });

  // Should not throw
  await manager.remember(createMockRememberInput());

  // Should have logged a warning about the snapshot write failure
  const snapshotWarning = warnings.find(
    (w) => typeof w[0] === "string" && w[0].includes("snapshot write failed")
  );
  assert.ok(snapshotWarning, "should warn about snapshot write failure");

  console.log("Test 4 passed: remember() does not throw on DB errors");
}

// ---------------------------------------------------------------------------
// Test 5: No userId → safe skip
// ---------------------------------------------------------------------------

{
  const db = createMockDb();
  const transcriptStore = createMockTranscriptStore([]);
  const logs = [];
  const manager = createRememberManager({
    db,
    currentTaskId,
    currentUserId: null,
    transcriptStore,
    logger: {
      warn: () => {},
      log: (...args) => logs.push(args),
    },
  });

  await manager.remember(createMockRememberInput());

  // Should not have any inserts
  assert.equal(db.inserts.length, 0, "should not write snapshot without userId");
  // Should not append transcript
  assert.equal(transcriptStore.appends.length, 0, "should not append transcript without userId");
  // Should log skip reason
  const skipLog = logs.find(
    (l) => typeof l[0] === "string" && l[0].includes("skipped")
  );
  assert.ok(skipLog, "should log skip reason");

  console.log("Test 5 passed: remember() safely skips when no userId");
}

// ---------------------------------------------------------------------------
// Test 6: remember() with empty transcript (sequence starts at 1)
// ---------------------------------------------------------------------------

{
  const db = createMockDb();
  const transcriptStore = createMockTranscriptStore([]); // empty entries
  const manager = createRememberManager({
    db,
    currentTaskId,
    currentUserId,
    transcriptStore,
  });

  await manager.remember(createMockRememberInput());

  const entry = transcriptStore.appends[0];
  assert.equal(entry.sequence, 1, "sequence should start at 1 when no entries exist");

  console.log("Test 6 passed: remember() handles empty transcript correctly");
}

console.log("All remember-manager tests passed");
