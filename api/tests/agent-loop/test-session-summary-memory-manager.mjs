import assert from "node:assert/strict";

const {
  createSessionSummaryMemoryManager,
  formatSessionMemorySection,
} = await import("../../src/modules/agent-loop/sessionSummaryMemoryManager.ts");

const currentTaskId = "00000000-0000-0000-0000-000000000001";
const priorTaskId = "00000000-0000-0000-0000-000000000002";
const otherTaskId = "00000000-0000-0000-0000-000000000003";

const priorTask = {
  id: priorTaskId,
  userId: "user-1",
  query: "Mark Taiwan Strait and fetch wind field",
  status: "completed",
  completedAt: new Date("2026-06-15T10:00:00.000Z"),
};

const section = formatSessionMemorySection({
  task: priorTask,
  transcriptSummary: {
    taskId: priorTaskId,
    stoppedBy: "final_answer",
    finalAnswerPreview: "Taiwan Strait wind field was fetched.",
    recentTools: [{ toolName: "WeatherFetch", toolCallId: "call-1", ok: true, error: null }],
  },
  maxChars: 3000,
});

assert.equal(section.id, `memory.session_summary.${priorTaskId}`);
assert.match(section.content, /recent_completed_task/);
assert.match(section.content, /Taiwan Strait wind field was fetched/);
assert(section.content.length <= 3000);

const loadedTaskIds = [];
const warnings = [];
const manager = createSessionSummaryMemoryManager({
  enabled: true,
  currentTaskId,
  currentUserId: "user-1",
  recentTaskLimit: 3,
  listRecentCompletedTasks: async ({ userId, excludeTaskId, limit }) => {
    assert.equal(userId, "user-1");
    assert.equal(excludeTaskId, currentTaskId);
    assert.equal(limit, 3);
    return [
      priorTask,
      {
        id: otherTaskId,
        userId: "user-1",
        query: "Task with failing transcript load",
        status: "completed",
        completedAt: new Date("2026-06-14T10:00:00.000Z"),
      },
    ];
  },
  transcriptStore: {
    async append() {
      throw new Error("append should not be called");
    },
    async load(taskId) {
      loadedTaskIds.push(taskId);
      if (taskId === otherTaskId) throw new Error("one transcript failed");
      return [
        {
          taskId,
          turn: 1,
          sequence: 1,
          kind: "assistant_message",
          message: { role: "assistant", content: "Taiwan Strait wind field was fetched." },
        },
        {
          taskId,
          turn: 1,
          sequence: 2,
          kind: "loop_stop",
          stoppedBy: "final_answer",
          finalAnswer: "Taiwan Strait wind field was fetched.",
        },
      ];
    },
  },
  logger: { warn: (...args) => warnings.push(args) },
});

const prefetch = manager.startRelevantMemoryPrefetch(
  [{ role: "user", content: "Check Taiwan Strait again" }],
  {
    taskId: currentTaskId,
    query: "Check Taiwan Strait again",
    messages: [],
    observations: [],
    options: { tools: [] },
    readFileState: new Map(),
    todoState: [],
    nestedMemoryAttachmentTriggers: new Set(),
    dynamicSkillDirTriggers: new Set(),
    discoveredSkillNames: new Set(),
    invokedSkillSections: [],
  }
);

assert(prefetch);
assert.equal(prefetch.settledAt, null);
assert.equal(prefetch.consumedOnIteration, -1);

const sections = await prefetch.promise;
assert.equal(prefetch.settledAt > 0, true);
assert.deepEqual(loadedTaskIds, [priorTaskId, otherTaskId]);
assert.equal(sections.length, 1);
assert.equal(sections[0].id, `memory.session_summary.${priorTaskId}`);
assert.equal(warnings.length, 1);
assert.equal(warnings[0][0], "[Memory] session summary candidate failed:");

const deduped = manager.filterDuplicateMemorySections?.([sections[0], sections[0]], {
  taskId: currentTaskId,
  query: "Check Taiwan Strait again",
  messages: [],
  observations: [],
  options: { tools: [] },
  readFileState: new Map(),
  todoState: [],
  nestedMemoryAttachmentTriggers: new Set(),
  dynamicSkillDirTriggers: new Set(),
  discoveredSkillNames: new Set(),
  invokedSkillSections: [],
});
assert.equal(deduped.length, 1);
assert.equal(deduped[0].id, `memory.session_summary.${priorTaskId}`);

let fallbackLimitSeen;
const fallbackManager = createSessionSummaryMemoryManager({
  enabled: true,
  currentTaskId,
  currentUserId: "user-1",
  recentTaskLimit: Number.NaN,
  maxSectionChars: Number.NaN,
  transcriptStore: manager.transcriptStore,
  listRecentCompletedTasks: async ({ limit }) => {
    fallbackLimitSeen = limit;
    return [];
  },
});
const fallbackPrefetch = fallbackManager.startRelevantMemoryPrefetch([], {
  taskId: currentTaskId,
});
assert(fallbackPrefetch);
assert.deepEqual(await fallbackPrefetch.promise, []);
assert.equal(fallbackLimitSeen, 3);

let emptyUserIdSeen;
const emptyUserIdManager = createSessionSummaryMemoryManager({
  enabled: true,
  currentTaskId,
  currentUserId: "",
  transcriptStore: manager.transcriptStore,
  listRecentCompletedTasks: async ({ userId }) => {
    emptyUserIdSeen = userId;
    return [];
  },
});
const emptyUserIdPrefetch = emptyUserIdManager.startRelevantMemoryPrefetch([], {
  taskId: currentTaskId,
});
assert(emptyUserIdPrefetch);
assert.deepEqual(await emptyUserIdPrefetch.promise, []);
assert.equal(emptyUserIdSeen, "");

const disabled = createSessionSummaryMemoryManager({
  enabled: false,
  currentTaskId,
  currentUserId: "user-1",
  transcriptStore: manager.transcriptStore,
  listRecentCompletedTasks: async () => {
    throw new Error("should not list tasks when disabled");
  },
});
assert.equal(disabled.startRelevantMemoryPrefetch([], { taskId: currentTaskId }), undefined);

const noUser = createSessionSummaryMemoryManager({
  enabled: true,
  currentTaskId,
  currentUserId: null,
  transcriptStore: manager.transcriptStore,
  listRecentCompletedTasks: async () => {
    throw new Error("should not list tasks without user id");
  },
});
assert.equal(noUser.startRelevantMemoryPrefetch([], { taskId: currentTaskId }), undefined);

console.log("session summary memory manager test passed");
