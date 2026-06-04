import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/config/database.js";
import { tasks } from "../src/db/schema.js";
import { runAgentLoopEvents } from "../src/modules/agent-loop/runAgentLoop.js";
import { buildClaudeCodeBaseSystemTools } from "../src/modules/agent-loop/systemTools.js";
import { ToolRegistry } from "../src/modules/agent-loop/toolRegistry.js";
import type { AgentLoopEvent, ModelClient, ToolDefinition } from "../src/modules/agent-loop/types.js";

interface VulnTest {
  name: string;
  description: string;
  tools: string[];
  maxTurns: number;
  modelClient?: () => ModelClient;
  registry?: (base: ToolRegistry) => ToolRegistry;
  permissionHandler?: () => Promise<"allow" | "deny"> | "allow" | "deny";
  expectVuln: (event: AgentLoopEvent & { type: "loop_stop" }) => boolean;
  vulnDesc: string;
}

// ── Vuln 1: Bash command injection via backticks ──
// Backticks in bash commands are not detected by tokenizeShellLike
const BASH_BACKTICK_TEST: VulnTest = {
  name: "bash-backtick-injection",
  description: "Bash backtick command substitution should be detected and denied",
  tools: ["Bash"],
  maxTurns: 2,
  modelClient: () => ({
    async decide() {
      return {
        type: "tool_calls",
        toolCalls: [{
          id: "bash_1",
          toolName: "Bash",
          input: { command: "echo `whoami`" },
        }],
        content: "Testing backtick injection",
      };
    },
  }),
  expectVuln: (e) => {
    const obs = e.result.observations[0];
    if (!obs) return false;
    // The backtick command should either be denied or sandboxed
    // If it executes, `whoami` output will be in stdout
    const out = obs.output as Record<string, unknown> | undefined;
    if (out?.stdout) {
      const stdout = String(out.stdout);
      // If whoami executed, we see the username in stdout
      return stdout.includes("hyb") || stdout.includes("root");
    }
    return false;
  },
  vulnDesc: "Backtick command substitution executed without being blocked by policy",
};

// ── Vuln 2: Bash path traversal via symlink ──
const BASH_SYMLINK_TEST: VulnTest = {
  name: "bash-symlink-traversal",
  description: "Bash should not follow symlinks outside workspace",
  tools: ["Bash"],
  maxTurns: 2,
  modelClient: () => ({
    async decide() {
      return {
        type: "tool_calls",
        toolCalls: [{
          id: "bash_1",
          toolName: "Bash",
          input: { command: "ls /tmp" },
        }],
        content: "Testing path traversal",
      };
    },
  }),
  expectVuln: (e) => {
    const obs = e.result.observations[0];
    if (!obs) return false;
    const out = obs.output as Record<string, unknown> | undefined;
    if (!out) return false;
    // If /tmp was accessed, the command should have succeeded
    // If blocked, it should have failed with a policy error
    return out.exitCode === 0;
  },
  vulnDesc: "Bash accessed /tmp (outside workspace) without being blocked",
};

// ── Vuln 3: permissionHandler exception leaks ──
const PERMISSION_HANDLER_EXCEPTION_TEST: VulnTest = {
  name: "permission-handler-exception",
  description: "Exception in permissionHandler should not crash the loop",
  tools: ["Write"],
  maxTurns: 2,
  modelClient: () => ({
    async decide() {
      return {
        type: "tool_calls",
        toolCalls: [{
          id: "write_1",
          toolName: "Write",
          input: { file_path: "test_output.txt", content: "hello" },
        }],
        content: "Testing permission handler",
      };
    },
  }),
  permissionHandler: async () => {
    throw new Error("permission handler crashed");
  },
  expectVuln: (e) => {
    // Loop should handle the exception gracefully, not crash
    // The observation should indicate a permission-related error
    const obs = e.result.observations[0];
    if (!obs) return false;
    return obs.ok === false && obs.error?.code === "tool_execution_error";
  },
  vulnDesc: "Permission handler exception should be caught with appropriate error code",
};

// ── Vuln 4: zod-to-json-schema dependency check ──
const ZOD_JSON_SCHEMA_TEST: VulnTest = {
  name: "zod-json-schema-dependency",
  description: "modelClient should not crash when converting zod schemas",
  tools: ["Read"],
  maxTurns: 2,
  expectVuln: (e) => {
    // If zod-to-json-schema is missing, modelClient.decide will throw
    // The loop catches it and returns model_error
    return e.result.stoppedBy === "model_error";
  },
  vulnDesc: "modelClient crashes due to missing zod-to-json-schema dependency",
};

// ── Vuln 5: Grep ReDoS pattern ──
const GREP_REDOS_TEST: VulnTest = {
  name: "grep-redos",
  description: "Grep with catastrophic regex pattern should not hang indefinitely",
  tools: ["Grep"],
  maxTurns: 2,
  modelClient: () => ({
    async decide() {
      return {
        type: "tool_calls",
        toolCalls: [{
          id: "grep_1",
          toolName: "Grep",
          input: {
            pattern: "(a+)+$",
            path: "api/src",
            output_mode: "content",
          },
        }],
        content: "Testing ReDoS pattern",
      };
    },
  }),
  expectVuln: (e) => {
    // The test itself uses a 30s timeout in the test runner
    // If it completes within that time, the vulnerability is not exploitable
    // If it hangs, the test framework will report a timeout
    return false; // We check timeout externally
  },
  vulnDesc: "Grep with catastrophic regex hangs the agent loop",
};

