import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";

export interface CleanupAgentLoopLogsInput {
  rootDir: string;
  retentionDays: number;
  now?: Date;
}

export interface CleanupResult {
  scannedDateDirs: number;
  deletedDateDirs: string[];
  skipped: string[];
}

const DATE_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function cleanupAgentLoopLogs(
  input: CleanupAgentLoopLogsInput
): Promise<CleanupResult> {
  const result: CleanupResult = {
    scannedDateDirs: 0,
    deletedDateDirs: [],
    skipped: [],
  };
  const retentionDays = normalizeRetentionDays(input.retentionDays);
  const now = input.now ?? new Date();
  const cutoff = startOfUtcDay(addUtcDays(now, -retentionDays));

  let entries: Dirent<string>[];
  try {
    entries = await fs.readdir(input.rootDir, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return result;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !DATE_DIR_PATTERN.test(entry.name)) {
      result.skipped.push(entry.name);
      continue;
    }

    const entryDate = parseDateFolder(entry.name);
    if (!entryDate) {
      result.skipped.push(entry.name);
      continue;
    }

    result.scannedDateDirs += 1;
    if (entryDate >= cutoff) continue;

    await fs.rm(path.join(input.rootDir, entry.name), { recursive: true, force: true });
    result.deletedDateDirs.push(entry.name);
  }

  result.deletedDateDirs.sort();
  result.skipped.sort();
  return result;
}

export function resolveAgentLoopLogRetentionDays(env: NodeJS.ProcessEnv): number {
  return normalizeRetentionDays(Number(env.AGENT_LOOP_LOG_RETENTION_DAYS || 14));
}

export function resolveAgentLoopLogRootDir(env: NodeJS.ProcessEnv, cwd = process.cwd()): string {
  if (env.AGENT_LOOP_LOG_DIR) return env.AGENT_LOOP_LOG_DIR;
  if (env.AGENT_WORKSPACE_ROOT) return path.join(env.AGENT_WORKSPACE_ROOT, "logs");

  const workspaceRoot = path.basename(cwd).toLowerCase() === "api" ? path.resolve(cwd, "..") : cwd;
  return path.join(workspaceRoot, "logs");
}

function normalizeRetentionDays(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 14;
  return Math.floor(value);
}

function parseDateFolder(value: string): Date | undefined {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10) === value ? date : undefined;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
