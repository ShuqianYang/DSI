import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { tasks, taskSteps } from "../../db/schema.js";
import type {
  AgentLoopToolUseContext,
  PromptSection,
  ToolDefinition,
} from "./types.js";

const execFile = promisify(execFileCallback);
const DEFAULT_TIME_ZONE = process.env.AGENT_TIMEZONE || "Asia/Shanghai";
const MAX_CONTEXT_FILE_CHARS = parsePositiveIntegerEnv(process.env.AGENT_CONTEXT_FILE_MAX_CHARS, 12_000);
const MAX_CONTEXT_SECTION_CHARS = parsePositiveIntegerEnv(process.env.AGENT_CONTEXT_SECTION_MAX_CHARS, 24_000);
const MAX_GIT_STATUS_CHARS = parsePositiveIntegerEnv(process.env.AGENT_GIT_STATUS_MAX_CHARS, 12_000);
const CONTEXT_FILE_CANDIDATES = [
  "AGENTS.md",
  "CLAUDE.md",
  path.join(".claude", "CLAUDE.md"),
] as const;

export interface ContextProviderInput {
  /** Current task/run id. Use it to load task-scoped context or correlate diagnostics. */
  taskId: string;
  /** Original user request for this agent run. Stable across all loop turns. */
  query: string;
  /** Tool list visible to the model when context is loaded. */
  tools: ToolDefinition[];
  /** Loop runtime context, mirroring Claude Code's ToolUseContext shape. */
  toolUseContext: AgentLoopToolUseContext;
  /** Run-level cancellation signal. Long context fetches should stop when aborted. */
  signal?: AbortSignal;
}

export interface ContextProvider {
  /**
   * Load user-scoped context, similar to Claude Code's getUserContext().
   * Examples: AGENTS.md/CLAUDE.md content, current date, explicit user settings.
   *
   * Return format:
   * - Record keys should be stable, human-readable ids such as "projectInstructions".
   * - Record values must be plain model-visible text, already safe to inject.
   */
  getUserContext(input: ContextProviderInput): Promise<Record<string, string>>;

  /**
   * Load system/workspace context, similar to Claude Code's getSystemContext().
   * Examples: git status, workspace metadata, task status, cache breakers.
   *
   * Return format:
   * - Record keys should be stable, human-readable ids such as "gitStatus".
   * - Record values must be plain model-visible text, already safe to inject.
   */
  getSystemContext(input: ContextProviderInput): Promise<Record<string, string>>;

  /**
   * Load additional structured context sections.
   * Use this for project/task/domain context that does not fit the key/value maps.
   *
   * Return format:
   * - PromptSection[] only; do not include memory or skills here.
   * - PromptManager decides final ordering with memory/skill/tool materials.
   */
  getContextSections(input: ContextProviderInput): Promise<PromptSection[]>;
}

export const noopContextProvider: ContextProvider = {
  async getUserContext() {
    return {};
  },
  async getSystemContext() {
    return {};
  },
  async getContextSections() {
    return [];
  },
};

export const defaultContextProvider: ContextProvider = {
  async getUserContext(input) {
    throwIfAborted(input.signal);
    const workspaceRoot = getWorkspaceRoot();
    const projectInstructions = await readProjectInstructionFiles(workspaceRoot);
    return {
      currentDate: `Today's date is ${formatLocalDate(DEFAULT_TIME_ZONE)}. Time zone: ${DEFAULT_TIME_ZONE}.`,
      ...(projectInstructions ? { projectInstructions } : {}),
    };
  },
  async getSystemContext(input) {
    throwIfAborted(input.signal);
    const workspaceRoot = getWorkspaceRoot();
    const [gitStatus, taskStatus] = await Promise.all([
      getGitStatus(workspaceRoot, input.signal),
      getTaskStatusSection(input.taskId),
    ]);
    return {
      workspaceRoot,
      ...(gitStatus ? { gitStatus } : {}),
      ...(taskStatus ? { taskStatus } : {}),
    };
  },
  async getContextSections(input) {
    throwIfAborted(input.signal);
    const workspaceRoot = getWorkspaceRoot();
    const domain = await readOptionalContextFile(path.join(workspaceRoot, "CONTEXT.md"));
    return domain
      ? [{ id: "project.domain", content: domain }]
      : [];
  },
};

function getWorkspaceRoot(): string {
  return path.resolve(process.env.AGENT_WORKSPACE_ROOT || path.join(process.cwd(), ".."));
}

async function readProjectInstructionFiles(workspaceRoot: string): Promise<string | undefined> {
  const chunks: string[] = [];
  const seen = new Set<string>();
  for (const relativePath of CONTEXT_FILE_CANDIDATES) {
    const filePath = path.join(workspaceRoot, relativePath);
    const normalized = path.normalize(filePath).toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const content = await readOptionalContextFile(filePath);
    if (content) {
      chunks.push(`### ${relativePath.replace(/\\/g, "/")}\n${content}`);
    }
  }
  return chunks.length > 0 ? truncate(chunks.join("\n\n"), MAX_CONTEXT_SECTION_CHARS) : undefined;
}

async function readOptionalContextFile(filePath: string): Promise<string | undefined> {
  if (!existsSync(filePath)) return undefined;
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) return undefined;
  const content = await readFile(filePath, "utf8");
  return truncate(content.trim(), MAX_CONTEXT_FILE_CHARS);
}

async function getGitStatus(workspaceRoot: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const result = await execFile("git", ["status", "--short"], {
      cwd: workspaceRoot,
      timeout: 3_000,
      maxBuffer: MAX_GIT_STATUS_CHARS * 4,
      signal,
    });
    const text = result.stdout.trim();
    return text ? truncate(text, MAX_GIT_STATUS_CHARS) : "Working tree clean.";
  } catch {
    return undefined;
  }
}

async function getTaskStatusSection(taskId: string): Promise<string | undefined> {
  try {
    const { db } = await import("../../config/database.js");
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task) return undefined;
    const steps = await db.select().from(taskSteps).where(eq(taskSteps.taskId, taskId));
    return truncate(JSON.stringify({
      id: task.id,
      status: task.status,
      query: task.query,
      stepCount: steps.length,
      completedSteps: steps.filter((step) => step.status === "completed").length,
      failedSteps: steps.filter((step) => step.status === "failed").length,
    }, null, 2), MAX_CONTEXT_SECTION_CHARS);
  } catch {
    return undefined;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error(typeof signal.reason === "string" ? signal.reason : "Context loading aborted.");
  }
}

function formatLocalDate(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : new Date().toISOString().slice(0, 10);
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}

function parsePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
