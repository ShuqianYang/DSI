import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAgentLoopFileLogger } from "../../src/modules/agent-loop/fileLogger.ts";

function assertStrictlyIncreasingSequence(lines) {
  lines.forEach((line, index) => {
    assert.equal(line.seq, index + 1);
  });
}

const logDir = path.join(os.tmpdir(), `agent-loop-file-logger-${Date.now()}`);
const originalLogMode = process.env.AGENT_LOOP_LOG_MODE;
process.env.AGENT_LOOP_LOG_DIR = logDir;
process.env.AGENT_LOOP_LOG_MODE = "debug";

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

assertStrictlyIncreasingSequence(lines);
assert.equal(lines[0].kind, "run_start");
assert.equal(lines[0].seq, 1);
assert.equal(lines[0].taskId, "task-log-test");
assert.equal(lines[1].kind, "agent_loop_event");
assert.match(lines[1].message, /agent_turn/);
assert.equal(lines[2].kind, "agent_loop_event");
assert.match(lines[2].message, /tool_observation/);
assert.match(lines[2].message, /gisData=region/);
assert.equal(lines[2].event.observation.output.gisData.type, "region");
assert.equal(lines.at(-1).kind, "run_stop");
assert.equal(typeof lines.at(-1).durationMs, "number");
assert.ok(lines.at(-1).durationMs >= 0);
assert.equal(lines.at(-1).result.finalAnswer, "已圈选台湾海峡。");

const failLogger = await createAgentLoopFileLogger({
  taskId: "task-log-fail-test",
  query: "fail path",
});
await failLogger.fail(new Error("boom"));

const failContent = await fs.readFile(failLogger.filePath, "utf8");
const failLines = failContent.trim().split(/\r?\n/).map((line) => JSON.parse(line));

assertStrictlyIncreasingSequence(failLines);
assert.equal(failLines[0].seq, 1);
assert.equal(failLines.at(-1).kind, "run_error");
assert.equal(typeof failLines.at(-1).durationMs, "number");
assert.ok(failLines.at(-1).durationMs >= 0);
assert.equal(failLines.at(-1).error.message, "boom");

process.env.AGENT_LOOP_LOG_MODE = "operational";
const operationalLogger = await createAgentLoopFileLogger({
  taskId: "task-log-operational-test",
  query: "operational path",
});
operationalLogger.logEvent({
  type: "model_request",
  taskId: "task-log-operational-test",
  turn: 1,
  messages: [
    { role: "system", content: "secret system prompt" },
    { role: "user", content: "secret user prompt" },
  ],
});
await operationalLogger.finish({
  finalAnswer: "secret final answer",
  turns: 1,
  observations: [],
  stoppedBy: "final_answer",
});
const operationalContent = await fs.readFile(operationalLogger.filePath, "utf8");
const operationalLines = operationalContent.trim().split(/\r?\n/).map((line) => JSON.parse(line));
const modelRequestLine = operationalLines.find((line) => line.event?.type === "model_request");

assert.ok(modelRequestLine);
assert.equal(modelRequestLine.event.messageCount, 2);
assert.equal("messages" in modelRequestLine.event, false);
assert.equal(operationalContent.includes("secret system prompt"), false);
assert.equal(operationalContent.includes("secret user prompt"), false);
assert.equal(operationalContent.includes("secret final answer"), false);

if (originalLogMode === undefined) {
  delete process.env.AGENT_LOOP_LOG_MODE;
} else {
  process.env.AGENT_LOOP_LOG_MODE = originalLogMode;
}

await fs.rm(logDir, { recursive: true, force: true });
console.log("test-agent-loop-file-logger passed");
