import assert from "node:assert/strict";
import { runAgentPipelineWithDependencies } from "../../src/modules/tasks/pipeline.ts";

const taskId = "00000000-0000-4000-8000-000000000001";
const body = {
  query: "manifest check",
  userId: "user-1",
  sessionId: "session-1",
  clientRequestId: "client-request-1",
  scenarioId: "daily-report",
};
const metadata = {
  requestId: "request-1",
  ipMasked: "203.0.113.0",
};

function createFileLogger() {
  return {
    filePath: "S:/logs/2026-07-03/session-1/agent-loop-task.jsonl",
    logEvent() {},
    logDerivedEvent() {},
    async finish() {},
    async fail(error) {
      this.failedWith = error instanceof Error ? error.message : String(error);
    },
  };
}

function createTaskServiceRecorder() {
  const calls = [];
  return {
    calls,
    service: {
      async updateTaskStatus(id, status, error) {
        calls.push(["status", id, status, error]);
      },
      async updateTaskResult(id, result, status) {
        calls.push(["result", id, status, result.stoppedBy]);
      },
      async getTaskById(id) {
        calls.push(["get", id]);
        return null;
      },
    },
  };
}

function createDependencies(overrides = {}) {
  const taskServiceRecorder = createTaskServiceRecorder();
  return {
    taskService: taskServiceRecorder.service,
    taskServiceCalls: taskServiceRecorder.calls,
    createFileLogger: async () => createFileLogger(),
    createTranscriptStore: () => ({}),
    createBestEffortTranscriptStore: (store) => store,
    createMemoryManager: () => ({}),
    listRecentCompletedTasks: async () => [],
    runAgentLoop: async () => ({
      finalAnswer: "done",
      turns: 1,
      observations: [],
      stoppedBy: "final_answer",
    }),
    notifyTaskUpdate() {},
    logger: {
      log() {},
      warn() {},
      error() {},
    },
    ...overrides,
  };
}

const manifestCalls = [];
const manifestStore = {
  async recordStarted(input) {
    manifestCalls.push(["started", input]);
  },
  async recordCompleted(input) {
    manifestCalls.push(["completed", input]);
  },
  async recordFailed(input) {
    manifestCalls.push(["failed", input]);
  },
};

await runAgentPipelineWithDependencies(taskId, body, metadata, createDependencies({ manifestStore }));

assert.deepEqual(
  manifestCalls.map(([kind]) => kind),
  ["started", "completed"],
);
assert.equal(manifestCalls[0][1].taskId, taskId);
assert.equal(manifestCalls[0][1].sessionId, "session-1");
assert.equal(manifestCalls[0][1].requestId, "request-1");
assert.equal(manifestCalls[0][1].userId, "user-1");
assert.equal(manifestCalls[0][1].mode, "debug");
assert.equal(manifestCalls[1][1].filePath, "S:/logs/2026-07-03/session-1/agent-loop-task.jsonl");

const failingManifestCalls = [];
const failingDeps = createDependencies({
  manifestStore: {
    async recordStarted(input) {
      failingManifestCalls.push(["started", input]);
    },
    async recordCompleted(input) {
      failingManifestCalls.push(["completed", input]);
      throw new Error("manifest completed failed");
    },
    async recordFailed(input) {
      failingManifestCalls.push(["failed", input]);
    },
  },
});

await runAgentPipelineWithDependencies(taskId, body, metadata, failingDeps);
assert.deepEqual(
  failingManifestCalls.map(([kind]) => kind),
  ["started", "completed"],
);
assert.deepEqual(
  failingDeps.taskServiceCalls.filter(([kind]) => kind === "result").map(([, , status]) => status),
  ["completed"],
);

const failedManifestCalls = [];
const failedDeps = createDependencies({
  manifestStore: {
    async recordStarted(input) {
      failedManifestCalls.push(["started", input]);
    },
    async recordCompleted(input) {
      failedManifestCalls.push(["completed", input]);
    },
    async recordFailed(input) {
      failedManifestCalls.push(["failed", input]);
    },
  },
  runAgentLoop: async () => {
    throw new Error("loop boom");
  },
});

await runAgentPipelineWithDependencies(taskId, body, metadata, failedDeps);
assert.deepEqual(
  failedManifestCalls.map(([kind]) => kind),
  ["started", "failed"],
);
assert.deepEqual(
  failedDeps.taskServiceCalls.filter(([kind]) => kind === "status").map(([, , status]) => status),
  ["running", "failed"],
);

console.log("test-agent-loop-log-manifest-pipeline passed");
