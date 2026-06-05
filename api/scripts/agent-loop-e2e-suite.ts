import "dotenv/config";
import { db } from "../src/config/database.js";
import { tasks } from "../src/db/schema.js";
import { runAgentLoopEvents } from "../src/modules/agent-loop/runAgentLoop.js";
import { buildClaudeCodeBaseSystemTools } from "../src/modules/agent-loop/systemTools.js";
import { ToolRegistry } from "../src/modules/agent-loop/toolRegistry.js";
import type { AgentLoopEvent } from "../src/modules/agent-loop/types.js";
import { defaultSkillManager, registerSkillTool } from "../src/modules/agent-loop/skillManager.js";
import { createModelClient } from "../src/modules/agent-loop/modelClient.js";

interface E2ETest {
  name: string;
  query: string;
  maxTurns: number;
  /** Semantic criteria for pass/fail. Not just "did it run". */
  criteria: {
    /** Must call at least one of these tools */
    expectedTools?: string[];
    /** Must NOT call any of these tools */
    forbiddenTools?: string[];
    /** Final answer must contain at least one of these substrings (case-insensitive) */
    answerMustContain?: string[];
    /** Final answer must match this regex */
    answerMustMatch?: RegExp;
    /** Must stop with this reason */
    mustStopBy?: "final_answer" | "max_turns";
    /** Custom semantic check */
    customCheck?: (result: {
      finalAnswer: string;
      observations: Array<{ toolName: string; ok: boolean; output?: unknown }>;
      turns: number;
      events: AgentLoopEvent[];
    }) => { pass: boolean; reason: string };
  };
}

