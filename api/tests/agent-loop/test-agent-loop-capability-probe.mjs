import { config as loadEnv } from "dotenv";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

// Load api/.env regardless of the current working directory.
loadEnv({ path: new URL("../../.env", import.meta.url) });

/**
 * Capability probe suite for the agent-loop.
 *
 * Runs real user queries through runAgentLoopEvents with the production model
 * client and tool registry, then checks basic health criteria.
 *
 * Usage:
 *   tsx api/tests/agent-loop/test-agent-loop-capability-probe.mjs
 *   tsx api/tests/agent-loop/test-agent-loop-capability-probe.mjs --category=ais
 *   tsx api/tests/agent-loop/test-agent-loop-capability-probe.mjs --run=basic-read
 *   tsx api/tests/agent-loop/test-agent-loop-capability-probe.mjs --dry-run
 */

const TEST_CASES = [
  // AIS / 海事
  {
    name: "ais-region-count-and-list",
    category: "ais",
    query: "东海近 24 小时内有多少艘集装箱船？列出 MMSI、船速和当前位置。",
    maxTurns: 6,
    criteria: {
      expectedTools: ["Skill"],
      expectedSkills: ["ais-region-query"],
      mustStopBy: "final_answer",
      answerNonEmpty: true,
    },
  },
  {
    name: "ais-port-comparison-topn",
    category: "ais",
    query: "对比舟山港和宁波港当前停泊船舶数量，并告诉我吨位最大的船是哪艘。",
    maxTurns: 6,
    criteria: {
      expectedTools: ["Skill"],
      expectedSkills: ["ais-region-query"],
      mustStopBy: "final_answer",
      answerNonEmpty: true,
    },
  },
  {
    name: "ais-filter-sort",
    category: "ais",
    query: "找出南海所有航速超过 15 节的油轮，并按速度从高到低排序。",
    maxTurns: 6,
    criteria: {
      expectedTools: ["Skill"],
      expectedSkills: ["ais-region-query"],
      mustStopBy: "final_answer",
      answerNonEmpty: true,
    },
  },
  {
    name: "ais-vessel-track",
    category: "ais",
    query: "我关注的一艘船 MMSI 为 123456789，它现在在哪？过去 1 小时轨迹如何？",
    maxTurns: 6,
    criteria: {
      expectedTools: ["Skill"],
      expectedSkills: ["ais-region-query"],
      mustStopBy: "final_answer",
      answerNonEmpty: true,
    },
  },
  {
    name: "ais-prediction-verify",
    category: "ais",
    query: "如果一艘船从青岛以 12 节速度向北航行 2 小时，大概会在哪？用 AIS 数据验证。",
    maxTurns: 8,
    criteria: {
      expectedTools: ["Skill"],
      expectedSkills: ["ais-region-query"],
      mustStopBy: "final_answer",
      answerNonEmpty: true,
    },
  },

  // Aircraft / 航空
  {
    name: "aircraft-airport-low-altitude",
    category: "aircraft",
    query: "北京首都机场附近当前有多少架飞机？高度低于 10000 英尺的有哪些？",
    maxTurns: 6,
    criteria: {
      expectedTools: ["Skill"],
      expectedSkills: ["aircraft-region-query"],
      mustStopBy: "final_answer",
      answerNonEmpty: true,
    },
  },
  {
    name: "aircraft-route-density",
    category: "aircraft",
    query: "上海飞广州航路上现在最繁忙的航段是哪里？列出经过的飞机呼号。",
    maxTurns: 6,
    criteria: {
      expectedTools: ["Skill"],
      expectedSkills: ["aircraft-region-query"],
      mustStopBy: "final_answer",
      answerNonEmpty: true,
    },
  },
  {
    name: "aircraft-filter-sort",
    category: "aircraft",
    query: "华北地区速度超过 400 节的民航客机有哪些？按飞行高度排序。",
    maxTurns: 6,
    criteria: {
      expectedTools: ["Skill"],
      expectedSkills: ["aircraft-region-query"],
      mustStopBy: "final_answer",
      answerNonEmpty: true,
    },
  },
  {
    name: "aircraft-airport-density-compare",
    category: "aircraft",
    query: "对比浦东和虹桥机场上空的航班密度，哪个更忙？",
    maxTurns: 6,
    criteria: {
      expectedTools: ["Skill"],
      expectedSkills: ["aircraft-region-query"],
      mustStopBy: "final_answer",
      answerNonEmpty: true,
    },
  },
  {
    name: "aircraft-flight-track",
    category: "aircraft",
    query: "航班号 CA1234 的波音 737 现在位置在哪？预计几分钟后降落？",
    maxTurns: 6,
    criteria: {
      expectedTools: ["Skill"],
      expectedSkills: ["aircraft-region-query"],
      mustStopBy: "final_answer",
      answerNonEmpty: true,
    },
  },

  // Disaster / 灾害
  {
    name: "disaster-earthquake-list",
    category: "disaster",
    query: "最近一周中国境内发生了哪些地震？标出震级大于 5 级的位置。",
    maxTurns: 6,
    criteria: {
      expectedTools: ["Skill"],
      expectedSkills: ["disaster-satellite-query"],
      mustStopBy: "final_answer",
      answerNonEmpty: true,
    },
  },
  {
    name: "disaster-typhoon-path",
    category: "disaster",
    query: "台风“格美”最新路径是什么？可能影响的沿海城市有哪些？",
    maxTurns: 6,
    criteria: {
      expectedTools: ["Skill"],
      expectedSkills: ["disaster-satellite-query"],
      mustStopBy: "final_answer",
      answerNonEmpty: true,
    },
  },
  {
    name: "disaster-flood-satellite-compare",
    category: "disaster",
    query: "请提供最近一次洪水灾区的灾前灾后卫星影像对比，并估算受损面积。",
    maxTurns: 10,
    criteria: {
      expectedTools: ["Skill"],
      expectedSkills: ["disaster-satellite-query"],
      mustStopBy: "final_answer",
      answerNonEmpty: true,
    },
  },
  {
    name: "disaster-wildfire-spread",
    category: "disaster",
    query: "云南某地森林火灾的火点位置和蔓延方向如何？",
    maxTurns: 8,
    criteria: {
      expectedTools: ["Skill"],
      expectedSkills: ["disaster-satellite-query"],
      mustStopBy: "final_answer",
      answerNonEmpty: true,
    },
  },
  {
    name: "disaster-earthquake-damage",
    category: "disaster",
    query: "四川泸定地震后，通过卫星影像识别道路中断和建筑物损毁情况。",
    maxTurns: 10,
    criteria: {
      expectedTools: ["Skill"],
      expectedSkills: ["disaster-satellite-query"],
      mustStopBy: "final_answer",
      answerNonEmpty: true,
    },
  },

  // Broad / 不命中已有 skill
  {
    name: "broad-weather-forecast",
    category: "broad",
    query: "纽约未来 3 天天气预报和穿衣建议是什么？",
    maxTurns: 4,
    criteria: {
      forbiddenTools: ["Skill"],
      mustStopBy: "final_answer",
      answerNonEmpty: true,
    },
  },
  {
    name: "broad-python-quicksort",
    category: "broad",
    query: "用 Python 写一个快速排序，并解释时间复杂度。",
    maxTurns: 3,
    criteria: {
      forbiddenTools: ["Skill"],
      mustStopBy: "final_answer",
      answerNonEmpty: true,
    },
  },
  {
    name: "broad-stock-research",
    category: "broad",
    query: "特斯拉最新财报有哪些 highlights？对股价可能有什么影响？",
    maxTurns: 5,
    criteria: {
      expectedTools: ["WebSearch"],
      forbiddenTools: ["Skill"],
      mustStopBy: "final_answer",
      answerNonEmpty: true,
    },
  },
  {
    name: "broad-math-derivation",
    category: "broad",
    query: "如果地球半径增大 10%，表面积和体积分别变化多少？给出推导。",
    maxTurns: 3,
    criteria: {
      forbiddenTools: ["Skill"],
      mustStopBy: "final_answer",
      answerNonEmpty: true,
    },
  },
  {
    name: "broad-sailing-weather",
    category: "broad",
    query: "请给我一份从青岛到大连的帆船航行建议，结合未来几天的天气和海况。",
    maxTurns: 5,
    criteria: {
      forbiddenTools: ["Skill"],
      mustStopBy: "final_answer",
      answerNonEmpty: true,
    },
  },
  {
    name: "broad-travel-plan",
    category: "broad",
    query: "帮我规划一次 7 天云南自由行，包含昆明、大理、丽江，预算 5000 元。",
    maxTurns: 5,
    criteria: {
      forbiddenTools: ["Skill"],
      mustStopBy: "final_answer",
      answerNonEmpty: true,
    },
  },
];

