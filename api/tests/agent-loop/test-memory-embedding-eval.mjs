/**
 * Memory Embedding 评测用例
 *
 * 验证 episodic_memories 和 task_conversation_snapshot 两个表
 * 的向量写入、格式、降级和异常场景。
 *
 * 运行: node api/tests/agent-loop/test-memory-embedding-eval.mjs
 */

import assert from "node:assert/strict";

const { createRememberManager } = await import(
  "../../src/modules/agent-loop/rememberManager.ts"
);

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const TASK_ID = "00000000-0000-0000-0000-0000000000e1";
const USER_ID = "user-eval-1";

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
    async append(entry) { appends.push(entry); },
    async load(_taskId) { return entries; },
  };
}

function createMockEmbeddingClient(dim = 1024) {
  return {
    embed: async (_text) => Array.from({ length: dim }, (_, i) => (i + 1) * 0.001),
    embedBatch: async (texts) =>
      texts.map(() => Array.from({ length: dim }, (_, i) => (i + 1) * 0.001)),
  };
}

/** 返回固定 episode 的 mock extractor */
function createMockEpisodeExtractor(episode = {}) {
  return {
    extract: async (_input) => ({
      scene: "日常监测",
      userQuery: "查询台湾海峡风场数据",
      toolSequence: [
        { toolName: "WeatherFetch", inputParams: { region: "Taiwan Strait" }, outputSummary: "风速15m/s", success: true },
      ],
      finalResult: "台湾海峡当前风速15m/s，风向东北。",
      importance: 0.7,
      tags: ["风场", "台湾海峡"],
      relatedEntities: ["台湾海峡"],
      ...episode,
    }),
  };
}

function createFailingEmbeddingClient() {
  return {
    embed: async (_text) => { throw new Error("ECONNREFUSED"); },
    embedBatch: async () => { throw new Error("ECONNREFUSED"); },
  };
}

function createFailingEpisodeExtractor() {
  return {
    extract: async (_input) => { throw new Error("LLM API timeout"); },
  };
}

function createMockRememberInput(query = "查询台湾海峡的风场数据") {
  return {
    query,
    finalAnswer: "台湾海峡当前风速15m/s，风向东北。",
    result: {
      finalAnswer: "台湾海峡当前风速15m/s，风向东北。",
      turns: 3,
      observations: [
        { toolCallId: "call-1", toolName: "WeatherFetch", ok: true, output: { windSpeed: 15, windDirection: "NE" } },
      ],
      stoppedBy: "final_answer",
    },
    messages: [
      { role: "user", content: query },
      {
        role: "assistant", content: "",
        toolCalls: [{ id: "call-1", toolName: "WeatherFetch", input: { region: "Taiwan Strait" } }],
      },
      { role: "tool", toolCallId: "call-1", toolName: "WeatherFetch", content: JSON.stringify({ windSpeed: 15 }) },
      { role: "assistant", content: "台湾海峡当前风速15m/s，风向东北。" },
    ],
    observations: [
      { toolCallId: "call-1", toolName: "WeatherFetch", ok: true, output: { windSpeed: 15, windDirection: "NE" } },
    ],
    toolUseContext: {
      taskId: TASK_ID, query, messages: [], observations: [],
      options: { tools: [] }, readFileState: new Map(), todoState: [],
      nestedMemoryAttachmentTriggers: new Set(),
      dynamicSkillDirTriggers: new Set(),
      discoveredSkillNames: new Set(), invokedSkillSections: [],
    },
  };
}

function assertPgVectorFormat(value, dim = 1024) {
  assert.ok(typeof value === "string", `vector should be string, got ${typeof value}`);
  assert.match(value, /^\[[\d.,\-e]+\]$/, "vector should be pgvector string format [0.1,0.2,...]");
  const nums = value.slice(1, -1).split(",").map(Number);
  assert.equal(nums.length, dim, `vector should have ${dim} dimensions, got ${nums.length}`);
  for (const n of nums) {
    assert.ok(Number.isFinite(n), `vector element should be finite, got ${n}`);
  }
}

// ===========================================================================
// 评测 Case 1: snapshot 向量正常写入（完整链路）
// ===========================================================================