const TESTS: E2ETest[] = [
  // ── Test 1: 基础 Read ──
  {
    name: "basic-read",
    query: "Read the first 5 lines of api/src/modules/agent-loop/runAgentLoop.ts and tell me what this file does in one sentence.",
    maxTurns: 3,
    criteria: {
      expectedTools: ["Read"],
      answerMustContain: ["agent", "loop", "tool"],
      mustStopBy: "final_answer",
    },
  },

  // ── Test 2: Glob + Read 链式 ──
  {
    name: "glob-read-chain",
    query: "List all .ts files in api/src/modules/agent-loop, then read runAgentLoop.ts and tell me its purpose.",
    maxTurns: 4,
    criteria: {
      expectedTools: ["Glob", "Read"],
      answerMustContain: ["agent", "loop"],
      mustStopBy: "final_answer",
    },
  },

  // ── Test 3: Grep + Read 链式 ──
  {
    name: "grep-read-chain",
    query: 'Search for "skillAllowedToolNames" in api/src/modules/agent-loop, read the file where it is defined or used, and explain what it does.',
    maxTurns: 5,
    criteria: {
      expectedTools: ["Grep", "Read"],
      answerMustContain: ["skill", "tool"],
      mustStopBy: "final_answer",
    },
  },

  // ── Test 4: Bash 只读（git log）──
  {
    name: "bash-git-readonly",
    query: "Show me the most recent git commit message in this repo and list the files it changed.",
    maxTurns: 3,
    criteria: {
      expectedTools: ["Bash"],
      answerMustContain: ["commit"],
      mustStopBy: "final_answer",
      customCheck: (result) => {
        // The answer should mention actual files changed, not just say "git log"
        const hasFiles = /\b(ts|js|json|md)\b/i.test(result.finalAnswer);
        return {
          pass: hasFiles,
          reason: hasFiles
            ? "Answer mentions specific file types from the commit"
            : "Answer does not mention any files changed in the commit",
        };
      },
    },
  },

  // ── Test 5: TodoWrite 状态跟踪 ──
  {
    name: "todo-progressive",
    query: 'Use TodoWrite to track: 1) Read api/package.json 2) Count how many dependencies it has 3) Report the count. Then execute the steps and update todos as you go.',
    maxTurns: 6,
    criteria: {
      expectedTools: ["TodoWrite", "Read"],
      mustStopBy: "final_answer",
      customCheck: (result) => {
        const todos = result.events.filter((e) => e.type === "tool_call" && e.toolName === "TodoWrite");
        const hasMultipleTodoUpdates = todos.length >= 2;
        const answerHasNumber = /\d+/.test(result.finalAnswer);
        return {
          pass: hasMultipleTodoUpdates && answerHasNumber,
          reason: `TodoWrite calls: ${todos.length}, answer has number: ${answerHasNumber}`,
        };
      },
    },
  },

  // ── Test 6: 并发 Read ──
  {
    name: "concurrent-reads",
    query: "Read api/package.json and api/tsconfig.json simultaneously and tell me the 'name' field in each.",
    maxTurns: 3,
    criteria: {
      expectedTools: ["Read"],
      forbiddenTools: [],
      mustStopBy: "final_answer",
      customCheck: (result) => {
        const readObs = result.observations.filter((o) => o.toolName === "Read" && o.ok);
        const answer = result.finalAnswer.toLowerCase();
        const hasPackage = answer.includes("package") || answer.includes("datasource");
        return {
          pass: readObs.length >= 2 && hasPackage,
          reason: `Read observations: ${readObs.length}, answer mentions package: ${hasPackage}`,
        };
      },
    },
  },

  // ── Test 7: Skill 调用（conventional-commit）带明确 args 指导 ──
  {
    name: "skill-conventional-commit-with-args",
    query: 'Use the Skill tool to load "conventional-commit-helper" and pass this change summary as args: "修复了 skillAllowedToolNames 过期清除逻辑，防止 skill 结束后工具限制永久生效". Then write a conventional commit message based on it.',
    maxTurns: 4,
    criteria: {
      expectedTools: ["Skill"],
      mustStopBy: "final_answer",
      answerMustMatch: /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)\s*[\(:]/im,
      customCheck: (result) => {
        const skillObs = result.observations.find((o) => o.toolName === "Skill" && o.ok);
        const skillCalledWithArgs = skillObs
          ? JSON.stringify(skillObs.output).includes("conventional-commit-helper")
          : false;
        const isConventionalFormat = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)\s*[\(:]/im.test(
          result.finalAnswer
        );
        return {
          pass: skillCalledWithArgs && isConventionalFormat,
          reason: `Skill loaded: ${!!skillObs}, conventional format: ${isConventionalFormat}`,
        };
      },
    },
  },

  // ── Test 8: Skill 调用（csv-profile）带明确 args 指导 ──
  {
    name: "skill-csv-profile-with-args",
    query: 'Use the Skill tool to load "csv-profile" and pass "skills/csv-profile/assets/sample-incidents.csv" as args. Report the CSV profile results.',
    maxTurns: 4,
    criteria: {
      expectedTools: ["Skill"],
      mustStopBy: "final_answer",
      answerMustContain: ["row", "column", "missing"],
      customCheck: (result) => {
        const skillObs = result.observations.find((o) => o.toolName === "Skill" && o.ok);
        const hasBashFromSkill = result.observations.some(
          (o) => o.toolName === "Bash" && o.ok && JSON.stringify(o.output).includes("profile-csv")
        );
        // The embedded shell in csv-profile should run the profiler script.
        // If args were passed correctly, we expect either:
        // 1. Bash was called by embedded shell (ideal), OR
        // 2. The final answer contains actual CSV analysis data
        const answerHasData = /\d+/.test(result.finalAnswer) && result.finalAnswer.toLowerCase().includes("missing");
        return {
          pass: answerHasData,
          reason: `Embedded shell triggered: ${hasBashFromSkill}, answer has CSV data: ${answerHasData}`,
        };
      },
    },
  },

  // ── Test 9: 多轮上下文保持 ──
  {
    name: "multi-turn-context",
    query: "First, read api/package.json and remember its name field. Then read api/src/modules/agent-loop/types.ts and count how many interfaces it defines. Finally, tell me both the name from package.json and the interface count.",
    maxTurns: 5,
    criteria: {
      expectedTools: ["Read"],
      mustStopBy: "final_answer",
      customCheck: (result) => {
        const readCount = result.observations.filter((o) => o.toolName === "Read" && o.ok).length;
        const answer = result.finalAnswer;
        // Should mention both the package name AND a number (interface count)
        const hasName = /datasource|package|api/i.test(answer);
        const hasNumber = /\d+/.test(answer);
        return {
          pass: readCount >= 2 && hasName && hasNumber,
          reason: `Read calls: ${readCount}, mentions name: ${hasName}, has number: ${hasNumber}`,
        };
      },
    },
  },

  // ── Test 10: WebSearch（如果 API key 可用）──
  {
    name: "web-search",
    query: "搜索一下 DeepSeek 最新发布的模型叫什么名字，告诉我结果。",
    maxTurns: 4,
    criteria: {
      expectedTools: ["WebSearch"],
      mustStopBy: "final_answer",
      customCheck: (result) => {
        const hasWebSearch = result.observations.some((o) => o.toolName === "WebSearch" && o.ok);
        const answer = result.finalAnswer.toLowerCase();
        const mentionsModel = answer.includes("deepseek") || answer.includes("模型") || answer.includes("v4");
        return {
          pass: hasWebSearch && mentionsModel,
          reason: `WebSearch executed: ${hasWebSearch}, answer mentions model: ${mentionsModel}`,
        };
      },
    },
  },
];

