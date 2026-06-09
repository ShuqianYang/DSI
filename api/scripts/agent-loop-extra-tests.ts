import "dotenv/config";
import { db } from "../src/config/database.js";
import { tasks } from "../src/db/schema.js";
import { runAgentLoopEvents } from "../src/modules/agent-loop/runAgentLoop.js";
import { buildSystemTools } from "../src/modules/agent-loop/tools/system/index.js";
import { ToolRegistry } from "../src/modules/agent-loop/tools/_shared/toolRegistry.js";
import type { AgentLoopEvent, ModelClient, ToolDefinition } from "../src/modules/agent-loop/tools/_shared/types.js";

interface ExtraTest {
  name: string;
  description: string;
  run: () => Promise<
    | { status: "pass"; detail: string }
    | { status: "fail"; detail: string }
    | { status: "error"; detail: string }
  >;
}

// ── Test 1: AbortSignal 取消链路 ──
const ABORT_TEST: ExtraTest = {
  name: "abort-signal",
  description: "Agent loop should stop cleanly when AbortSignal is triggered",
  async run() {
    const registry = new ToolRegistry();
    for (const tool of buildSystemTools()) {
      if (tool.name === "Sleep") registry.register(tool);
    }
    const controller = new AbortController();
    const taskId = await createTask("abort-test");

    // Cancel after 500ms
    setTimeout(() => controller.abort("user-cancelled"), 500);

    let loopEvent: (AgentLoopEvent & { type: "loop_stop" }) | undefined;
    const start = Date.now();
    for await (const event of runAgentLoopEvents({
      taskId,
      query: "Sleep for 10 seconds",
      registry,
      maxTurns: 3,
      modelClient: mockModelClient([
        {
          type: "tool_calls",
          toolCalls: [{
            id: "sleep_1",
            toolName: "Sleep",
            input: { duration_ms: 10_000, reason: "long sleep" },
          }],
        },
        { type: "final_answer", content: "Should not reach here" },
      ]),
      signal: controller.signal,
    })) {
      if (event.type === "loop_stop") loopEvent = event;
    }
    const elapsed = Date.now() - start;

    if (!loopEvent) return { status: "error", detail: "No loop_stop event" };
    if (loopEvent.result.stoppedBy !== "aborted") {
      return { status: "fail", detail: `Expected stoppedBy=aborted, got ${loopEvent.result.stoppedBy}` };
    }
    if (elapsed > 3_000) {
      return { status: "fail", detail: `Took ${elapsed}ms to abort, expected < 3000ms` };
    }
    return { status: "pass", detail: `Aborted in ${elapsed}ms, stoppedBy=${loopEvent.result.stoppedBy}` };
  },
};

// ── Test 2: Bash sandbox env isolation ──
const SANDBOX_ENV_TEST: ExtraTest = {
  name: "bash-sandbox-env",
  description: "Bash sandbox should not expose non-whitelisted env vars",
  async run() {
    process.env.SENSITIVE_SECRET_TEST = "should-not-leak-12345";
    const registry = new ToolRegistry();
    for (const tool of buildSystemTools()) {
      if (tool.name === "Bash") registry.register(tool);
    }
    const taskId = await createTask("sandbox-env-test");

    let loopEvent: (AgentLoopEvent & { type: "loop_stop" }) | undefined;
    for await (const event of runAgentLoopEvents({
      taskId,
      query: "Check env",
      registry,
      maxTurns: 2,
      modelClient: mockModelClient([
        {
          type: "tool_calls",
          toolCalls: [{
            id: "bash_1",
            toolName: "Bash",
            input: { command: "echo $SENSITIVE_SECRET_TEST" },
          }],
        },
        { type: "final_answer", content: "Done" },
      ]),
    })) {
      if (event.type === "loop_stop") loopEvent = event;
    }

    delete process.env.SENSITIVE_SECRET_TEST;
    if (!loopEvent) return { status: "error", detail: "No loop_stop" };

    const obs = loopEvent.result.observations[0];
    if (!obs || obs.ok !== true) {
      return { status: "fail", detail: "Bash did not execute" };
    }
    const out = obs.output as Record<string, unknown> | undefined;
    const stdout = String(out?.stdout ?? "");
    if (stdout.includes("should-not-leak")) {
      return { status: "fail", detail: `Secret leaked in stdout: ${stdout.trim()}` };
    }
    return { status: "pass", detail: `Secret not leaked. stdout: "${stdout.trim()}"` };
  },
};