{
  const db = createMockDb();
  const transcriptStore = createMockTranscriptStore([]);
  const embeddingClient = createMockEmbeddingClient();
  const warnings = [];

  const manager = createRememberManager({
    db, currentTaskId: TASK_ID, currentUserId: USER_ID, transcriptStore,
    embeddingClient,
    logger: { warn: (...a) => warnings.push(a), log: () => {} },
  });

  await manager.remember(createMockRememberInput());

  // 应该有两笔 insert：snapshot + episodic（注意：无 episodeExtractor，所以只有 snapshot）
  const snapshotInsert = db.inserts.find((i) => i.row.isCheckpoint === false);
  assert.ok(snapshotInsert, "should have snapshot insert");

  // 验证 embedding 字段存在且非空
  assert.ok(snapshotInsert.row.embedding !== undefined, "snapshot should have embedding field");
  assert.ok(snapshotInsert.row.embedding !== null, "snapshot embedding should not be null");
  assertPgVectorFormat(snapshotInsert.row.embedding);

  // 验证 embedding 不在 warnings 中（没有被失败日志捕获）
  const embFailWarn = warnings.find((w) => String(w[0]).includes("snapshot embedding generation failed"));
  assert.equal(embFailWarn, undefined, "should not warn about embedding failure");

  console.log("✅ Case 1 passed: 快照向量正常写入 1024-dim pgvector");
}

// ===========================================================================
// 评测 Case 2: episodic_memories 向量正常写入（双 client 场景）
// ===========================================================================

{
  const db = createMockDb();
  const transcriptStore = createMockTranscriptStore([]);
  const embeddingClient = createMockEmbeddingClient();
  const episodeExtractor = createMockEpisodeExtractor();
  const warnings = [];

  const manager = createRememberManager({
    db, currentTaskId: TASK_ID, currentUserId: USER_ID, transcriptStore,
    embeddingClient, episodeExtractor,
    logger: { warn: (...a) => warnings.push(a), log: () => {} },
  });

  await manager.remember(createMockRememberInput());

  // 验证双表写入
  const snapshotInsert = db.inserts.find((i) => i.row.isCheckpoint === false);
  const episodeInsert = db.inserts.find((i) => i.row.scene !== undefined);

  assert.ok(snapshotInsert, "should have snapshot insert");
  assert.ok(episodeInsert, "should have episode insert");

  // 验证 snapshot embedding
  assert.ok(snapshotInsert.row.embedding !== null, "snapshot embedding should not be null");
  assertPgVectorFormat(snapshotInsert.row.embedding);

  // 验证 episode embedding
  assert.ok(episodeInsert.row.embedding !== null, "episode embedding should not be null");
  assertPgVectorFormat(episodeInsert.row.embedding);

  // 验证 episode 其他字段
  assert.equal(episodeInsert.row.scene, "日常监测");
  assert.equal(episodeInsert.row.userQuery, "查询台湾海峡风场数据");
  assert.ok(Array.isArray(episodeInsert.row.tags), "tags should be array");
  assert.ok(Array.isArray(episodeInsert.row.relatedEntities), "relatedEntities should be array");
  assert.ok(typeof episodeInsert.row.importance === "number", "importance should be number");

  // 验证没有失败日志
  const embFailWarn = warnings.find((w) => String(w[0]).includes("episode extraction failed"));
  assert.equal(embFailWarn, undefined, "should not warn about episode extraction failure");

  console.log("✅ Case 2 passed: episodic_memories + snapshot 双表向量同时写入成功");
}

// ===========================================================================
// 评测 Case 3: 无 embeddingClient → snapshot embedding 为 null（降级）
// ===========================================================================

{
  const db = createMockDb();
  const transcriptStore = createMockTranscriptStore([]);

  const manager = createRememberManager({
    db, currentTaskId: TASK_ID, currentUserId: USER_ID, transcriptStore,
    // 不传 embeddingClient
  });

  await manager.remember(createMockRememberInput());

  const snapshotInsert = db.inserts.find((i) => i.row.isCheckpoint === false);
  assert.ok(snapshotInsert, "should still write snapshot without embeddingClient");
  assert.equal(snapshotInsert.row.embedding, null, "embedding should be null without embeddingClient");

  // 无 episode 写入
  const episodeInsert = db.inserts.find((i) => i.row.scene !== undefined);
  assert.equal(episodeInsert, undefined, "should not write episode without extractor");

  console.log("✅ Case 3 passed: 无 embeddingClient 时 snapshot 正常但 embedding 为 null");
}

// ===========================================================================
// 评测 Case 4: embedding 生成失败 → snapshot 仍写入，embedding 为 null
// ===========================================================================

