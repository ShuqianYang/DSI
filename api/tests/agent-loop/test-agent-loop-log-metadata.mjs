import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAgentLoopFileLogger } from "../../src/modules/agent-loop/fileLogger.ts";

const logDir = path.join(os.tmpdir(), `agent-loop-log-metadata-${Date.now()}`);
process.env.AGENT_LOOP_LOG_DIR = logDir;

const logger = await createAgentLoopFileLogger({
  taskId: "task-log-metadata-test",
  query: "metadata check",
  metadata: {
    sessionId: "session-1",
    requestId: "request-1",
    userId: "user-1",
    scenarioId: "daily-report",
  },
});

await logger.finish({
  finalAnswer: "done",
  turns: 0,
  observations: [],
  stoppedBy: "final_answer",
});

const content = await fs.readFile(logger.filePath, "utf8");
const firstLine = JSON.parse(content.trim().split(/\r?\n/)[0]);

assert.equal(firstLine.kind, "run_start");
assert.equal(firstLine.metadata.sessionId, "session-1");
assert.equal(firstLine.metadata.requestId, "request-1");
assert.equal(firstLine.metadata.userId, "user-1");
assert.equal(firstLine.metadata.scenarioId, "daily-report");

await fs.rm(logDir, { recursive: true, force: true });
console.log("test-agent-loop-log-metadata passed");
