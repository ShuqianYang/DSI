import fs from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { sanitizeForJson } from "./tools/_shared/serialization.js";
import type { AgentLoopEvent, AgentLoopResult } from "./tools/_shared/types.js";

export interface AgentLoopFileLogger {
  filePath: string;
  logEvent(event: AgentLoopEvent): void;
  logDerivedEvent(kind: string, event: unknown): void;
  finish(result: AgentLoopResult): Promise<void>;
  fail(error: unknown): Promise<void>;
}

export interface CreateAgentLoopFileLoggerOptions {
  taskId: string;
  query: string;
  metadata?: Record<string, unknown>;
}

type AgentLoopLogMode = "debug" | "operational";

export function withAgentLoopLogFilePath(
  result: AgentLoopResult,
  fileLogger: AgentLoopFileLogger | undefined
): AgentLoopResult {
  if (!fileLogger?.filePath) return result;
  return {
    ...result,
    logFilePath: fileLogger.filePath,
  };
}

export async function createAgentLoopFileLogger(
  options: CreateAgentLoopFileLoggerOptions
): Promise<AgentLoopFileLogger> {
  const now = new Date();
  const baseLogDir = resolveAgentLoopLogDir();
  const sessionFolder = safeSessionFolder(options.metadata?.sessionId);
  const logDir = path.join(baseLogDir, formatDateFolder(now), sessionFolder);
  await mkdir(logDir, { recursive: true });

  const filePath = path.join(
    logDir,
    `agent-loop-${safeFilePart(options.taskId)}-${formatTimestampForFile(now)}.jsonl`
  );
  const stream = fs.createWriteStream(filePath, { flags: "wx", encoding: "utf8" });
  const logger = new JsonlAgentLoopFileLogger(filePath, stream, resolveAgentLoopLogMode());

  logger.writeLine({
    kind: "run_start",
    timestamp: new Date().toISOString(),
    taskId: options.taskId,
    query: options.query,
    metadata: sanitizeForJson(options.metadata ?? {}),
  });

  return logger;
}

class JsonlAgentLoopFileLogger implements AgentLoopFileLogger {
  public readonly filePath: string;
  private readonly stream: fs.WriteStream;
  private readonly mode: AgentLoopLogMode;
  private seq = 0;
  private readonly startedAtMs = Date.now();
  private closed = false;

  constructor(filePath: string, stream: fs.WriteStream, mode: AgentLoopLogMode) {
    this.filePath = filePath;
    this.stream = stream;
    this.mode = mode;
  }

  logEvent(event: AgentLoopEvent): void {
    this.writeLine({
      kind: "agent_loop_event",
      timestamp: new Date().toISOString(),
      message: formatAgentLoopLogMessage(event),
      event: sanitizeEventForMode(event, this.mode),
    });
  }

  logDerivedEvent(kind: string, event: unknown): void {
    this.writeLine({
      kind,
      timestamp: new Date().toISOString(),
      event: sanitizeForJson(event),
    });
  }

  async finish(result: AgentLoopResult): Promise<void> {
    this.writeLine({
      kind: "run_stop",
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - this.startedAtMs,
      result: sanitizeResultForMode(result, this.mode),
    });
    await this.close();
  }

  async fail(error: unknown): Promise<void> {
    this.writeLine({
      kind: "run_error",
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - this.startedAtMs,
      error: sanitizeForJson(error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error),
    });
    await this.close();
  }

  writeLine(value: Record<string, unknown>): void {
    if (this.closed) return;
    this.seq += 1;
    this.stream.write(`${JSON.stringify({ seq: this.seq, ...value })}\n`);
  }

  private async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await new Promise<void>((resolve, reject) => {
      this.stream.once("error", reject);
      this.stream.end(() => {
        this.stream.off("error", reject);
        resolve();
      });
    });
  }
}

export function formatAgentLoopLogMessage(event: AgentLoopEvent): string {
  if (event.type === "agent_turn") {
    return `agent_turn ${event.turn}/${event.maxTurns}`;
  }

  if (event.type === "assistant_message") {
    const toolCalls = event.message.toolCalls ?? [];
    if (toolCalls.length > 0) {
      return `assistant_message toolCalls=[${toolCalls.map((call) => call.toolName).join(", ")}]`;
    }
    return `assistant_message content="${preview(event.message.content)}"`;
  }

  if (event.type === "tool_call") {
    return `tool_call ${event.toolName} id=${event.toolCallId}`;
  }

  if (event.type === "tool_progress") {
    const stage = event.stage ? ` stage=${event.stage}` : "";
    const percent = typeof event.percent === "number" ? ` percent=${event.percent}` : "";
    return `tool_progress ${event.toolName}${stage}${percent} ${preview(event.message ?? "")}`;
  }

  if (event.type === "tool_observation") {
    const gisData = extractGisDataType(event.observation.output);
    const gisPart = gisData ? ` gisData=${gisData}` : "";
    return `tool_observation ${event.toolName} ok=${String(event.ok)}${gisPart}`;
  }

  if (event.type === "loop_stop") {
    return `loop_stop stoppedBy=${event.result.stoppedBy} final="${preview(event.result.finalAnswer)}"`;
  }

  if (event.type === "memory_recall") {
    return `memory_recall source=${event.source} recalled=${event.recalledCount}`;
  }

  return event.type;
}

