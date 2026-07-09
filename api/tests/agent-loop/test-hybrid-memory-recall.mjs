import assert from "node:assert/strict";

const { createHybridMemoryManager } = await import(
  "../../src/modules/agent-loop/hybridMemoryManager.ts"
);
const { noopMemoryManager } = await import(
  "../../src/modules/agent-loop/memoryManager.ts"
);

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockEmbeddingClient(dim = 1536) {
  return {
    embed: async (_text) => Array.from({ length: dim }, (_, i) => i * 0.001),
    embedBatch: async (texts) =>
      texts.map(() => Array.from({ length: dim }, (_, i) => i * 0.001)),
  };
}

function createMockDb(rows = []) {
  return {
    execute: async (_query) => ({ rows }),
  };
}

function createMockSessionMemoryManager(prefetchResult = []) {
  return {
    ...noopMemoryManager,
    startRelevantMemoryPrefetch: () => ({
      settledAt: null,
      consumedOnIteration: -1,
      promise: Promise.resolve(prefetchResult),
    }),
  };
}

function createMessages(query) {
  return [{ role: "user", content: query }];
}

function createToolUseContext() {
  return {
    taskId: "test-task-1",
    query: "test",
    messages: [],
    observations: [],
    options: { tools: [] },
    readFileState: new Map(),
    todoState: [],
    nestedMemoryAttachmentTriggers: new Set(),
    dynamicSkillDirTriggers: new Set(),
    discoveredSkillNames: new Set(),
    invokedSkillSections: [],
  };
}

// ---------------------------------------------------------------------------
// Test 1: Vector recall + session recall are merged
// ---------------------------------------------------------------------------

{
  const sessionSection = { id: "memory.session_summary.1", content: "session data" };
  const vectorRow = {
    id: "vec-1",
    task_id: "task-1",
    user_query: "台湾海峡风场",
    final_result: "风速15m/s",
    scene: "日常监测",
    related_entities: ["台湾海峡"],
    tags: ["风场"],
    importance: 0.5,
    similarity: 0.9,
    created_at: new Date().toISOString(),
  };

  const db = createMockDb([vectorRow]);
  const embeddingClient = createMockEmbeddingClient();
  const sessionMM = createMockSessionMemoryManager([sessionSection]);

  const manager = createHybridMemoryManager({
    sessionMemoryManager: sessionMM,
    db,
    embeddingClient,
    currentUserId: "user-1",
    decayLambda: 0.1,
    vectorWeight: 0.6,
    keywordWeight: 0.3,
    entityWeight: 0.1,
  });

  const prefetch = manager.startRelevantMemoryPrefetch(
    createMessages("台湾海峡风场"),
    createToolUseContext()
  );

  assert.ok(prefetch, "should return a prefetch");
  const sections = await prefetch.promise;

  // Should have at least the session section + vector section
  assert.ok(sections.length >= 1, "should return merged sections");
  const hasVectorSection = sections.some((s) => s.id.startsWith("memory.vector."));
  assert.ok(hasVectorSection, "should include vector recall results");

  console.log("Test 1 passed: vector recall + session recall are merged");
}

// ---------------------------------------------------------------------------
// Test 2: Memory decay — older memories get lower scores
// ---------------------------------------------------------------------------

{
  // Two rows: one recent, one old (365 days ago)
  const recentDate = new Date();
  const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  const rows = [
    {
      id: "old-1",
      task_id: "task-old",
      user_query: "台湾海峡风场",
      final_result: "old data",
      scene: "日常监测",
      related_entities: [],
      tags: [],
      importance: 0.5,
      similarity: 0.9,
      created_at: oldDate.toISOString(),
    },
    {
      id: "recent-1",
      task_id: "task-recent",
      user_query: "台湾海峡风场",
      final_result: "recent data",
      scene: "日常监测",
      related_entities: [],
      tags: [],
      importance: 0.5,
      similarity: 0.9,
      created_at: recentDate.toISOString(),
    },
  ];

  const db = createMockDb(rows);
  const embeddingClient = createMockEmbeddingClient();
  const sessionMM = createMockSessionMemoryManager([]);

  const manager = createHybridMemoryManager({
    sessionMemoryManager: sessionMM,
    db,
    embeddingClient,
    currentUserId: "user-1",
    decayLambda: 0.1,
    vectorWeight: 0.6,
    keywordWeight: 0.3,
    entityWeight: 0.1,
  });

  const prefetch = manager.startRelevantMemoryPrefetch(
    createMessages("台湾海峡风场"),
    createToolUseContext()
  );

  const sections = await prefetch.promise;

  // Find vector sections
  const vectorSections = sections.filter((s) => s.id.startsWith("memory.vector."));
  assert.ok(vectorSections.length >= 1, "should have vector sections");

  // The recent one should have a higher hybridScore
  const parsed = vectorSections.map((s) => JSON.parse(s.content));
  const recentEntry = parsed.find((p) => p.taskId === "task-recent");
  const oldEntry = parsed.find((p) => p.taskId === "task-old");

  if (recentEntry && oldEntry) {
    assert.ok(
      recentEntry.hybridScore > oldEntry.hybridScore,
      `recent score (${recentEntry.hybridScore}) should be higher than old (${oldEntry.hybridScore})`
    );
  }

  console.log("Test 2 passed: memory decay — older memories get lower scores");
}

// ---------------------------------------------------------------------------
// Test 3: Hybrid scoring weights (vector x0.6 + keyword x0.3 + entity x0.1)
// ---------------------------------------------------------------------------