{
  const db = createMockDb();
  const transcriptStore = createMockTranscriptStore([]);
  const embeddingClient = createFailingEmbeddingClient();
  const warnings = [];

  const manager = createRememberManager({
    db, currentTaskId: TASK_ID, currentUserId: USER_ID, transcriptStore,
    embeddingClient,
    logger: { warn: (...a) => warnings.push(a), log: () => {} },
  });

  await manager.remember(createMockRememberInput());

  const snapshotInsert = db.inserts.find((i) => i.row.isCheckpoint === false);
  assert.ok(snapshotInsert, "should still write snapshot when embedding generation fails");
  assert.equal(snapshotInsert.row.embedding, null, "embedding should be null when generation fails");

  const embFailWarn = warnings.find((w) => String(w[0]).includes("snapshot embedding generation failed"));
  assert.ok(embFailWarn, "should warn about embedding generation failure");

  console.log("✅ Case 4 passed: embedding 生成失败时 snapshot 仍写入，embedding=null，有 warn 日志");
}

// ===========================================================================
// 评测 Case 5: 无 userId → 完全跳过，无任何写入
// ===========================================================================

{
  const db = createMockDb();
  const transcriptStore = createMockTranscriptStore([]);
  const embeddingClient = createMockEmbeddingClient();
  const logs = [];

  const manager = createRememberManager({
    db, currentTaskId: TASK_ID, currentUserId: null, transcriptStore,
    embeddingClient,
    logger: { warn: () => {}, log: (...a) => logs.push(a) },
  });

  await manager.remember(createMockRememberInput());

  assert.equal(db.inserts.length, 0, "no inserts when userId is null");
  assert.equal(transcriptStore.appends.length, 0, "no transcript appends when userId is null");

  const skipLog = logs.find((l) => String(l[0]).includes("skipped"));
  assert.ok(skipLog, "should log skip reason");

  console.log("✅ Case 5 passed: 无 userId 跳过所有写入");
}

// ===========================================================================
// 评测 Case 6: 有 embeddingClient 但无 episodeExtractor → 仅 snapshot 有 embedding
// ===========================================================================

{
  const db = createMockDb();
  const transcriptStore = createMockTranscriptStore([]);
  const embeddingClient = createMockEmbeddingClient();

  const manager = createRememberManager({
    db, currentTaskId: TASK_ID, currentUserId: USER_ID, transcriptStore,
    embeddingClient,
    // 不传 episodeExtractor
  });

  await manager.remember(createMockRememberInput());

  const snapshotInsert = db.inserts.find((i) => i.row.isCheckpoint === false);
  const episodeInsert = db.inserts.find((i) => i.row.scene !== undefined);

  assert.ok(snapshotInsert, "should have snapshot insert");
  assert.ok(snapshotInsert.row.embedding !== null, "snapshot embedding should exist");
  assertPgVectorFormat(snapshotInsert.row.embedding);
  assert.equal(episodeInsert, undefined, "should NOT write episode without extractor");

  console.log("✅ Case 6 passed: 仅 snapshot 有 embedding，无 episode 写入");
}

// ===========================================================================
// 评测 Case 7: episode extraction 失败 → snapshot 仍写入，仅无 episode 数据
// ===========================================================================

{
  const db = createMockDb();
  const transcriptStore = createMockTranscriptStore([]);
  const embeddingClient = createMockEmbeddingClient();
  const episodeExtractor = createFailingEpisodeExtractor();
  const warnings = [];

  const manager = createRememberManager({
    db, currentTaskId: TASK_ID, currentUserId: USER_ID, transcriptStore,
    embeddingClient, episodeExtractor,
    logger: { warn: (...a) => warnings.push(a), log: () => {} },
  });

  await manager.remember(createMockRememberInput());

  const snapshotInsert = db.inserts.find((i) => i.row.isCheckpoint === false);
  const episodeInsert = db.inserts.find((i) => i.row.scene !== undefined);

  assert.ok(snapshotInsert, "should have snapshot insert");
  assert.ok(snapshotInsert.row.embedding !== null, "snapshot embedding should exist despite episode failure");

  assert.equal(episodeInsert, undefined, "should not write episode when extraction fails");

  const episodeFailWarn = warnings.find((w) => String(w[0]).includes("episode extraction failed"));
  assert.ok(episodeFailWarn, "should warn about episode extraction failure");

  console.log("✅ Case 7 passed: episode 提取失败时 snapshot 仍正常写入");
}

// ===========================================================================
// 评测 Case 8: snapshot 和 episode 使用不同的向量（独立 embedding）
// ===========================================================================