function resolveAgentLoopLogDir(): string {
  if (process.env.AGENT_LOOP_LOG_DIR) {
    return process.env.AGENT_LOOP_LOG_DIR;
  }

  if (process.env.AGENT_WORKSPACE_ROOT) {
    return path.join(process.env.AGENT_WORKSPACE_ROOT, "logs");
  }

  const cwd = process.cwd();
  const workspaceRoot = path.basename(cwd).toLowerCase() === "api" ? path.resolve(cwd, "..") : cwd;
  return path.join(workspaceRoot, "logs");
}

function resolveAgentLoopLogMode(): AgentLoopLogMode {
  return process.env.AGENT_LOOP_LOG_MODE === "operational" ? "operational" : "debug";
}

function sanitizeEventForMode(event: AgentLoopEvent, mode: AgentLoopLogMode): unknown {
  if (mode === "debug") return sanitizeForJson(event);

  switch (event.type) {
    case "agent_turn":
      return {
        type: event.type,
        taskId: event.taskId,
        turn: event.turn,
        maxTurns: event.maxTurns,
        message: event.message,
      };
    case "model_request":
      return {
        type: event.type,
        taskId: event.taskId,
        turn: event.turn,
        messageCount: event.messages.length,
      };
    case "assistant_message":
      return {
        type: event.type,
        taskId: event.taskId,
        turn: event.turn,
        toolCallCount: event.message.toolCalls?.length ?? 0,
        message: formatAgentLoopLogMessage(event),
      };
    case "tool_calls":
      return {
        type: event.type,
        taskId: event.taskId,
        turn: event.turn,
        count: event.count,
        tools: event.tools,
        message: formatAgentLoopLogMessage(event),
      };
    case "tool_batch":
      return {
        type: event.type,
        taskId: event.taskId,
        turn: event.turn,
        mode: event.mode,
        tools: event.tools,
        message: formatAgentLoopLogMessage(event),
      };
    case "tool_call":
      return {
        type: event.type,
        taskId: event.taskId,
        turn: event.turn,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        displayName: event.displayName,
        message: formatAgentLoopLogMessage(event),
      };
    case "tool_progress":
      return {
        type: event.type,
        taskId: event.taskId,
        turn: event.turn,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        displayName: event.displayName,
        stage: event.stage,
        percent: event.percent,
        message: formatAgentLoopLogMessage(event),
      };
    case "tool_observation":
      return {
        type: event.type,
        taskId: event.taskId,
        turn: event.turn,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        displayName: event.displayName,
        ok: event.ok,
        message: formatAgentLoopLogMessage(event),
      };
    case "tool_message":
      return {
        type: event.type,
        taskId: event.taskId,
        turn: event.turn,
        message: formatAgentLoopLogMessage(event),
      };
    case "loop_stop":
      return {
        type: event.type,
        taskId: event.taskId,
        turn: event.turn,
        stoppedBy: event.result.stoppedBy,
        turns: event.result.turns,
        observationCount: event.result.observations.length,
        message: formatAgentLoopLogMessage(event),
      };
    case "memory_recall":
      return {
        type: event.type,
        taskId: event.taskId,
        turn: event.turn,
        source: event.source,
        recalledCount: event.recalledCount,
        snippets: event.snippets.map((s) => ({
          query: s.query,
          source: s.source,
          score: s.score,
        })),
        message: formatAgentLoopLogMessage(event),
      };
    default:
      return assertNeverAgentLoopEvent(event);
  }
}

function sanitizeResultForMode(result: AgentLoopResult, mode: AgentLoopLogMode): unknown {
  if (mode === "debug") return sanitizeForJson(result);
  return {
    stoppedBy: result.stoppedBy,
    turns: result.turns,
    observationCount: result.observations.length,
    hasLogFilePath: typeof result.logFilePath === "string",
  };
}

function assertNeverAgentLoopEvent(event: never): never {
  throw new Error(`Unhandled AgentLoopEvent type: ${JSON.stringify(event)}`);
}

function extractGisDataType(output: unknown): string | undefined {
  const record = isRecord(output) ? output : {};
  const top = record.gisData;
  if (isRecord(top) && typeof top.type === "string") return top.type;

  const data = isRecord(record.data) ? record.data : {};
  const nested = data.gisData;
  if (isRecord(nested) && typeof nested.type === "string") return nested.type;

  return undefined;
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "task";
}

function safeSessionFolder(value: unknown): string {
  return typeof value === "string" && value.trim() ? safeFilePart(value) : "no-session";
}

function formatDateFolder(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatTimestampForFile(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function preview(text: string, max = 120): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