// ── Test 3: Sleep signal cancellation ──
const SLEEP_CANCEL_TEST: ExtraTest = {
  name: "sleep-signal-cancel",
  description: "Sleep tool should reject when AbortSignal fires during sleep",
  async run() {
    const registry = new ToolRegistry();
    for (const tool of buildSystemTools()) {
      if (tool.name === "Sleep") registry.register(tool);
    }
    const controller = new AbortController();
    const taskId = await createTask("sleep-cancel-test");

    setTimeout(() => controller.abort("cancelled-during-sleep"), 300);

    let loopEvent: (AgentLoopEvent & { type: "loop_stop" }) | undefined;
    const start = Date.now();
    for await (const event of runAgentLoopEvents({
      taskId,
      query: "Sleep",
      registry,
      maxTurns: 2,
      modelClient: mockModelClient([
        {
          type: "tool_calls",
          toolCalls: [{
            id: "sleep_1",
            toolName: "Sleep",
            input: { duration_ms: 5_000 },
          }],
        },
      ]),
      signal: controller.signal,
    })) {
      if (event.type === "loop_stop") loopEvent = event;
    }
    const elapsed = Date.now() - start;

    if (!loopEvent) return { status: "error", detail: "No loop_stop" };
    if (elapsed > 2_000) {
      return { status: "fail", detail: `Sleep did not cancel, took ${elapsed}ms` };
    }
    return { status: "pass", detail: `Sleep cancelled in ${elapsed}ms` };
  },
};

// ── Test 4: Write outside workspace boundary ──
const WRITE_BOUNDARY_TEST: ExtraTest = {
  name: "write-boundary",
  description: "Write tool should reject paths outside workspace",
  async run() {
    const registry = new ToolRegistry();
    for (const tool of buildSystemTools()) {
      if (tool.name === "Write") registry.register(tool);
    }
    const taskId = await createTask("write-boundary-test");

    let loopEvent: (AgentLoopEvent & { type: "loop_stop" }) | undefined;
    for await (const event of runAgentLoopEvents({
      taskId,
      query: "Write outside workspace",
      registry,
      maxTurns: 2,
      modelClient: mockModelClient([
        {
          type: "tool_calls",
          toolCalls: [{
            id: "write_1",
            toolName: "Write",
            input: { file_path: "../../etc/passwd", content: "hacked" },
          }],
        },
      ]),
      permissionHandler: () => "allow",
    })) {
      if (event.type === "loop_stop") loopEvent = event;
    }

    if (!loopEvent) return { status: "error", detail: "No loop_stop" };
    const obs = loopEvent.result.observations[0];
    if (!obs) return { status: "error", detail: "No observation" };
    if (obs.ok === true) {
      return { status: "fail", detail: "Write succeeded outside workspace" };
    }
    const errMsg = obs.error?.message ?? "";
    if (!errMsg.includes("workspace") && !errMsg.includes("escapes")) {
      return { status: "fail", detail: `Wrong error message: ${errMsg}` };
    }
    return { status: "pass", detail: `Blocked: ${errMsg}` };
  },
};

// ── Test 5: Edit old_string not found ──
const EDIT_MISMATCH_TEST: ExtraTest = {
  name: "edit-mismatch",
  description: "Edit with non-matching old_string should fail gracefully",
  async run() {
    // Create a temp file first
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const root = getWorkspaceRootForTests();
    const tmpFile = path.join(root, "tmp_edit_test.txt");
    await fs.writeFile(tmpFile, "hello world\n", "utf8");

    const registry = new ToolRegistry();
    for (const tool of buildSystemTools()) {
      if (tool.name === "Edit") registry.register(tool);
    }
    const taskId = await createTask("edit-mismatch-test");

    let loopEvent: (AgentLoopEvent & { type: "loop_stop" }) | undefined;
    for await (const event of runAgentLoopEvents({
      taskId,
      query: "Edit file",
      registry,
      maxTurns: 2,
      modelClient: mockModelClient([
        {
          type: "tool_calls",
          toolCalls: [{
            id: "edit_1",
            toolName: "Edit",
            input: {
              file_path: "tmp_edit_test.txt",
              old_string: "THIS DOES NOT EXIST",
              new_string: "replaced",
            },
          }],
        },
      ]),
      permissionHandler: () => "allow",
    })) {
      if (event.type === "loop_stop") loopEvent = event;
    }

    await fs.unlink(tmpFile).catch(() => {});
    if (!loopEvent) return { status: "error", detail: "No loop_stop" };
    const obs = loopEvent.result.observations[0];
    if (!obs) return { status: "error", detail: "No observation" };
    if (obs.ok === true) {
      return { status: "fail", detail: "Edit succeeded with wrong old_string" };
    }
    const errMsg = obs.error?.message ?? "";
    if (!errMsg.includes("not found")) {
      return { status: "fail", detail: `Wrong error: ${errMsg}` };
    }
    return { status: "pass", detail: `Correctly failed: ${errMsg}` };
  },
};

