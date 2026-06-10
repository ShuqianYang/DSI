import "dotenv/config";
import { db } from "../../src/config/database.js";
import { tasks } from "../../src/db/schema.js";
import { runAgentLoopEvents } from "../../src/modules/agent-loop/runAgentLoop.js";
import { buildSystemTools } from "../../src/modules/agent-loop/tools/system/index.js";
import { ToolRegistry } from "../../src/modules/agent-loop/tools/_shared/toolRegistry.js";
import type { AgentLoopEvent } from "../../src/modules/agent-loop/tools/_shared/types.js";
import { defaultSkillManager, registerSkillTool } from "../../src/modules/agent-loop/skillManager.js";
import { createModelClient } from "../../src/modules/agent-loop/modelClient.js";

interface E2ETest {
  name: string;
  query: string;
  maxTurns: number;
}

const TESTS: E2ETest[] = [
  {
    name: "csv-profile",
    query:
      "帮我分析一下 skills/csv-profile/assets/sample-incidents.csv 这个文件的数据概况",
    maxTurns: 5,
  },
  {
    name: "conventional-commit",
    query:
      '我最近改动了 agent loop 的 skill manager，修复了 skillAllowedToolNames 永久锁定的问题（加了过期机制），还有 force reload 的逻辑。帮我写个符合 conventional commit 规范的 commit message。',
    maxTurns: 5,
  },
];

async function main() {
  const filter = process.argv.find((arg) => arg.startsWith("--run="))?.slice(6);
  const tests = filter ? TESTS.filter((t) => t.name.includes(filter)) : TESTS;

  console.log(`Running ${tests.length} E2E skill test(s) with real LLM…\n`);

  for (const test of tests) {
    console.log(`════════════════════════════════════════════════════════════`);
    console.log(`TEST: ${test.name}`);
    console.log(`QUERY: ${test.query}`);
    console.log(`MAX_TURNS: ${test.maxTurns}`);
    console.log(`════════════════════════════════════════════════════════════\n`);

    const result = await runE2ETest(test);
    console.log(`\n${"─".repeat(60)}`);
    if (result.ok) {
      console.log(`✅ RESULT: ${result.summary}`);
    } else {
      console.log(`❌ RESULT: ${result.summary}`);
    }
    console.log(`${"─".repeat(60)}\n`);
  }
}

async function runE2ETest(
  test: E2ETest
): Promise<{ ok: boolean; summary: string }> {
  const registry = new ToolRegistry();
  for (const tool of buildSystemTools()) {
    registry.register(tool);
  }
  registerSkillTool(registry, defaultSkillManager);

  const [task] = await db
    .insert(tasks)
    .values({ query: test.query, status: "running" })
    .returning({ id: tasks.id });

  const events: AgentLoopEvent[] = [];
  let loopStopEvent: Extract<AgentLoopEvent, { type: "loop_stop" }> | undefined;
  let skillWasLoaded = false;
  let skillToolCalled = false;
  let finalAnswer = "";

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

      if (event.type === "tool_call" && event.toolName === "Skill") {
        skillToolCalled = true;
      }
      if (event.type === "tool_observation" && event.toolName === "Skill" && event.ok) {
        skillWasLoaded = true;
      }
      if (event.type === "loop_stop") {
        loopStopEvent = event;
        finalAnswer = event.result.finalAnswer;
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, summary: `Loop crashed: ${msg}` };
  }

  if (!loopStopEvent) {
    return { ok: false, summary: "No loop_stop event" };
  }

  // Build summary
  const parts: string[] = [];
  parts.push(`stoppedBy=${loopStopEvent.result.stoppedBy}, turns=${loopStopEvent.result.turns}`);

  const observations = loopStopEvent.result.observations;
  const toolCalls = observations.map((o) => o.toolName);
  parts.push(`tools used: [${toolCalls.join(", ")}]`);
  parts.push(`Skill tool called: ${skillToolCalled}`);
  parts.push(`Skill loaded successfully: ${skillWasLoaded}`);

  const skillObs = observations.find((o) => o.toolName === "Skill" && o.ok);
  if (skillObs) {
    const output = skillObs.output as Record<string, unknown>;
    parts.push(`Skill name: ${output.commandName}, status: ${output.status}, contentChars: ${output.contentChars}`);
  }

  // Reasonableness check
  const answer = finalAnswer.toLowerCase();
  let reasonable = false;

  if (test.name.includes("csv-profile")) {
    // Should mention CSV analysis results (rows, columns, missing values, etc.)
    reasonable =
      answer.includes("row") ||
      answer.includes("column") ||
      answer.includes("csv") ||
      answer.includes("missing") ||
      answer.includes("数据") ||
      answer.includes("行") ||
      answer.includes("列");
  } else if (test.name.includes("conventional-commit")) {
    // Should look like a conventional commit message
    reasonable =
      /^\s*(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)\s*[\(:]/im.test(
        finalAnswer
      );
  }

  parts.push(`final answer reasonable: ${reasonable}`);

  const ok =
    skillToolCalled &&
    skillWasLoaded &&
    loopStopEvent.result.stoppedBy === "final_answer" &&
    reasonable;

  return { ok, summary: parts.join(" | ") };
}

function printEvent(event: AgentLoopEvent): void {
  switch (event.type) {
    case "agent_turn":
      console.log(`\n[Turn ${event.turn}/${event.maxTurns}]`);
      break;
    case "tool_calls":
      console.log(`  → Tool calls (${event.count}): ${event.tools.join(", ")}`);
      break;
    case "tool_call":
      console.log(`    → ${event.toolName} (id=${event.toolCallId})`);
      break;
    case "tool_observation": {
      const obs = event.observation;
      if (obs.ok) {
        const out = obs.output as Record<string, unknown>;
        if (obs.toolName === "Skill") {
          console.log(
            `    ← ${obs.toolName} OK: name=${out.commandName}, chars=${out.contentChars}, status=${out.status}`
          );
        } else if (obs.toolName === "Bash") {
          console.log(
            `    ← ${obs.toolName} OK: exit=${out.exitCode}, stdout preview: ${String(out.stdout).slice(0, 120)}...`
          );
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
        console.log(`  Assistant: [requests ${msg.toolCalls.length} tool call(s)]`);
      } else {
        console.log(`  Assistant: ${msg.content.slice(0, 200)}${msg.content.length > 200 ? "..." : ""}`);
      }
      break;
    }
    case "loop_stop":
      console.log(`\n  LOOP STOP: ${event.result.stoppedBy} (turn ${event.turn})`);
      console.log(`  Final answer: ${event.result.finalAnswer.slice(0, 300)}${event.result.finalAnswer.length > 300 ? "..." : ""}`);
      break;
  }
}

main().catch((err) => {
  console.error("[e2e] fatal:", err);
  process.exit(1);
});