// ── Main ──

async function main() {
  const filter = process.argv.find((arg) => arg.startsWith("--run="))?.slice(6);
  const tests = filter ? TESTS.filter((t) => t.name.includes(filter)) : TESTS;

  console.log(`════════════════════════════════════════════════════════════`);
  console.log(`Agent Loop E2E Test Suite — ${tests.length} test(s)`);
  console.log(`════════════════════════════════════════════════════════════\n`);

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const test of tests) {
    console.log(`\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`┃ TEST: ${test.name}`);
    console.log(`┃ QUERY: ${test.query}`);
    console.log(`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const result = await runSingleTest(test);

    console.log(`\n${result.pass ? "✅ PASS" : "❌ FAIL"}: ${result.summary}`);
    if (result.details) {
      for (const d of result.details) {
        console.log(`   ${d}`);
      }
    }

    if (result.pass) passed++;
    else if (result.skipped) skipped++;
    else failed++;
  }

  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(`SUMMARY: ${passed} passed, ${failed} failed, ${skipped} skipped / ${tests.length} total`);
  console.log(`════════════════════════════════════════════════════════════\n`);

  process.exit(failed > 0 ? 1 : 0);
}

async function runSingleTest(
  test: E2ETest
): Promise<{ pass: boolean; skipped?: boolean; summary: string; details?: string[] }> {
  const registry = new ToolRegistry();
  for (const tool of buildClaudeCodeBaseSystemTools()) {
    registry.register(tool);
  }
  registerSkillTool(registry, defaultSkillManager);

  const [task] = await db
    .insert(tasks)
    .values({ query: `[e2e] ${test.name}: ${test.query}`, status: "running" })
    .returning({ id: tasks.id });

  const events: AgentLoopEvent[] = [];
  const observations: Array<{ toolName: string; ok: boolean; output?: unknown }> = [];
  let loopStopEvent: Extract<AgentLoopEvent, { type: "loop_stop" }> | undefined;

  try {
    for await (const event of runAgentLoopEvents({
      taskId: task.id,
      query: test.query,
      registry,
      maxTurns: test.maxTurns,
      modelClient: createModelClient(),
    })) {
      events.push(event);
      printEvent(event);

      if (event.type === "tool_observation") {
        observations.push({
          toolName: event.toolName,
          ok: event.ok,
          output: event.observation.output,
        });
      }
      if (event.type === "loop_stop") {
        loopStopEvent = event;
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { pass: false, summary: `Loop crashed: ${msg}` };
  }

  if (!loopStopEvent) {
    return { pass: false, summary: "No loop_stop event" };
  }

  // ── Evaluate criteria ──
  const details: string[] = [];
  const toolCalls = events
    .filter((e): e is Extract<AgentLoopEvent, { type: "tool_call" }> => e.type === "tool_call")
    .map((e) => e.toolName);
  const uniqueTools = Array.from(new Set(toolCalls));

  // 1. expectedTools
  if (test.criteria.expectedTools) {
    for (const tool of test.criteria.expectedTools) {
      const called = uniqueTools.includes(tool);
      details.push(`expected tool "${tool}": ${called ? "called" : "NOT CALLED"}`);
      if (!called) {
        return { pass: false, summary: `Missing expected tool: ${tool}`, details };
      }
    }
  }

  // 2. forbiddenTools
  if (test.criteria.forbiddenTools) {
    for (const tool of test.criteria.forbiddenTools) {
      const called = uniqueTools.includes(tool);
      details.push(`forbidden tool "${tool}": ${called ? "CALLED (violation)" : "not called"}`);
      if (called) {
        return { pass: false, summary: `Forbidden tool called: ${tool}`, details };
      }
    }
  }

  // 3. mustStopBy
  if (test.criteria.mustStopBy) {
    const stoppedCorrectly = loopStopEvent.result.stoppedBy === test.criteria.mustStopBy;
    details.push(`stoppedBy: ${loopStopEvent.result.stoppedBy} (expected: ${test.criteria.mustStopBy})`);
    if (!stoppedCorrectly) {
      return {
        pass: false,
        summary: `Stopped by ${loopStopEvent.result.stoppedBy}, expected ${test.criteria.mustStopBy}`,
        details,
      };
    }
  }

  // 4. answerMustContain
  const answer = loopStopEvent.result.finalAnswer;
  if (test.criteria.answerMustContain) {
    for (const substr of test.criteria.answerMustContain) {
      const contains = answer.toLowerCase().includes(substr.toLowerCase());
      details.push(`answer contains "${substr}": ${contains}`);
      if (!contains) {
        return { pass: false, summary: `Answer missing expected content: "${substr}"`, details };
      }
    }
  }

  // 5. answerMustMatch
  if (test.criteria.answerMustMatch) {
    const matches = test.criteria.answerMustMatch.test(answer);
    details.push(`answer matches ${test.criteria.answerMustMatch}: ${matches}`);
    if (!matches) {
      return { pass: false, summary: `Answer does not match required pattern`, details };
    }
  }

  // 6. customCheck
  if (test.criteria.customCheck) {
    const custom = test.criteria.customCheck({
      finalAnswer: answer,
      observations,
      turns: loopStopEvent.result.turns,
      events,
    });
    details.push(`custom check: ${custom.pass ? "PASS" : "FAIL"} — ${custom.reason}`);
    if (!custom.pass) {
      return { pass: false, summary: `Custom check failed: ${custom.reason}`, details };
    }
  }

  details.push(`turns: ${loopStopEvent.result.turns}/${test.maxTurns}`);
  details.push(`tools called: [${uniqueTools.join(", ")}]`);

  return { pass: true, summary: "All criteria met", details };
}

function printEvent(event: AgentLoopEvent): void {
  switch (event.type) {
    case "agent_turn":
      console.log(`\n─── Turn ${event.turn}/${event.maxTurns} ───`);
      break;
    case "tool_calls":
      console.log(`  → Tool calls (${event.count}): ${event.tools.join(", ")}`);
      break;
    case "tool_call":
      console.log(`    → ${event.toolName} (id=${event.toolCallId.slice(0, 20)}...)`);
      break;
    case "tool_observation": {
      const obs = event.observation;
      const out = obs.output as Record<string, unknown> | undefined;
      if (obs.ok) {
        if (obs.toolName === "Skill") {
          console.log(
            `    ← ${obs.toolName} OK: name=${out?.commandName}, chars=${out?.contentChars}, status=${out?.status}`
          );
        } else if (obs.toolName === "Bash") {
          const stdout = String(out?.stdout ?? "").slice(0, 100).replace(/\n/g, "\\n");
          console.log(`    ← ${obs.toolName} OK: exit=${out?.exitCode}, stdout: ${stdout}...`);
        } else if (obs.toolName === "Read") {
          const content = String(out?.content ?? "").slice(0, 80).replace(/\n/g, "\\n");
          console.log(`    ← ${obs.toolName} OK: ${out?.filePath} (${out?.totalLines} lines) "${content}..."`);
        } else if (obs.toolName === "WebSearch") {
          const results = Array.isArray(out?.results) ? out.results.length : 0;
          console.log(`    ← ${obs.toolName} OK: ${results} results`);
        } else if (obs.toolName === "TodoWrite") {
          const stored = (out?.storedTodos as Array<unknown>)?.length ?? 0;
          console.log(`    ← ${obs.toolName} OK: ${stored} todos stored`);
        } else {
          console.log(`    ← ${obs.toolName} OK`);
        }
      } else {
        console.log(`    ← ${obs.toolName} FAILED: ${obs.error?.code} — ${obs.error?.message}`);
      }
      break;
    }
    case "assistant_message": {
      const msg = event.message;
      if (msg.toolCalls?.length) {
        const names = msg.toolCalls.map((tc) => tc.toolName).join(", ");
        console.log(`  Assistant: [calling ${names}]`);
      } else {
        const text = msg.content.slice(0, 150).replace(/\n/g, "\\n");
        console.log(`  Assistant: "${text}${msg.content.length > 150 ? "..." : ""}"`);
      }
      break;
    }
    case "loop_stop":
      console.log(`\n  LOOP STOP: ${event.result.stoppedBy} (turn ${event.turn})`);
      break;
  }
}

main().catch((err) => {
  console.error("[e2e-suite] fatal:", err);
  process.exit(1);
});
