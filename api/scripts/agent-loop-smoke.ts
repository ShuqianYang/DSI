import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { eq } from "drizzle-orm";
import { db } from "../src/config/database.js";
import { tasks } from "../src/db/schema.js";
import { runAgentLoopEvents } from "../src/modules/agent-loop/runAgentLoop.js";
import { buildClaudeCodeBaseSystemTools } from "../src/modules/agent-loop/systemTools.js";
import { ToolRegistry } from "../src/modules/agent-loop/toolRegistry.js";
import type {
  AgentLoopEvent,
  AgentMessage,
  ToolPermissionHandler,
} from "../src/modules/agent-loop/types.js";

const DEFAULT_QUERY =
  "请用只读工具查看当前仓库的 api/src/modules/agent-loop 目录，概括有哪些核心文件。";
const DEFAULT_TOOLS = [
  "Bash",
  "Glob",
  "Grep",
  "Read",
  "Write",
  "Edit",
  "TodoWrite",
  "Sleep",
  "WebSearch",
  "WebFetch",
];
const PREVIEW_CHARS = Number.parseInt(process.env.AGENT_LOOP_SMOKE_PREVIEW_CHARS ?? "8000", 10);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const query = options.query || DEFAULT_QUERY;
  const registry = buildSelectedRegistry(options.tools);
  const taskId = await createSmokeTask(query);
  const permissionHandler = createCliPermissionHandler();

  console.log(`[smoke] taskId=${taskId}`);
  console.log(`[smoke] query=${query}`);
  console.log(`[smoke] tools=${registry.list().map((tool) => tool.name).join(", ")}`);
  console.log("");

  let finalSeen = false;
  try {
    for await (const event of runAgentLoopEvents({
      taskId,
      query,
      registry,
      maxTurns: options.maxTurns,
      permissionHandler,
    })) {
      printEvent(event, options);
      if (event.type === "loop_stop") {
        finalSeen = true;
        await db
          .update(tasks)
          .set({
            status:
              event.result.stoppedBy === "final_answer" || event.result.stoppedBy === "max_turns"
                ? "completed"
                : "failed",
            result: event.result,
            error:
              event.result.stoppedBy === "model_error" || event.result.stoppedBy === "aborted"
                ? event.result.finalAnswer
                : null,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(tasks.id, taskId));
      }
    }
  } finally {
    if (!finalSeen) {
      await db
        .update(tasks)
        .set({
          status: "failed",
          error: "Smoke runner exited before loop_stop.",
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, taskId));
    }
  }
}

function buildSelectedRegistry(names: string[]): ToolRegistry {
  const selected = new Set(names);
  const registry = new ToolRegistry();
  for (const tool of buildClaudeCodeBaseSystemTools()) {
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

async function createSmokeTask(query: string): Promise<string> {
  const [task] = await db
    .insert(tasks)
    .values({
      query,
      status: "running",
    })
    .returning({ id: tasks.id });
  return task.id;
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
  tools: string[];
  previewChars: number;
  verboseToolMessages: boolean;
}

function parseArgs(args: string[]): SmokeOptions {
  let query = "";
  let maxTurns = 6;
  let tools = [...DEFAULT_TOOLS];
  let verboseToolMessages = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--query" || arg === "-q") {
      query = requireValue(arg, next);
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
      tools = Array.from(new Set([...tools, "WebFetch"]));
    } else if (arg === "--with-websearch") {
      tools = Array.from(new Set([...tools, "WebSearch"]));
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

  return {
    query,
    maxTurns,
    tools,
    previewChars: Number.isFinite(PREVIEW_CHARS) && PREVIEW_CHARS > 0 ? PREVIEW_CHARS : 8000,
    verboseToolMessages,
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
  -q, --query <text>       User query to run.
  --max-turns <n>          Max loop turns. Default: 6.
  --tools <a,b,c>          Comma-separated tools. Default: all system tools.
  --with-webfetch          Add WebFetch to the selected tools.
  --with-websearch         Add WebSearch to the selected tools.
  --verbose-tool-messages  Also print serialized tool messages.
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
