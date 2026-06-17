import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  createGisToolchainSmokeModelClient,
  GIS_TOOLCHAIN_QUERY,
  GIS_TOOLCHAIN_SCENARIO,
  GIS_TOOLCHAIN_TOOLS,
  installMockOpenMeteoFetch,
  validateGisToolchainSmoke,
} from "./agent-loop-smoke-gis.js";
import {
  createDailyReportSmokeModelClient,
  DAILY_REPORT_QUERY,
  DAILY_REPORT_SCENARIO,
  DAILY_REPORT_TOOLS,
  installMockDailyReportFetch,
  validateDailyReportSmoke,
} from "./agent-loop-smoke-daily-report.js";
import { buildDefaultToolRegistry, ToolRegistry } from "../../src/modules/agent-loop/tools/_shared/toolRegistry.js";
import type {
  AgentLoopEvent,
  AgentLoopResult,
  AgentMessage,
  ToolPermissionHandler,
} from "../../src/modules/agent-loop/tools/_shared/types.js";

const DEFAULT_QUERY =
  "Use read-only tools to inspect the api/src/modules/agent-loop directory and summarize its core files.";
const PREVIEW_CHARS = Number.parseInt(process.env.AGENT_LOOP_SMOKE_PREVIEW_CHARS ?? "8000", 10);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const query =
    options.query ||
    (options.scenario === GIS_TOOLCHAIN_SCENARIO
      ? GIS_TOOLCHAIN_QUERY
      : options.scenario === DAILY_REPORT_SCENARIO
        ? DAILY_REPORT_QUERY
        : DEFAULT_QUERY);

  if (options.refreshOpenSky) {
    process.env.AGENT_SQL_ALLOWED_SCHEMAS ||= JSON.stringify({ default: ["public"] });
    const { ingestOpenSkySnapshotOnce } = await import("../../src/modules/opensky/ingestion.js");
    console.log("[smoke] refreshing OpenSky aircraft_current_states...");
    const result = await ingestOpenSkySnapshotOnce();
    console.log(
      `[smoke] OpenSky refreshed: fetched=${result.fetchedCount} inserted=${result.insertedCount}`,
    );
  }

  const registry = buildSelectedRegistry(options.tools);
  const smokeDb = await loadSmokeDb();
  const { runAgentLoopEvents } = await import("../../src/modules/agent-loop/runAgentLoop.js");
  const { buildAgentLoopTaskResult } = await import("../../src/modules/tasks/agentLoopResultProjection.js");
  const taskId = await createSmokeTask(smokeDb, query);
  const permissionHandler = createCliPermissionHandler();
  const rawEvents: AgentLoopEvent[] = [];
  const modelClient =
    !options.realModel && options.scenario === GIS_TOOLCHAIN_SCENARIO
      ? createGisToolchainSmokeModelClient()
      : !options.realModel && options.scenario === DAILY_REPORT_SCENARIO
        ? createDailyReportSmokeModelClient()
        : undefined;
  const restoreWeatherMock =
    options.mockWeather && options.scenario === GIS_TOOLCHAIN_SCENARIO
      ? installMockOpenMeteoFetch()
      : undefined;
  const restoreDailyReportMock =
    options.mockApi && options.scenario === DAILY_REPORT_SCENARIO
      ? installMockDailyReportFetch({ reportContent: options.mockReportContent })
      : undefined;

  console.log(`[smoke] taskId=${taskId}`);
  console.log(`[smoke] query=${query}`);
  console.log(`[smoke] tools=${registry.list().map((tool) => tool.name).join(", ")}`);
  if (options.scenario) console.log(`[smoke] scenario=${options.scenario}`);
  if (modelClient) {
    console.log(
      `[smoke] model=fake-${options.scenario === GIS_TOOLCHAIN_SCENARIO ? "gis-toolchain" : options.scenario === DAILY_REPORT_SCENARIO ? "daily-report" : "unknown"}`
    );
  }
  if (options.realModel) console.log("[smoke] model=real");
  if (restoreWeatherMock) console.log("[smoke] weather=mock-open-meteo");
  if (restoreDailyReportMock) console.log("[smoke] daily-report=mock-api");
  console.log("");

  let finalSeen = false;
  let loopResult: AgentLoopResult | undefined;
  const handleEvent = (event: AgentLoopEvent) => {
    rawEvents.push(event);
  };

  try {
    for await (const event of runAgentLoopEvents({
      taskId,
      query,
      registry,
      maxTurns: options.maxTurns,
      ...(modelClient ? { modelClient } : {}),
      permissionHandler,
      onToolProgress: (event) => {
        handleEvent(event);
        printEvent(event, options);
      },
    })) {
      handleEvent(event);
      printEvent(event, options);
      if (event.type === "loop_stop") {
        finalSeen = true;
        loopResult = event.result;
        const result =
          options.scenario === GIS_TOOLCHAIN_SCENARIO || options.scenario === DAILY_REPORT_SCENARIO
            ? buildAgentLoopTaskResult(event.result)
            : event.result;
        await smokeDb.db
          .update(smokeDb.tasks)
          .set({
            status:
              event.result.stoppedBy === "final_answer" || event.result.stoppedBy === "max_turns"
                ? "completed"
                : "failed",
            result,
            error:
              event.result.stoppedBy === "model_error" || event.result.stoppedBy === "aborted"
                ? event.result.finalAnswer
                : null,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(smokeDb.eq(smokeDb.tasks.id, taskId));
      }
    }
  } finally {
    restoreWeatherMock?.();
    restoreDailyReportMock?.();
    if (!finalSeen) {
      await smokeDb.db
        .update(smokeDb.tasks)
        .set({
          status: "failed",
          error: "Smoke runner exited before loop_stop.",
          updatedAt: new Date(),
        })
        .where(smokeDb.eq(smokeDb.tasks.id, taskId));
    }
  }

  if (options.scenario === GIS_TOOLCHAIN_SCENARIO && loopResult) {
    const report = validateGisToolchainSmoke({
      rawEvents,
      projectedResult: buildAgentLoopTaskResult(loopResult),
    });
    console.log("");
    console.log("[gis-smoke] validation passed");
    console.log(`[gis-smoke] raw tools: ${report.toolOrder.join(" -> ")}`);
    console.log(
      `[gis-smoke] task.result projection: region=${report.projectedRegionGisData} wind-field=${report.projectedWindFieldGisData}`,
    );
  }

  if (options.scenario === DAILY_REPORT_SCENARIO && loopResult) {
    const report = validateDailyReportSmoke({
      rawEvents,
      projectedResult: buildAgentLoopTaskResult(loopResult),
    });
    console.log("");
    console.log("[daily-report-smoke] validation passed");
    console.log(`[daily-report-smoke] raw tools: ${report.toolOrder.join(" -> ")}`);
    console.log(
      `[daily-report-smoke] date=${report.date} reportType=${report.reportType} contentLength=${report.contentLength}`,
    );
  }
}

function buildSelectedRegistry(names: string[] | undefined): ToolRegistry {
  const defaultRegistry = buildDefaultToolRegistry();
  if (!names || names.length === 0) {
    return defaultRegistry;
  }

  const selected = new Set(names);
  const registry = new ToolRegistry();
  for (const tool of defaultRegistry.list()) {
    if (selected.has(tool.name)) {
      registry.register(tool);
    }
  }

  const registered = new Set(registry.list().map((tool) => tool.name));
  const missing = names.filter((name) => !registered.has(name));
  if (missing.length > 0) {
    throw new Error(`Unknown smoke tool(s): ${missing.join(", ")}`);
  }

  return registry;
}

async function createSmokeTask(smokeDb: Awaited<ReturnType<typeof loadSmokeDb>>, query: string): Promise<string> {
  const [task] = await smokeDb.db
    .insert(smokeDb.tasks)
    .values({
      query,
      status: "running",
    })
    .returning({ id: smokeDb.tasks.id });
  return task.id;
}

async function loadSmokeDb() {
  const [{ eq }, { db }, { tasks }] = await Promise.all([
    import("drizzle-orm"),
    import("../../src/config/database.js"),
    import("../../src/db/schema.js"),
  ]);
  return { eq, db, tasks };
}

function createCliPermissionHandler(): ToolPermissionHandler {
  const readline = createInterface({ input, output });
  return async (request) => {
    if (!input.isTTY) {
      console.log(
        `[permission] ${request.toolName}: ${request.message} Non-interactive stdin; denying.`,
      );
      return "deny";
    }

    console.log("\n--- permission_required ---");
    console.log(`tool=${request.toolName}`);
    console.log(`message=${request.message}`);
    console.log(`input=${preview(JSON.stringify(request.input, null, 2), 2_000)}`);
    const answer = await readline.question("Allow this tool call? [y/N] ");
    return answer.trim().toLowerCase() === "y" ? "allow" : "deny";
  };
}

function printEvent(event: AgentLoopEvent, options: SmokeOptions): void {
  switch (event.type) {
    case "agent_turn":
      console.log(`\n=== turn ${event.turn}/${event.maxTurns} ===`);
      break;
    case "model_request":
      console.log("\n--- model_request ---");
      printMessages(event.messages, options);
      break;
    case "assistant_message":
      console.log("\n--- assistant_message ---");
      printMessage(event.message, options);
      break;
    case "tool_calls":
      console.log(`\n--- tool_calls (${event.count}) ---`);
      console.log(event.tools.join(", "));
      break;
    case "tool_batch":
      console.log(`\n--- tool_batch ${event.mode} ---`);
      console.log(event.tools.join(", "));
      break;
    case "tool_call":
      console.log(`\n--- tool_call ${event.toolName} (${event.toolCallId}) ---`);
      if (event.reason) console.log(`reason: ${event.reason}`);
      break;
    case "tool_progress":
      console.log(
        `[tool_progress] ${event.toolName} ${event.stage ?? ""} ${event.message ?? ""}`.trim(),
      );
      break;
    case "tool_observation":
      console.log(`\n--- tool_observation ${event.toolName} ok=${event.ok} ---`);
      console.log(preview(JSON.stringify(event.observation, null, 2), options.previewChars));
      break;
    case "tool_message":
      if (options.verboseToolMessages) {
        console.log("\n--- tool_message ---");
        printMessage(event.message, options);
      }
      break;
    case "loop_stop":
      console.log("\n=== loop_stop ===");
      console.log(`stoppedBy=${event.result.stoppedBy} turns=${event.result.turns}`);
      console.log(preview(event.result.finalAnswer, options.previewChars));
      break;
  }
}

function printMessages(messages: AgentMessage[], options: SmokeOptions): void {
  messages.forEach((message, index) => {
    console.log(`\n[${index}]`);
    printMessage(message, options);
  });
}

function printMessage(message: AgentMessage, options: SmokeOptions): void {
  console.log(`role=${message.role}`);
  if (message.toolCallId) console.log(`toolCallId=${message.toolCallId}`);
  if (message.toolName) console.log(`toolName=${message.toolName}`);
  if (message.toolCalls?.length) {
    console.log(`toolCalls=${JSON.stringify(message.toolCalls, null, 2)}`);
  }
  console.log(preview(message.content, options.previewChars));
}

function preview(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

interface SmokeOptions {
  query: string;
  maxTurns: number;
  tools?: string[];
  refreshOpenSky: boolean;
  previewChars: number;
  verboseToolMessages: boolean;
  scenario?: string;
  realModel: boolean;
  mockWeather: boolean;
  mockApi: boolean;
  mockReportContent: string;
}

function parseArgs(args: string[]): SmokeOptions {
  let query = "";
  let maxTurns = 6;
  let tools: string[] | undefined;
  let refreshOpenSky = false;
  let verboseToolMessages = false;
  let scenario: string | undefined;
  let realModel = false;
  let mockWeather: boolean | undefined;
  let mockApi = false;
  let mockReportContent = "昨日边境态势总体平稳，设备运行正常，未发生重大预警事态。";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--query" || arg === "-q") {
      query = requireValue(arg, next);
      index += 1;
    } else if (arg === "--scenario") {
      scenario = requireValue(arg, next);
      index += 1;
    } else if (arg === "--max-turns") {
      maxTurns = Number.parseInt(requireValue(arg, next), 10);
      index += 1;
    } else if (arg === "--tools") {
      tools = requireValue(arg, next)
        .split(",")
        .map((tool) => tool.trim())
        .filter(Boolean);
      index += 1;
    } else if (arg === "--with-webfetch") {
      tools = Array.from(new Set([...(tools ?? []), "WebFetch"]));
    } else if (arg === "--with-websearch") {
      tools = Array.from(new Set([...(tools ?? []), "WebSearch"]));
    } else if (arg === "--refresh-opensky") {
      refreshOpenSky = true;
    } else if (arg === "--real-model") {
      realModel = true;
    } else if (arg === "--mock-weather") {
      mockWeather = true;
    } else if (arg === "--no-mock-weather") {
      mockWeather = false;
    } else if (arg === "--mock-api") {
      mockApi = true;
    } else if (arg === "--mock-report-content") {
      mockReportContent = requireValue(arg, next);
      index += 1;
    } else if (arg === "--verbose-tool-messages") {
      verboseToolMessages = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(maxTurns) || maxTurns < 1) {
    throw new Error("--max-turns must be a positive integer");
  }

  const knownScenarios = new Set([GIS_TOOLCHAIN_SCENARIO, DAILY_REPORT_SCENARIO]);
  if (scenario && !knownScenarios.has(scenario)) {
    throw new Error(`Unknown smoke scenario: ${scenario}`);
  }

  if (scenario === GIS_TOOLCHAIN_SCENARIO && (!tools || tools.length === 0)) {
    tools = [...GIS_TOOLCHAIN_TOOLS];
  }

  if (scenario === DAILY_REPORT_SCENARIO && (!tools || tools.length === 0)) {
    tools = [...DAILY_REPORT_TOOLS];
  }

  return {
    query,
    maxTurns,
    tools,
    refreshOpenSky,
    previewChars: Number.isFinite(PREVIEW_CHARS) && PREVIEW_CHARS > 0 ? PREVIEW_CHARS : 8000,
    verboseToolMessages,
    scenario,
    realModel,
    mockWeather: mockWeather ?? scenario === GIS_TOOLCHAIN_SCENARIO,
    mockApi,
    mockReportContent,
  };
}

function requireValue(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function printHelpAndExit(): never {
  console.log(`Usage:
  tsx scripts/agent-loop-smoke.ts [options]

Options:
  -q, --query <text>            User query to run.
  --scenario <name>            Scenario assertions and fake model. Supported: gis-toolchain, daily-report.
  --max-turns <n>              Max loop turns. Default: 6.
  --tools <a,b,c>              Comma-separated tools from the default registry.
  --with-webfetch              Add WebFetch to the selected tools.
  --with-websearch             Add WebSearch to the selected tools.
  --refresh-opensky            Fetch OpenSky now before running the agent.
  --real-model                 Use the configured model instead of the scenario fake model.
  --mock-weather               Mock Open-Meteo weather responses (gis-toolchain only).
  --no-mock-weather            Use real Open-Meteo weather responses (gis-toolchain only).
  --mock-api                   Mock the daily-report API (daily-report only).
  --mock-report-content <t>   Content returned by the mock daily-report API.
  --verbose-tool-messages      Also print serialized tool messages.

GIS toolchain fake example:
  tsx scripts/agent-loop-smoke.ts --scenario gis-toolchain --max-turns 6

GIS toolchain real-model example:
  tsx scripts/agent-loop-smoke.ts --scenario gis-toolchain --real-model --query "圈选东海并查询这个区域的风场。" --max-turns 8

Daily report fake example:
  tsx scripts/agent-loop-smoke.ts --scenario daily-report --mock-api --max-turns 4

Daily report real-model example:
  tsx scripts/agent-loop-smoke.ts --scenario daily-report --real-model --query "生成昨天的边防日报" --max-turns 4
`);
  process.exit(0);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[smoke] failed");
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