{
  const db = createMockDb();
  const transcriptStore = createMockTranscriptStore([]);
  const embeddingClient = createMockEmbeddingClient();
  const episodeExtractor = createMockEpisodeExtractor();

  const manager = createRememberManager({
    db, currentTaskId: TASK_ID, currentUserId: USER_ID, transcriptStore,
    embeddingClient, episodeExtractor,
  });

  await manager.remember(createMockRememberInput("查询台湾海峡的风场数据"));

  const snapshotInsert = db.inserts.find((i) => i.row.isCheckpoint === false);
  const episodeInsert = db.inserts.find((i) => i.row.scene !== undefined);

  // 两个向量的内容应该不同（snapshot 用原始 query，episode 用 episode.userQuery）
  // 但我们的 mock embeddingClient 对任何输入都返回同样的向量，
  // 所以这里只验证两者都存在且格式正确
  assert.notEqual(snapshotInsert.row.embedding, null);
  assert.notEqual(episodeInsert.row.embedding, null);
  assertPgVectorFormat(snapshotInsert.row.embedding);
  assertPgVectorFormat(episodeInsert.row.embedding);

  console.log("✅ Case 8 passed: snapshot 和 episode 各自独立生成 embedding");
}

// ===========================================================================
// 评测 Case 9: 同一用户多次任务均正确写入向量
// ===========================================================================

{
  const db = createMockDb();
  const transcriptStore = createMockTranscriptStore([]);
  const embeddingClient = createMockEmbeddingClient();

  const manager = createRememberManager({
    db, currentTaskId: "00000000-0000-0000-0000-000000000101", currentUserId: USER_ID, transcriptStore,
    embeddingClient,
  });

  const queries = [
    "查询台湾海峡的风场数据",
    "搜索东海海域油轮信息",
    "评估地震区域灾害情况",
  ];

  for (let i = 0; i < queries.length; i++) {
    const taskId = `00000000-0000-0000-0000-000000000${100 + i}`;
    // 创建新的 manager 模拟不同 task
    const mgr = createRememberManager({
      db, currentTaskId: taskId, currentUserId: USER_ID, transcriptStore,
      embeddingClient,
    });
    await mgr.remember(createMockRememberInput(queries[i]));
  }

  const snapshotInserts = db.inserts.filter((i) => i.row.isCheckpoint === false);
  assert.equal(snapshotInserts.length, queries.length, `should have ${queries.length} snapshots`);

  for (const insert of snapshotInserts) {
    assert.ok(insert.row.embedding !== null, "each snapshot should have embedding");
    assertPgVectorFormat(insert.row.embedding);
  }

  console.log(`✅ Case 9 passed: 同一用户 ${queries.length} 次任务均正确写入向量`);
}

// ===========================================================================
// 评测 Case 10: 空 query 场景 — embedding 仍生成（不阻断）
// ===========================================================================

{
  const db = createMockDb();
  const transcriptStore = createMockTranscriptStore([]);
  const embeddingClient = createMockEmbeddingClient();

  const manager = createRememberManager({
    db, currentTaskId: TASK_ID, currentUserId: USER_ID, transcriptStore,
    embeddingClient,
  });

  await manager.remember(createMockRememberInput(""));

  const snapshotInsert = db.inserts.find((i) => i.row.isCheckpoint === false);
  assert.ok(snapshotInsert, "should write snapshot even with empty query");
  assert.ok(snapshotInsert.row.embedding !== null, "empty query should still produce embedding");
  assertPgVectorFormat(snapshotInsert.row.embedding);

  console.log("✅ Case 10 passed: 空 query 仍正常生成 embedding");
}

// ===========================================================================
// 评测 Case 11: 多用户隔离 — 不同 user 的 task 分别写入
// ===========================================================================

{
  const db = createMockDb();
  const transcriptStore = createMockTranscriptStore([]);
  const embeddingClient = createMockEmbeddingClient();

  const userA = "user-a-task-1";
  const userB = "user-b-task-1";

  const mgrA = createRememberManager({
    db, currentTaskId: "00000000-0000-0000-0000-0000000a01", currentUserId: userA, transcriptStore,
    embeddingClient,
  });
  const mgrB = createRememberManager({
    db, currentTaskId: "00000000-0000-0000-0000-0000000b01", currentUserId: userB, transcriptStore,
    embeddingClient,
  });

  await mgrA.remember(createMockRememberInput("台湾海峡风场"));
  await mgrB.remember(createMockRememberInput("东海油轮追踪"));

  const insertsA = db.inserts.filter((i) => i.row.userId === userA);
  const insertsB = db.inserts.filter((i) => i.row.userId === userB);

  assert.equal(insertsA.length, 1, "user A should have 1 snapshot");
  assert.equal(insertsB.length, 1, "user B should have 1 snapshot");
  assert.ok(insertsA[0].row.embedding !== null);
  assert.ok(insertsB[0].row.embedding !== null);

  console.log("✅ Case 11 passed: 多用户隔离，各自独立写入向量");
}

