import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createAgentLoopFileLogger,
  withAgentLoopLogFilePath,
} from "../../src/modules/agent-loop/fileLogger.ts";

const logDir = path.join(os.tmpdir(), `agent-loop-log-path-${Date.now()}`);
process.env.AGENT_LOOP_LOG_DIR = logDir;

const dateBefore = new Date().toISOString().slice(0, 10);
const logger = await createAgentLoopFileLogger({
  taskId: "task-log-path-test",
  query: "直接回答",
});
const dateAfter = new Date().toISOString().slice(0, 10);

const result = withAgentLoopLogFilePath(
  {
    finalAnswer: "done",
    turns: 1,
    observations: [],
    stoppedBy: "final_answer",
  },
  logger,
);

assert.equal(result.finalAnswer, "done");
assert.match(result.logFilePath, /agent-loop-task-log-path-test-.*\.jsonl$/);

const relativePath = path.relative(logDir, result.logFilePath).split(path.sep);
assert.equal(relativePath.length, 3);
assert.ok(
  relativePath[0] === dateBefore || relativePath[0] === dateAfter,
  `expected date folder, got ${relativePath[0]}`,
);
assert.equal(relativePath[1], "no-session");
assert.match(relativePath[2], /^agent-loop-task-log-path-test-.*\.jsonl$/);

await logger.finish(result);

const logContent = await fs.readFile(result.logFilePath, "utf8");
assert.match(logContent, /"kind":"run_stop"/);
assert.match(logContent, /"logFilePath"/);

await fs.rm(logDir, { recursive: true, force: true });
console.log("test-agent-loop-log-file-path passed");
