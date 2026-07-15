import assert from "node:assert/strict";

const { buildMemoryRecallEventsFromTranscript } = await import(
  "../../src/modules/tasks/agentLoopSseMode.ts"
);

const events = buildMemoryRecallEventsFromTranscript([
  {
    taskId: "task-1",
    turn: 2,
    sequence: 8,
    kind: "memory_recall",
    memoryRecall: {
      source: "hybrid",
      recalledCount: 2,
      snippets: [
        { query: "older query", summary: "older summary", score: 0.82 },
        { query: "vector query", finalResult: "vector answer", score: 0.75 },
      ],
    },
  },
  {
    taskId: "task-1",
    turn: 1,
    sequence: 3,
    kind: "memory_recall",
    memoryRecall: {
      source: "session",
      recalledCount: 1,
      snippets: [{ query: "first query", finalResult: "first answer" }],
    },
  },
  {
    taskId: "task-1",
    turn: 1,
    sequence: 4,
    kind: "assistant_message",
    message: { role: "assistant", content: "answer" },
  },
  {
    taskId: "task-1",
    turn: 3,
    sequence: 9,
    kind: "memory_recall",
  },
]);

assert.deepEqual(events, [
  {
    type: "memory_recall",
    taskId: "task-1",
    turn: 1,
    source: "session",
    recalledCount: 1,
    snippets: [{ query: "first query", finalResult: "first answer" }],
  },
  {
    type: "memory_recall",
    taskId: "task-1",
    turn: 2,
    source: "hybrid",
    recalledCount: 2,
    snippets: [
      { query: "older query", summary: "older summary", score: 0.82 },
      { query: "vector query", finalResult: "vector answer", score: 0.75 },
    ],
  },
]);

console.log("memory recall history replay test passed");