function parseOptions(argv) {
  const options = {
    category: "",
    run: "",
    dryRun: false,
    help: false,
    maxTurnsOverride: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("--category=")) {
      options.category = arg.slice(11);
    } else if (arg.startsWith("--run=")) {
      options.run = arg.slice(6);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg.startsWith("--max-turns=")) {
      options.maxTurnsOverride = Number(arg.slice(12));
    } else {
      console.warn(`Ignoring unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Agent Loop Capability Probe

Usage:
  tsx api/tests/agent-loop/test-agent-loop-capability-probe.mjs [options]

Options:
  --category=<ais|aircraft|disaster|broad>  Run only one category
  --run=<name>                              Run a single test by name (substring match)
  --max-turns=<n>                           Override max turns for all tests
  --dry-run                                 List tests without executing
  -h, --help                                Show this help

Examples:
  tsx api/tests/agent-loop/test-agent-loop-capability-probe.mjs --category=ais
  tsx api/tests/agent-loop/test-agent-loop-capability-probe.mjs --run=earthquake
`);
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  let filtered = TEST_CASES;
  if (options.category) {
    filtered = filtered.filter((t) => t.category === options.category);
    assert(filtered.length > 0, `No tests match category: ${options.category}`);
  }
  if (options.run) {
    filtered = filtered.filter((t) => t.name.includes(options.run));
    assert(filtered.length > 0, `No tests match --run=${options.run}`);
  }

  if (options.dryRun) {
    console.log(`Dry run: ${filtered.length} test(s)`);
    for (const t of filtered) {
      console.log(`  [${t.category}] ${t.name}: ${t.query}`);
    }
    return;
  }

  assert(process.env.DATABASE_URL, "DATABASE_URL must be set");
  assert(process.env.DEEPSEEK_API_KEY, "DEEPSEEK_API_KEY must be set for real model tests");

  // Runtime imports are deferred until after --dry-run so the test list can be
  // inspected without a database connection.
  const { runAgentLoopEvents } = await import("../../src/modules/agent-loop/runAgentLoop.js");
  const { createModelClient } = await import("../../src/modules/agent-loop/modelClient.js");
  const { buildDefaultToolRegistry } = await import("../../src/modules/agent-loop/tools/_shared/toolRegistry.js");
  const { defaultSkillManager, registerSkillTool } = await import("../../src/modules/agent-loop/skillManager.js");
  const { db } = await import("../../src/config/database.js");
  const { tasks, taskSteps } = await import("../../src/db/schema.js");

  const registry = buildDefaultToolRegistry();
  registerSkillTool(registry, defaultSkillManager);
  const modelClient = createModelClient();

  console.log(`════════════════════════════════════════════════════════════`);
  console.log(`Agent Loop Capability Probe — ${filtered.length} test(s)`);
  console.log(`Model: ${process.env.DEEPSEEK_MODEL || "deepseek-v4-flash"}`);
  console.log(`════════════════════════════════════════════════════════════\n`);

  let passed = 0;
  let failed = 0;
  const results = [];

  for (const test of filtered) {
    const start = Date.now();
    const result = await runTest(test, {
      db,
      tasks,
      taskSteps,
      runAgentLoopEvents,
      modelClient,
      registry,
      maxTurnsOverride: options.maxTurnsOverride,
    });
    const duration = Date.now() - start;
    results.push({ test, result, duration });

    const status = result.pass ? "✅ PASS" : "❌ FAIL";
    console.log(`\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`┃ ${status} [${test.category}] ${test.name} (${duration}ms)`);
    console.log(`┃ QUERY: ${test.query}`);
    console.log(`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    if (result.details?.length) {
      for (const d of result.details) console.log(`   ${d}`);
    }
    if (!result.pass && result.error) {
      console.log(`   ERROR: ${result.error}`);
    }
    if (result.summary) {
      console.log(`   SUMMARY: ${result.summary}`);
    }
    if (result.finalAnswer) {
      const snippet = result.finalAnswer.replace(/\n/g, " ").slice(0, 200);
      console.log(`   ANSWER: ${snippet}${result.finalAnswer.length > 200 ? "..." : ""}`);
    }

    if (result.pass) passed += 1;
    else failed += 1;
  }

  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(`SUMMARY: ${passed} passed, ${failed} failed / ${filtered.length} total`);
  console.log(`════════════════════════════════════════════════════════════\n`);

  const report = {
    generatedAt: new Date().toISOString(),
    total: filtered.length,
    passed,
    failed,
    results: results.map(({ test, result, duration }) => ({
      name: test.name,
      category: test.category,
      query: test.query,
      durationMs: duration,
      pass: result.pass,
      stoppedBy: result.stoppedBy,
      turns: result.turns,
      tools: result.tools,
      skills: result.skills,
      summary: result.summary,
      error: result.error,
      finalAnswer: result.finalAnswer,
    })),
  };
  console.log(`REPORT_JSON_START`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`REPORT_JSON_END`);

  process.exit(failed > 0 ? 1 : 0);
}

async function runTest(test, runtime) {
  const { db, tasks, taskSteps, runAgentLoopEvents, modelClient, registry, maxTurnsOverride } = runtime;

  const taskId = crypto.randomUUID();
  const query = test.query;
  const maxTurns = maxTurnsOverride ?? test.maxTurns;

  const result = {
    pass: false,
    stoppedBy: null,
    turns: 0,
    tools: [],
    skills: [],
    finalAnswer: "",
    details: [],
    summary: "",
    error: null,
  };

  await db.insert(tasks).values({ id: taskId, query: `[capability-probe] ${test.name}: ${query}`, status: "running" });

  try {
    const events = [];
    let loopStopEvent;
    const handleEvent = (event) => {
      events.push(event);
    };

    for await (const event of runAgentLoopEvents({
      taskId,
      query,
      registry,
      modelClient,
      maxTurns,
      fileLogger: false,
      permissionHandler: createAllowAllPermissionHandler(),
      onToolProgress: (progressEvent) => {
        handleEvent(progressEvent);
        printEvent(progressEvent);
      },
    })) {
      handleEvent(event);
      printEvent(event);

      if (event.type === "loop_stop") {
        loopStopEvent = event;
      }
    }

    if (!loopStopEvent) {
      result.summary = "No loop_stop event received";
      return result;
    }

    result.stoppedBy = loopStopEvent.result.stoppedBy;
    result.turns = loopStopEvent.result.turns;
    result.finalAnswer = loopStopEvent.result.finalAnswer ?? "";

    const toolCalls = events
      .filter((e) => e.type === "tool_call")
      .map((e) => ({ toolName: e.toolName, input: e.input }));
    result.tools = Array.from(new Set(toolCalls.map((t) => t.toolName)));

    const skillCalls = toolCalls.filter((t) => t.toolName === "Skill");
    result.skills = skillCalls.map((t) => t.input?.skill).filter(Boolean);

    return evaluateTest(test, result);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.summary = `Loop crashed: ${result.error}`;
    return result;
  } finally {
    await db.delete(taskSteps).where(eq(taskSteps.taskId, taskId));
    await db.delete(tasks).where(eq(tasks.id, taskId));
  }
}

function evaluateTest(test, result) {
  const details = [];
  const criteria = test.criteria;

  if (criteria.mustStopBy) {
    const ok = result.stoppedBy === criteria.mustStopBy;
    details.push(`stoppedBy: ${result.stoppedBy} (expected ${criteria.mustStopBy}): ${ok ? "ok" : "FAIL"}`);
    if (!ok) {
      result.details = details;
      result.summary = `Stopped by ${result.stoppedBy}, expected ${criteria.mustStopBy}`;
      return result;
    }
  }

  if (criteria.expectedTools?.length) {
    for (const tool of criteria.expectedTools) {
      const called = result.tools.includes(tool);
      details.push(`expected tool "${tool}": ${called ? "called" : "NOT CALLED"}`);
      if (!called) {
        result.details = details;
        result.summary = `Missing expected tool: ${tool}`;
        return result;
      }
    }
  }

  if (criteria.expectedSkills?.length) {
    for (const skill of criteria.expectedSkills) {
      const called = result.skills.includes(skill);
      details.push(`expected skill "${skill}": ${called ? "invoked" : "NOT INVOKED"}`);
      if (!called) {
        result.details = details;
        result.summary = `Missing expected skill invocation: ${skill}`;
        return result;
      }
    }
  }

  if (criteria.forbiddenTools?.length) {
    for (const tool of criteria.forbiddenTools) {
      const called = result.tools.includes(tool);
      details.push(`forbidden tool "${tool}": ${called ? "CALLED (violation)" : "not called"}`);
      if (called) {
        result.details = details;
        result.summary = `Forbidden tool called: ${tool}`;
        return result;
      }
    }
  }

  if (criteria.answerNonEmpty) {
    const ok = typeof result.finalAnswer === "string" && result.finalAnswer.trim().length > 0;
    details.push(`answer non-empty: ${ok ? "ok" : "FAIL"}`);
    if (!ok) {
      result.details = details;
      result.summary = "Final answer is empty";
      return result;
    }
  }

  result.pass = true;
  result.details = details;
  result.summary = "All criteria met";
  return result;
}

function printEvent(event) {
  switch (event.type) {
    case "agent_turn":
      console.log(`\n─── Turn ${event.turn}/${event.maxTurns} ───`);
      break;
    case "tool_calls":
      console.log(`  → Tool calls (${event.count}): ${event.tools.join(", ")}`);
      break;
    case "tool_call":
      console.log(`    → ${event.toolName} (id=${event.toolCallId.slice(0, 24)}...)`);
      break;
    case "tool_observation": {
      const obs = event.observation;
      if (obs.ok) {
        if (obs.toolName === "Skill") {
          const out = obs.output || {};
          console.log(`    ← Skill OK: skill=${out.skillName || out.commandName || "?"}`);
        } else if (obs.toolName === "SqlQuery") {
          const rows = obs.output?.returnedRows ?? "?";
          console.log(`    ← SqlQuery OK: returnedRows=${rows}`);
        } else if (obs.toolName === "WebSearch") {
          const n = Array.isArray(obs.output?.results) ? obs.output.results.length : "?";
          console.log(`    ← WebSearch OK: ${n} results`);
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
        const text = String(msg.content).slice(0, 120).replace(/\n/g, "\\n");
        console.log(`  Assistant: "${text}${msg.content.length > 120 ? "..." : ""}"`);
      }
      break;
    }
    case "loop_stop":
      console.log(`\n  LOOP STOP: ${event.result.stoppedBy} (turn ${event.turn})`);
      break;
  }
}

function createAllowAllPermissionHandler() {
  return async () => "allow";
}

main().catch((err) => {
  console.error("[capability-probe] fatal:", err);
  process.exit(1);
});