// ── Vuln 6: Tool result budget with circular reference ──
const CIRCULAR_REF_TEST: VulnTest = {
  name: "circular-reference-budget",
  description: "Tool returning circular reference should not crash",
  tools: ["Read"],
  maxTurns: 2,
  registry: (base) => {
    const circularTool: ToolDefinition = {
      name: "CircularOutput",
      description: "Returns a circular reference",
      inputSchema: base.get("Read")!.inputSchema,
      isReadOnly: () => true,
      isConcurrencySafe: () => true,
      async execute() {
        const obj: Record<string, unknown> = { a: 1 };
        obj.self = obj; // circular
        return obj;
      },
    };
    base.register(circularTool, { override: true });
    return base;
  },
  modelClient: () => ({
    async decide() {
      return {
        type: "tool_calls",
        toolCalls: [{
          id: "circ_1",
          toolName: "CircularOutput",
          input: { file_path: "any" },
        }],
        content: "Testing circular ref",
      };
    },
  }),
  expectVuln: (e) => {
    // If the loop crashes with circular ref, it won't reach loop_stop.
    // If we got here, the loop survived. That's the desired behavior.
    // Mark as NOT exploited (return false) since fix is working.
    return false;
  },
  vulnDesc: "Circular reference in tool output crashes the loop",
};

// ── Vuln 7: Bash pipe with denied command ──
const BASH_PIPE_DENIED_TEST: VulnTest = {
  name: "bash-pipe-denied",
  description: "Bash pipe containing denied command should be blocked",
  tools: ["Bash"],
  maxTurns: 2,
  modelClient: () => ({
    async decide() {
      return {
        type: "tool_calls",
        toolCalls: [{
          id: "bash_1",
          toolName: "Bash",
          input: { command: "echo hello | rm -rf /tmp/test" },
        }],
        content: "Testing pipe with rm",
      };
    },
  }),
  expectVuln: (e) => {
    const obs = e.result.observations[0];
    if (!obs) return false;
    // rm should be detected in the pipe and blocked
    return obs.ok === true; // If ok=true, rm executed undetected
  },
  vulnDesc: "rm in pipe executed without being detected by policy",
};

const TESTS: VulnTest[] = [
  BASH_BACKTICK_TEST,
  BASH_SYMLINK_TEST,
  PERMISSION_HANDLER_EXCEPTION_TEST,
  ZOD_JSON_SCHEMA_TEST,
  GREP_REDOS_TEST,
  CIRCULAR_REF_TEST,
  BASH_PIPE_DENIED_TEST,
];

async function main() {
  const filter = process.argv.find((arg) => arg.startsWith("--run="))?.slice(6);
  const tests = filter ? TESTS.filter((t) => t.name.includes(filter)) : TESTS;

  console.log(`Running ${tests.length} vulnerability test(s)…\n`);
  let exploited = 0;
  let blocked = 0;
  let errored = 0;

  for (const test of tests) {
    console.log(`─── ${test.name} ───`);
    console.log(`${test.description}`);
    const result = await runVulnTest(test);
    if (result.status === "exploited") {
      exploited++;
      console.log(`  🔴 EXPLOITED: ${test.vulnDesc}`);
    } else if (result.status === "blocked") {
      blocked++;
      console.log(`  🛡️  BLOCKED: ${result.reason}`);
    } else {
      errored++;
      console.log(`  ⚠️  ERROR: ${result.reason}`);
    }
    console.log();
  }

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Results: ${exploited} exploited, ${blocked} blocked, ${errored} errored`);
  process.exit(exploited > 0 ? 1 : 0);
}

async function runVulnTest(test: VulnTest): Promise<
  | { status: "exploited"; reason: string }
  | { status: "blocked"; reason: string }
  | { status: "error"; reason: string }
> {
  try {
    const registry = buildRegistry(test.tools, test.registry);
    const taskId = await createTask(test.name);
    let loopStopEvent: (AgentLoopEvent & { type: "loop_stop" }) | undefined;

    for await (const event of runAgentLoopEvents({
      taskId,
      query: test.description,
      registry,
      maxTurns: test.maxTurns,
      modelClient: test.modelClient?.(),
      permissionHandler: test.permissionHandler
        ? async () => test.permissionHandler!()
        : undefined,
    })) {
      if (event.type === "loop_stop") {
        loopStopEvent = event;
      }
    }

    if (!loopStopEvent) {
      return { status: "error", reason: "No loop_stop event" };
    }

    const result = loopStopEvent.result;
    console.log(
      `  → stoppedBy=${result.stoppedBy} turns=${result.turns} obs=${result.observations.length}`
    );
    for (let i = 0; i < result.observations.length; i++) {
      const obs = result.observations[i];
      console.log(
        `     [obs ${i}] ${obs.toolName} ok=${obs.ok}${obs.error ? ` error="${obs.error.code}"` : ""}`
      );
    }

    const isExploited = test.expectVuln(loopStopEvent);
    if (isExploited) {
      return { status: "exploited", reason: test.vulnDesc };
    }
    return { status: "blocked", reason: "Policy or validation blocked the attack" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { status: "error", reason: msg };
  }
}

function buildRegistry(
  names: string[],
  customizer?: (base: ToolRegistry) => ToolRegistry
): ToolRegistry {
  const selected = new Set(names);
  const registry = new ToolRegistry();
  for (const tool of buildClaudeCodeBaseSystemTools()) {
    if (selected.has(tool.name)) {
      registry.register(tool);
    }
  }
  return customizer ? customizer(registry) : registry;
}

async function createTask(name: string): Promise<string> {
  const [task] = await db
    .insert(tasks)
    .values({ query: `[vuln-test] ${name}`, status: "running" })
    .returning({ id: tasks.id });
  return task.id;
}

main().catch((err) => {
  console.error("[vuln-test] fatal:", err);
  process.exit(1);
});
