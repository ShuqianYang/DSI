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
const sections = await enabledPrefetch.promise;
assert.deepEqual(listInput, {
  userId: "user-1",
  excludeTaskId: currentTaskId,
  limit: 3,
});
assert.equal(sections.length, 1);
assert.equal(sections[0].id, `memory.session_summary.${priorTaskId}`);
assert(sections[0].content.includes("Prior task answer."));

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

console.log("pipeline memory manager test passed");