// ── Test 6: DeepSeek returns invalid tool args ──
const INVALID_TOOL_ARGS_TEST: ExtraTest = {
  name: "invalid-tool-args",
  description: "Loop should handle model returning invalid JSON in tool arguments",
  async run() {
    const registry = new ToolRegistry();
    for (const tool of buildSystemTools()) {
      if (tool.name === "Read") registry.register(tool);
    }
    const taskId = await createTask("invalid-args-test");

    let loopEvent: (AgentLoopEvent & { type: "loop_stop" }) | undefined;
    for await (const event of runAgentLoopEvents({
      taskId,
      query: "Read file",
      registry,
      maxTurns: 2,
      modelClient: {
        async decide() {
          return {
            type: "tool_calls",
            toolCalls: [{
              id: "read_1",
              toolName: "Read",
              input: { file_path: 12345 }, // invalid type (number instead of string)
            }],
          };
        },
      },
    })) {
      if (event.type === "loop_stop") loopEvent = event;
    }

    if (!loopEvent) return { status: "error", detail: "No loop_stop" };
    const obs = loopEvent.result.observations[0];
    if (!obs) return { status: "error", detail: "No observation" };
    if (obs.ok === true) {
      return { status: "fail", detail: "Invalid args were accepted" };
    }
    if (obs.error?.code !== "invalid_tool_input") {
      return { status: "fail", detail: `Wrong error code: ${obs.error?.code}` };
    }
    return { status: "pass", detail: `Correctly rejected: ${obs.error.message}` };
  },
};

// ── Test 7: Concurrent batch splitting (>5 tools) ──
const CONCURRENT_SPLIT_TEST: ExtraTest = {
  name: "concurrent-batch-split",
  description: "More than 5 concurrent-safe tools should be split into multiple batches",
  async run() {
    const registry = new ToolRegistry();
    for (const tool of buildSystemTools()) {
      if (tool.name === "Read") registry.register(tool);
    }
    const taskId = await createTask("batch-split-test");

    const batches: Array<{ mode: string; size: number }> = [];
    let loopEvent: (AgentLoopEvent & { type: "loop_stop" }) | undefined;
    for await (const event of runAgentLoopEvents({
      taskId,
      query: "Read many files",
      registry,
      maxTurns: 2,
      maxConcurrentToolCalls: 3,
      modelClient: {
        async decide() {
          return {
            type: "tool_calls",
            toolCalls: Array.from({ length: 7 }, (_, i) => ({
              id: `read_${i}`,
              toolName: "Read",
              input: { file_path: "api/package.json" },
            })),
          };
        },
      },
    })) {
      if (event.type === "tool_batch") {
        batches.push({ mode: event.mode, size: event.tools.length });
      }
      if (event.type === "loop_stop") loopEvent = event;
    }

    if (!loopEvent) return { status: "error", detail: "No loop_stop" };
    if (batches.length < 2) {
      return { status: "fail", detail: `Expected >=2 batches, got ${batches.length}` };
    }
    const allConcurrent = batches.every((b) => b.mode === "concurrent");
    if (!allConcurrent) {
      return { status: "fail", detail: `Expected all concurrent batches, got: ${JSON.stringify(batches)}` };
    }
    const allWithinLimit = batches.every((b) => b.size <= 3);
    if (!allWithinLimit) {
      return { status: "fail", detail: `Batch exceeded limit 3: ${JSON.stringify(batches)}` };
    }
    return { status: "pass", detail: `Split into ${batches.length} batches: ${JSON.stringify(batches)}` };
  },
};

