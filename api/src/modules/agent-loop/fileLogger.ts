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
}

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
  const logDir = resolveAgentLoopLogDir();
  await mkdir(logDir, { recursive: true });

  const filePath = path.join(
    logDir,
    `agent-loop-${safeFilePart(options.taskId)}-${formatTimestampForFile(new Date())}.jsonl`
  );
  const stream = fs.createWriteStream(filePath, { flags: "wx", encoding: "utf8" });
  const logger = new JsonlAgentLoopFileLogger(filePath, stream);

  logger.writeLine({
    kind: "run_start",
    timestamp: new Date().toISOString(),
    taskId: options.taskId,
    query: options.query,
  });

  return logger;
}

class JsonlAgentLoopFileLogger implements AgentLoopFileLogger {
  public readonly filePath: string;
  private readonly stream: fs.WriteStream;
  private closed = false;

  constructor(filePath: string, stream: fs.WriteStream) {
    this.filePath = filePath;
    this.stream = stream;
  }

  logEvent(event: AgentLoopEvent): void {
    this.writeLine({
      kind: "agent_loop_event",
      timestamp: new Date().toISOString(),
      message: formatAgentLoopLogMessage(event),
      event: sanitizeForJson(event),
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
      result: sanitizeForJson(result),
    });
    await this.close();
  }

  async fail(error: unknown): Promise<void> {
    this.writeLine({
      kind: "run_error",
      timestamp: new Date().toISOString(),
      error: sanitizeForJson(error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error),
    });
    await this.close();
  }

  writeLine(value: Record<string, unknown>): void {
    if (this.closed) return;
    this.stream.write(`${JSON.stringify(value)}\n`);
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