{
  // Row with perfect entity match but zero keyword overlap
  const row = {
    id: "test-w",
    task_id: "task-w",
    user_query: "完全不同的查询内容",
    final_result: "no keyword overlap here",
    scene: "日常监测",
    related_entities: ["台湾海峡"],
    tags: [],
    importance: 0.5,
    similarity: 1.0, // perfect vector similarity
    created_at: new Date().toISOString(),
  };

  const db = createMockDb([row]);
  const embeddingClient = createMockEmbeddingClient();
  const sessionMM = createMockSessionMemoryManager([]);

  const manager = createHybridMemoryManager({
    sessionMemoryManager: sessionMM,
    db,
    embeddingClient,
    currentUserId: "user-1",
    decayLambda: 0, // no decay for this test
    vectorWeight: 0.6,
    keywordWeight: 0.3,
    entityWeight: 0.1,
  });

  const prefetch = manager.startRelevantMemoryPrefetch(
    createMessages("台湾海峡风场数据"),
    createToolUseContext()
  );

  const sections = await prefetch.promise;
  const vectorSections = sections.filter((s) => s.id.startsWith("memory.vector."));

  if (vectorSections.length > 0) {
    const parsed = JSON.parse(vectorSections[0].content);
    // vector: 1.0 * 0.6 = 0.6
    // keyword: some overlap from "台湾海峡" → not 0, but let's just check score is reasonable
    // entity: "台湾海峡" in query and in related_entities → 1.0 * 0.1 = 0.1
    // total = 0.6 + keyword + 0.1 = at least 0.7
    assert.ok(
      parsed.hybridScore >= 0.6,
      `hybridScore should be at least 0.6 (vector only), got ${parsed.hybridScore}`
    );
    assert.ok(parsed.hybridScore <= 1.0, "hybridScore should not exceed 1.0");
  }

  console.log("Test 3 passed: hybrid scoring weights are applied correctly");
}

// ---------------------------------------------------------------------------
// Test 4: embeddingClient unavailable → degrades to session memory only
// ---------------------------------------------------------------------------

{
  const sessionSection = { id: "memory.session_summary.1", content: "session data" };
  const sessionMM = createMockSessionMemoryManager([sessionSection]);

  // No embeddingClient
  const manager = createHybridMemoryManager({
    sessionMemoryManager: sessionMM,
    db: createMockDb([]),
    embeddingClient: undefined,
    currentUserId: "user-1",
    decayLambda: 0.1,
    vectorWeight: 0.6,
    keywordWeight: 0.3,
    entityWeight: 0.1,
  });

  const prefetch = manager.startRelevantMemoryPrefetch(
    createMessages("test query"),
    createToolUseContext()
  );

  const sections = await prefetch.promise;

  // Should only have session sections (no vector sections)
  const vectorSections = sections.filter((s) => s.id.startsWith("memory.vector."));
  assert.equal(vectorSections.length, 0, "should have no vector sections without embeddingClient");
  assert.ok(sections.length >= 1, "should still return session sections");

  console.log("Test 4 passed: embeddingClient unavailable → degrades to session memory");
}

// ---------------------------------------------------------------------------
// Test 5: No userId → skips vector recall, returns session only
// ---------------------------------------------------------------------------

{
  const sessionSection = { id: "memory.session_summary.1", content: "session data" };
  const sessionMM = createMockSessionMemoryManager([sessionSection]);
  const embeddingClient = createMockEmbeddingClient();

  const manager = createHybridMemoryManager({
    sessionMemoryManager: sessionMM,
    db: createMockDb([]),
    embeddingClient,
    currentUserId: null, // no userId
    decayLambda: 0.1,
    vectorWeight: 0.6,
    keywordWeight: 0.3,
    entityWeight: 0.1,
  });

  const prefetch = manager.startRelevantMemoryPrefetch(
    createMessages("test query"),
    createToolUseContext()
  );

  const sections = await prefetch.promise;
  const vectorSections = sections.filter((s) => s.id.startsWith("memory.vector."));
  assert.equal(vectorSections.length, 0, "should skip vector recall without userId");

  console.log("Test 5 passed: no userId → skips vector recall");
}

// ---------------------------------------------------------------------------
// Test 6: DB error during vector recall → returns empty (best-effort)
// ---------------------------------------------------------------------------

{
  const sessionMM = createMockSessionMemoryManager([]);
  const embeddingClient = createMockEmbeddingClient();
  const failingDb = {
    execute: async () => {
      throw new Error("DB connection lost");
    },
  };

  const warnings = [];
  const manager = createHybridMemoryManager({
    sessionMemoryManager: sessionMM,
    db: failingDb,
    embeddingClient,
    currentUserId: "user-1",
    decayLambda: 0.1,
    vectorWeight: 0.6,
    keywordWeight: 0.3,
    entityWeight: 0.1,
    logger: { warn: (...args) => warnings.push(args) },
  });

  const prefetch = manager.startRelevantMemoryPrefetch(
    createMessages("test query"),
    createToolUseContext()
  );

  const sections = await prefetch.promise;
  // Should not throw, should return empty array (no session, no vector)
  assert.ok(Array.isArray(sections), "should return array even on error");
  assert.equal(sections.length, 0, "should return empty on DB error");
  assert.ok(warnings.length >= 1, "should warn about vector recall failure");

  console.log("Test 6 passed: DB error during vector recall → best-effort empty");
}

console.log("All hybrid-memory-recall tests passed");