// ── Test 8: Read offset beyond file end ──
const READ_OFFSET_TEST: ExtraTest = {
  name: "read-offset-boundary",
  description: "Read with offset beyond file length should return empty content",
  async run() {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const root = getWorkspaceRootForTests();
    const tmpFile = path.join(root, "tmp_short.txt");
    await fs.writeFile(tmpFile, "line1\nline2\n", "utf8");

    const registry = new ToolRegistry();
    for (const tool of buildSystemTools()) {
      if (tool.name === "Read") registry.register(tool);
    }
    const taskId = await createTask("read-offset-test");

    let loopEvent: (AgentLoopEvent & { type: "loop_stop" }) | undefined;
    for await (const event of runAgentLoopEvents({
      taskId,
      query: "Read file",
      registry,
      maxTurns: 2,
      modelClient: mockModelClient([
        {
          type: "tool_calls",
          toolCalls: [{
            id: "read_1",
            toolName: "Read",
            input: { file_path: "tmp_short.txt", offset: 100, limit: 10 },
          }],
        },
      ]),
    })) {
      if (event.type === "loop_stop") loopEvent = event;
    }

    await fs.unlink(tmpFile).catch(() => {});
    if (!loopEvent) return { status: "error", detail: "No loop_stop" };
    const obs = loopEvent.result.observations[0];
    if (!obs || obs.ok !== true) {
      return { status: "fail", detail: `Read failed: ${obs?.error?.message}` };
    }
    const out = obs.output as Record<string, unknown> | undefined;
    const content = String(out?.content ?? "");
    const startLine = Number(out?.startLine ?? 0);
    if (content !== "" || startLine !== 100) {
      return { status: "fail", detail: `Unexpected content: "${content}", startLine=${startLine}` };
    }
    return { status: "pass", detail: `Offset beyond end: content="${content}", startLine=${startLine}` };
  },
};

const TESTS: ExtraTest[] = [
  ABORT_TEST,
  SANDBOX_ENV_TEST,
  SLEEP_CANCEL_TEST,
  WRITE_BOUNDARY_TEST,
  EDIT_MISMATCH_TEST,
  INVALID_TOOL_ARGS_TEST,
  CONCURRENT_SPLIT_TEST,
  READ_OFFSET_TEST,
];

async function main() {
  const filter = process.argv.find((arg) => arg.startsWith("--run="))?.slice(6);
  const tests = filter ? TESTS.filter((t) => t.name.includes(filter)) : TESTS;

  console.log(`Running ${tests.length} extra test(s)…\n`);
  let passed = 0, failed = 0, errored = 0;

  for (const test of tests) {
    console.log(`─── ${test.name} ───`);
    console.log(test.description);
    const result = await test.run();
    if (result.status === "pass") {
      passed++;
      console.log(`  ✅ PASS: ${result.detail}`);
    } else if (result.status === "fail") {
      failed++;
      console.log(`  ❌ FAIL: ${result.detail}`);
    } else {
      errored++;
      console.log(`  ⚠️  ERROR: ${result.detail}`);
    }
    console.log();
  }

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${errored} errored`);
  process.exit(failed + errored > 0 ? 1 : 0);
}

function mockModelClient(decisions: Array<{
  type: "tool_calls";
  toolCalls: Array<{ id: string; toolName: string; input: Record<string, unknown> }>;
} | { type: "final_answer"; content: string }>): ModelClient {
  let index = 0;
  return {
    async decide() {
      const d = decisions[index++];
      if (!d) return { type: "final_answer", content: "Mock done" };
      return d as any;
    },
  };
}

function getWorkspaceRootForTests(): string {
  const configured = process.env.AGENT_WORKSPACE_ROOT;
  if (configured) return configured;

  // Walk up from current dir to find .git or pnpm-workspace.yaml
  const { existsSync } = require("node:fs");
  const path = require("node:path");
  let current = process.cwd();
  while (true) {
    if (
      existsSync(path.join(current, "pnpm-workspace.yaml")) ||
      existsSync(path.join(current, ".git"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return process.cwd();
    current = parent;
  }
}

async function createTask(name: string): Promise<string> {
  const [task] = await db
    .insert(tasks)
    .values({ query: `[extra-test] ${name}`, status: "running" })
    .returning({ id: tasks.id });
  return task.id;
}

main().catch((err) => {
  console.error("[extra-tests] fatal:", err);
  process.exit(1);
});
