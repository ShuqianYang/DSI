import assert from "node:assert/strict";

const {
  createPipelineMemoryManager,
  parseMemoryIntegerEnv,
} = await import("../../src/modules/tasks/pipelineMemory.ts");

assert.equal(parseMemoryIntegerEnv(undefined), undefined);
assert.equal(parseMemoryIntegerEnv(""), undefined);
assert.equal(parseMemoryIntegerEnv("  "), undefined);
assert.equal(parseMemoryIntegerEnv("5"), 5);
assert.equal(parseMemoryIntegerEnv("abc"), undefined);

const currentTaskId = "00000000-0000-0000-0000-000000000010";
const priorTaskId = "00000000-0000-0000-0000-000000000011";
let listInput;

const transcriptStore = {
  async append() {
    throw new Error("append should not be called");
  },
  async load(taskId) {
    assert.equal(taskId, priorTaskId);
    return [
      {
        taskId,
        turn: 1,
        sequence: 1,
        kind: "loop_stop",
        stoppedBy: "final_answer",
        finalAnswer: "Prior task answer.",
      },
    ];
  },
};

const enabledManager = createPipelineMemoryManager({
  currentTaskId,
  currentTask: { userId: "user-1" },
  env: {
    AGENT_MEMORY_SESSION_SUMMARY: "1",
    AGENT_MEMORY_RECENT_TASK_LIMIT: "abc",
    AGENT_MEMORY_SECTION_MAX_CHARS: "900",
  },
  transcriptStore,
  listRecentCompletedTasks: async (input) => {
    listInput = input;
    return [
      {
        id: priorTaskId,
        userId: "user-1",
        query: "Prior query",
        status: "completed",
        completedAt: new Date("2026-06-15T00:00:00.000Z"),
      },
    ];
  },
});

const enabledPrefetch = enabledManager.startRelevantMemoryPrefetch([], {
  taskId: currentTaskId,
});
assert(enabledPrefetch);
assert.deepEqual(enabledManager.getDiagnostics?.(), {
  enabled: true,
  status: "pending",
  currentUserId: "user-1",
  recalledTaskCount: 0,
  sectionCount: 0,
  skippedReason: null,
  warningCount: 0,
});
const sections = await enabledPrefetch.promise;
assert.deepEqual(enabledManager.getDiagnostics?.(), {
  enabled: true,
  status: "loaded",
  currentUserId: "user-1",
  recalledTaskCount: 1,
  sectionCount: 1,
  skippedReason: null,
  warningCount: 0,
});
assert.deepEqual(listInput, {
  userId: "user-1",
  excludeTaskId: currentTaskId,
  limit: 3,
});
assert.equal(sections.length, 1);
assert.equal(sections[0].id, `memory.session_summary.${priorTaskId}`);
assert(sections[0].content.includes("Prior task answer."));
assert.equal(sections[0].metadata?.memoryRecall?.query, "Prior query");
assert.equal(sections[0].metadata?.memoryRecall?.finalResult, "Prior task answer.");

let vectorEmbedCalls = 0;
let vectorExecuteCalls = 0;
const hybridManager = createPipelineMemoryManager({
  currentTaskId,
  currentTask: { userId: "user-1" },
  env: { AGENT_MEMORY_SESSION_SUMMARY: "1" },
  transcriptStore,
  listRecentCompletedTasks: async () => [],
  db: {
    select() {
      return {
        from() {
          return {
            where() {
              return { orderBy: () => ({ limit: async () => [] }) };
            },
          };
        },
      };
    },
    insert() {
      return { values: async () => undefined };
    },
    async execute() {
      vectorExecuteCalls += 1;
      return { rows: [] };
    },
  },
  embeddingClient: {
    async embed() {
      vectorEmbedCalls += 1;
      return Array.from({ length: 1024 }, () => 0.01);
    },
    async embedBatch(texts) {
      return texts.map(() => Array.from({ length: 1024 }, () => 0.01));
    },
  },
});
const hybridPrefetch = hybridManager.startRelevantMemoryPrefetch(
  [{ role: "user", content: "recall this query" }],
  { taskId: currentTaskId }
);
assert(hybridPrefetch);
await hybridPrefetch.promise;
assert.equal(vectorEmbedCalls, 1, "pipeline manager should invoke vector embedding recall");
assert.equal(vectorExecuteCalls, 2, "pipeline manager should search both memory vector tables");

let disabledListCalled = false;
const disabledManager = createPipelineMemoryManager({
  currentTaskId,
  currentTask: { userId: "user-1" },
  env: { AGENT_MEMORY_SESSION_SUMMARY: "0" },
  transcriptStore,
  listRecentCompletedTasks: async () => {
    disabledListCalled = true;
    return [];
  },
});

assert.equal(disabledManager.startRelevantMemoryPrefetch([], { taskId: currentTaskId }), undefined);
assert.equal(disabledListCalled, false);
assert.deepEqual(disabledManager.getDiagnostics?.(), {
  enabled: false,
  status: "disabled",
  currentUserId: "user-1",
  recalledTaskCount: 0,
  sectionCount: 0,
  skippedReason: "disabled",
  warningCount: 0,
});

const missingUserManager = createPipelineMemoryManager({
  currentTaskId,
  currentTask: null,
  env: { AGENT_MEMORY_SESSION_SUMMARY: "1" },
  transcriptStore,
  listRecentCompletedTasks: async () => {
    throw new Error("should not list recent tasks without user id");
  },
});

assert.equal(missingUserManager.startRelevantMemoryPrefetch([], { taskId: currentTaskId }), undefined);
assert.deepEqual(missingUserManager.getDiagnostics?.(), {
  enabled: true,
  status: "no_user",
  currentUserId: null,
  recalledTaskCount: 0,
  sectionCount: 0,
  skippedReason: "no_user",
  warningCount: 0,
});

console.log("pipeline memory manager test passed");
