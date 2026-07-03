import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAgentLoopFileLogger } from "../../src/modules/agent-loop/fileLogger.ts";

const logDir = path.join(os.tmpdir(), `agent-loop-log-date-session-path-${Date.now()}`);
process.env.AGENT_LOOP_LOG_DIR = logDir;

const dateBefore = new Date().toISOString().slice(0, 10);
const sessionLogger = await createAgentLoopFileLogger({
  taskId: "task-date-session-path-test",
  query: "date and session path",
  metadata: {
    sessionId: " session/ABC:123 ",
  },
});
const dateAfter = new Date().toISOString().slice(0, 10);

const sessionRelativePath = path.relative(logDir, sessionLogger.filePath).split(path.sep);
assert.equal(sessionRelativePath.length, 3);
assert.ok(
  sessionRelativePath[0] === dateBefore || sessionRelativePath[0] === dateAfter,
  `expected date folder, got ${sessionRelativePath[0]}`,
);
assert.equal(sessionRelativePath[1], "session-ABC-123");
assert.match(sessionRelativePath[2], /^agent-loop-task-date-session-path-test-.*\.jsonl$/);

const fallbackLogger = await createAgentLoopFileLogger({
  taskId: "task-no-session-path-test",
  query: "fallback session path",
});

const fallbackRelativePath = path.relative(logDir, fallbackLogger.filePath).split(path.sep);
assert.equal(fallbackRelativePath.length, 3);
assert.ok(
  fallbackRelativePath[0] === dateBefore || fallbackRelativePath[0] === dateAfter,
  `expected date folder, got ${fallbackRelativePath[0]}`,
);
assert.equal(fallbackRelativePath[1], "no-session");
assert.match(fallbackRelativePath[2], /^agent-loop-task-no-session-path-test-.*\.jsonl$/);

await sessionLogger.finish({
  finalAnswer: "done",
  turns: 1,
  observations: [],
  stoppedBy: "final_answer",
});
await fallbackLogger.finish({
  finalAnswer: "done",
  turns: 1,
  observations: [],
  stoppedBy: "final_answer",
});

await fs.rm(logDir, { recursive: true, force: true });
console.log("test-agent-loop-log-date-session-path passed");