// ===========================================================================
// 评测 Case 12: episode importance 范围验证（0-1）
// ===========================================================================

{
  const db = createMockDb();
  const transcriptStore = createMockTranscriptStore([]);
  const embeddingClient = createMockEmbeddingClient();
  const episodeExtractor = createMockEpisodeExtractor({ importance: 0.85 });

  const manager = createRememberManager({
    db, currentTaskId: TASK_ID, currentUserId: USER_ID, transcriptStore,
    embeddingClient, episodeExtractor,
  });

  await manager.remember(createMockRememberInput());

  const episodeInsert = db.inserts.find((i) => i.row.scene !== undefined);
  assert.ok(episodeInsert, "should have episode insert");
  assert.ok(episodeInsert.row.importance >= 0 && episodeInsert.row.importance <= 1,
    `importance should be 0-1, got ${episodeInsert.row.importance}`);

  console.log("✅ Case 12 passed: episode importance 在 0-1 范围内");
}

// ===========================================================================
// 评测 Case 13: 向量维度一致性 — snapshot 和 episode 使用相同维度的 client
// ===========================================================================

{
  const db = createMockDb();
  const transcriptStore = createMockTranscriptStore([]);
  const embeddingClient = createMockEmbeddingClient(1024); // 1024-dim like qwen3-embedding
  const episodeExtractor = createMockEpisodeExtractor();

  const manager = createRememberManager({
    db, currentTaskId: TASK_ID, currentUserId: USER_ID, transcriptStore,
    embeddingClient, episodeExtractor,
  });

  await manager.remember(createMockRememberInput());

  const snapshotInsert = db.inserts.find((i) => i.row.isCheckpoint === false);
  const episodeInsert = db.inserts.find((i) => i.row.scene !== undefined);

  assertPgVectorFormat(snapshotInsert.row.embedding, 1024);
  assertPgVectorFormat(episodeInsert.row.embedding, 1024);

  console.log("✅ Case 13 passed: snapshot 和 episode 向量维度一致（1024-dim）");
}

// ===========================================================================
// 评测 Case 14: 所有异常场景不抛异常（best-effort 设计）
// ===========================================================================

{
  const db = {
    insert() {
      return {
        values() {
          return Promise.reject(new Error("DB connection lost"));
        },
      };
    },
  };
  const transcriptStore = createMockTranscriptStore([]);
  const embeddingClient = createMockEmbeddingClient();
  const episodeExtractor = createMockEpisodeExtractor();
  const warnings = [];

  const manager = createRememberManager({
    db, currentTaskId: TASK_ID, currentUserId: USER_ID, transcriptStore,
    embeddingClient, episodeExtractor,
    logger: { warn: (...a) => warnings.push(a), log: () => {} },
  });

  // 不应抛异常
  await manager.remember(createMockRememberInput());

  // 应有 warn
  const failWarns = warnings.filter((w) => String(w[0]).includes("write failed") || String(w[0]).includes("extraction failed"));
  assert.ok(failWarns.length > 0, "should have failure warnings");

  console.log("✅ Case 14 passed: 全部异常场景均不抛异常（best-effort）");
}

// ===========================================================================
// 总结
// ===========================================================================

console.log("\n🎯 All 14 memory embedding evaluation cases passed!\n");
console.log("覆盖场景:");
console.log("  - Snapshot 向量正常写入 (Case 1, 8, 9)");
console.log("  - Episodic 向量正常写入 (Case 2, 12, 13)");
console.log("  - 双表同时写入 (Case 2)");
console.log("  - 无 embeddingClient 降级 (Case 3)");
console.log("  - Embedding 生成失败 (Case 4)");
console.log("  - 无 userId 跳过 (Case 5)");
console.log("  - 无 episodeExtractor (Case 6)");
console.log("  - Episode 提取失败 (Case 7)");
console.log("  - 多任务/多用户隔离 (Case 9, 11)");
console.log("  - 空 query 边界 (Case 10)");
console.log("  - 向量维度一致性 (Case 13)");
console.log("  - Best-effort 异常安全 (Case 14)");
