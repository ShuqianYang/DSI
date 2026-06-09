import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAgentLoopFileLogger } from "../src/modules/agent-loop/fileLogger.ts";

const logDir = path.join(os.tmpdir(), `agent-loop-file-logger-${Date.now()}`);
process.env.AGENT_LOOP_LOG_DIR = logDir;

const logger = await createAgentLoopFileLogger({
  taskId: "task-log-test",
  query: "圈选台湾海峡并查询天气",
});

logger.logEvent({
  type: "agent_turn",
  taskId: "task-log-test",
  turn: 1,
  maxTurns: 10,
  message: "Agent loop turn 1/10",
});

logger.logEvent({
  type: "tool_observation",
  taskId: "task-log-test",
  turn: 1,
  toolCallId: "call-region-mark",
  toolName: "RegionMark",
  ok: true,
  observation: {
    toolCallId: "call-region-mark",
    toolName: "RegionMark",
    ok: true,
    output: { gisData: { type: "region" } },
  },
});

await logger.finish({
  finalAnswer: "已圈选台湾海峡。",
  turns: 1,
  observations: [],
  stoppedBy: "final_answer",
});

const content = await fs.readFile(logger.filePath, "utf8");
const lines = content.trim().split(/\r?\n/).map((line) => JSON.parse(line));

assert.equal(lines[0].kind, "run_start");
assert.equal(lines[0].taskId, "task-log-test");
assert.equal(lines[1].kind, "agent_loop_event");
assert.match(lines[1].message, /agent_turn/);
assert.equal(lines[2].kind, "agent_loop_event");
assert.match(lines[2].message, /tool_observation/);
assert.match(lines[2].message, /gisData=region/);
assert.equal(lines.at(-1).kind, "run_stop");
assert.equal(lines.at(-1).result.finalAnswer, "已圈选台湾海峡。");

await fs.rm(logDir, { recursive: true, force: true });
console.log("test-agent-loop-file-logger passed");
