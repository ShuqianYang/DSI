import { execFile as execFileCallback } from "node:child_process";
import { access, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { escapeRegExp, matchesGlobPattern, normalizeGlobPath } from "../_shared/globUtils.js";
import type { ToolDefinition } from "../_shared/types.js";

const MAX_READ_BYTES = 200_000;
const MAX_TOOL_OUTPUT_CHARS = 60_000;
const MAX_GLOB_RESULTS = 100;
const MAX_NODE_FALLBACK_REGEX_PATTERN_CHARS = 500;
const DEFAULT_GREP_HEAD_LIMIT = 250;
const GLOB_SKIP_DIR_NAMES = new Set([".git", "node_modules", ".next", "dist", "build", "coverage"]);

const execFile = promisify(execFileCallback);

export function buildGlobTool(): ToolDefinition {
  return {
    name: "Glob",
    description:
      'Find files by glob pattern. Input: {"pattern":"**/*.ts","path":"optional relative directory"}. Returns up to 100 files.',
    kind: "system",
    inputSchema: z.strictObject({
      pattern: z.string().min(1),
      path: z.string().optional(),
    }),
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    maxResultSizeChars: MAX_TOOL_OUTPUT_CHARS,
    async execute(input) {
      const parsed = input as { pattern: string; path?: string };
      const cwd = parsed.path ? resolveWorkspacePath(parsed.path) : getWorkspaceRoot();
      await assertDirectory(cwd);

      const startedAt = Date.now();
      let source: "ripgrep" | "node_fallback" = "ripgrep";
      let allFilenames: string[];
      try {
        const result = await runRg(["--files", "-g", parsed.pattern], cwd, [0, 1]);
        allFilenames = result.stdout
          .split("\n")
          .map(line => line.trim())
          .filter(Boolean);
      } catch (error) {
        if (!isMissingRipgrepError(error)) throw error;
        source = "node_fallback";
        allFilenames = await globFilesWithNode(cwd, parsed.pattern, MAX_GLOB_RESULTS + 1);
      }
      const filenames = allFilenames.slice(0, MAX_GLOB_RESULTS);

      return {
        source,
        durationMs: Date.now() - startedAt,
        numFiles: filenames.length,
        filenames,
        truncated: allFilenames.length > MAX_GLOB_RESULTS,
      };
    },
  };
}

export function buildGrepTool(): ToolDefinition {
  return {
    name: "Grep",
    description:
      'Search file contents with ripgrep. Input: {"pattern":"TODO","path":"optional file or dir","glob":"*.ts","output_mode":"content|files_with_matches|count","head_limit":100}.',
    kind: "system",
    inputSchema: z.strictObject({
      pattern: z.string().min(1),
      path: z.string().optional(),
      glob: z.string().optional(),
      output_mode: z.enum(["content", "files_with_matches", "count"]).optional(),
      "-B": z.number().int().min(0).optional(),
      "-A": z.number().int().min(0).optional(),
      "-C": z.number().int().min(0).optional(),
      context: z.number().int().min(0).optional(),
      "-n": z.boolean().optional(),
      "-i": z.boolean().optional(),
      type: z.string().optional(),
      head_limit: z.number().int().min(0).optional(),
      offset: z.number().int().min(0).optional(),
      multiline: z.boolean().optional(),
    }),
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    maxResultSizeChars: MAX_TOOL_OUTPUT_CHARS,
    async execute(input) {
      const parsed = input as {
        pattern: string;
        path?: string;
        glob?: string;
        output_mode?: "content" | "files_with_matches" | "count";
        "-B"?: number;
        "-A"?: number;
        "-C"?: number;
        context?: number;
        "-n"?: boolean;
        "-i"?: boolean;
        type?: string;
        head_limit?: number;
        offset?: number;
        multiline?: boolean;
      };
      const cwd = getWorkspaceRoot();
      const target = parsed.path ? resolveWorkspacePath(parsed.path) : cwd;
      await assertExists(target);

      const outputMode = parsed.output_mode ?? "files_with_matches";
      const args = buildGrepArgs(parsed, outputMode, target);
      let source: "ripgrep" | "node_fallback" = "ripgrep";
      let rawOutput: string;
      try {
        const result = await runRg(args, cwd, [0, 1]);
        rawOutput = result.stdout;
      } catch (error) {
        if (!isMissingRipgrepError(error)) throw error;
        source = "node_fallback";
        rawOutput = await grepFilesWithNode({
          target,
          pattern: parsed.pattern,
          glob: parsed.glob,
          outputMode,
          ignoreCase: parsed["-i"] === true,
          includeLineNumber: outputMode === "content" && parsed["-n"] !== false,
        });
      }
      const lines = rawOutput.split("\n").filter(Boolean);
      const offset = parsed.offset ?? 0;
      const headLimit = parsed.head_limit ?? DEFAULT_GREP_HEAD_LIMIT;
      const selected = headLimit === 0 ? lines.slice(offset) : lines.slice(offset, offset + headLimit);

      return {
        source,
        mode: outputMode,
        totalLines: lines.length,
        offset,
        headLimit: headLimit === 0 ? null : headLimit,
        truncated: selected.length < lines.slice(offset).length,
        output: truncate(selected.join("\n"), MAX_TOOL_OUTPUT_CHARS),
      };
    },
  };
}

export function buildReadTool(): ToolDefinition {
  return {
    name: "Read",
    description:
      'Read a text file in the workspace. Input: {"file_path":"src/app.ts","offset":1,"limit":200}. Offset and limit are line-based.',
    kind: "system",
    inputSchema: z.strictObject({
      file_path: z.string().min(1),
      offset: z.number().int().positive().optional(),
      limit: z.number().int().positive().max(2_000).optional(),
    }),
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    maxResultSizeChars: MAX_TOOL_OUTPUT_CHARS,
    async execute(input, context) {
      const parsed = input as { file_path: string; offset?: number; limit?: number };
      const filePath = resolveWorkspacePath(parsed.file_path);
      const fileStat = await stat(filePath);
      await assertExistingPathInsideWorkspace(filePath);
      if (!fileStat.isFile()) {
        throw new Error(`Path is not a file: ${parsed.file_path}`);
      }
      if (fileStat.size > MAX_READ_BYTES) {
        throw new Error(`File is too large to read (${fileStat.size} bytes, max ${MAX_READ_BYTES}).`);
      }

      const content = await readFile(filePath, "utf8");
      const lines = content.split(/\r?\n/);
      const startLine = parsed.offset ?? 1;
      const limit = parsed.limit ?? lines.length;
      const selected = lines.slice(startLine - 1, startLine - 1 + limit);
      const relativePath = toWorkspaceRelative(filePath);
      const endLine = startLine + selected.length - 1;
      context.toolUseContext?.readFileState.set(relativePath, {
        filePath: relativePath,
        startLine,
        endLine,
        totalLines: lines.length,
        truncated: startLine - 1 + limit < lines.length,
        readAt: new Date().toISOString(),
      });
      await triggerSkillHooksForPaths(context, [filePath]);
      context.onProgress?.({
        stage: "complete",
        message: `Read ${relativePath}`,
        data: { filePath: relativePath, startLine, endLine },
      });

      return {
        filePath: relativePath,
        startLine,
        endLine,
        totalLines: lines.length,
        truncated: startLine - 1 + limit < lines.length,
        content: selected.join("\n"),
      };
    },
  };
}

export function buildWriteTool(): ToolDefinition {
  return {
    name: "Write",
    description:
      'Create or overwrite a file in the workspace. Input: {"file_path":"path/to/file.ts","content":"..."}',
    kind: "system",
    inputSchema: z.strictObject({
      file_path: z.string().min(1),
      content: z.string(),
    }),
    isReadOnly: () => false,
    isDestructive: () => true,
    isConcurrencySafe: () => false,
    riskLevel: "high",
    maxResultSizeChars: MAX_TOOL_OUTPUT_CHARS,
    async execute(input, context) {
      const parsed = input as { file_path: string; content: string };
      const filePath = resolveWorkspacePath(parsed.file_path);
      await assertWritableWorkspacePath(filePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, parsed.content, "utf8");
      await triggerSkillHooksForPaths(context, [filePath]);
      return {
        filePath: toWorkspaceRelative(filePath),
        bytesWritten: Buffer.byteLength(parsed.content, "utf8"),
      };
    },
  };
}

export function buildEditTool(): ToolDefinition {
  return {
    name: "Edit",
    description:
      'Replace text in an existing workspace file. Input: {"file_path":"path","old_string":"exact text","new_string":"replacement","replace_all":false}.',
    kind: "system",
    inputSchema: z.strictObject({
      file_path: z.string().min(1),
      old_string: z.string().min(1),
      new_string: z.string(),
      replace_all: z.boolean().optional(),
    }),
    isReadOnly: () => false,
    isDestructive: () => true,
    isConcurrencySafe: () => false,
    riskLevel: "high",
    maxResultSizeChars: MAX_TOOL_OUTPUT_CHARS,
    validateInput(input) {
      const parsed = input as {
        old_string: string;
        new_string: string;
      };
      if (parsed.old_string === parsed.new_string) {
        throw new Error("old_string and new_string must be different.");
      }
    },
    async execute(input, context) {
      const parsed = input as {
        file_path: string;
        old_string: string;
        new_string: string;
        replace_all?: boolean;
      };
      const filePath = resolveWorkspacePath(parsed.file_path);
      await assertWritableWorkspacePath(filePath);
      const content = await readFile(filePath, "utf8");
      const matches = countOccurrences(content, parsed.old_string);

      if (matches === 0) {
        throw new Error("old_string was not found in the file.");
      }
      if (!parsed.replace_all && matches > 1) {
        throw new Error(`old_string appears ${matches} times. Set replace_all=true or provide a more specific string.`);
      }

      const nextContent = parsed.replace_all
        ? content.split(parsed.old_string).join(parsed.new_string)
        : content.replace(parsed.old_string, parsed.new_string);
      await writeFile(filePath, nextContent, "utf8");
      await triggerSkillHooksForPaths(context, [filePath]);

      return {
        filePath: toWorkspaceRelative(filePath),
        replacements: parsed.replace_all ? matches : 1,
      };
    },
  };
}

// ─── Workspace path utilities (shared by shell.ts and file tools) ───

export function getWorkspaceRoot(): string {
  const configured = process.env.AGENT_WORKSPACE_ROOT;
  if (configured) return path.resolve(configured);

  let current = process.cwd();
  while (true) {
    if (
      existsSync(path.join(current, "pnpm-workspace.yaml")) ||
      existsSync(path.join(current, ".git"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return process.cwd();
    current = parent;
  }
}

export function resolveWorkspacePath(inputPath: string): string {
  const root = getWorkspaceRoot();
  const resolved = path.resolve(root, inputPath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace root: ${inputPath}`);
  }
  return resolved;
}

export async function assertDirectory(filePath: string): Promise<void> {
  const fileStat = await stat(filePath);
  await assertExistingPathInsideWorkspace(filePath);
  if (!fileStat.isDirectory()) {
    throw new Error(`Path is not a directory: ${toWorkspaceRelative(filePath)}`);
  }
}

export async function assertExists(filePath: string): Promise<void> {
  await access(filePath, constants.F_OK);
  await assertExistingPathInsideWorkspace(filePath);
}

export async function assertWritableWorkspacePath(filePath: string): Promise<void> {
  const relative = path.relative(getWorkspaceRoot(), filePath);
  const parts = relative.split(path.sep);
  if (parts.includes(".git")) {
    throw new Error("Refusing to write inside .git.");
  }
  if (existsSync(filePath)) {
    await assertExistingPathInsideWorkspace(filePath);
  } else {
    await assertParentPathInsideWorkspace(filePath);
  }
}

export async function assertExistingPathInsideWorkspace(filePath: string): Promise<void> {
  const [rootRealPath, targetRealPath] = await Promise.all([
    realpath(getWorkspaceRoot()),
    realpath(filePath),
  ]);
  assertPathInsideRoot(targetRealPath, rootRealPath, filePath);
}

export async function assertParentPathInsideWorkspace(filePath: string): Promise<void> {
  const rootRealPath = await realpath(getWorkspaceRoot());
  let current = path.dirname(filePath);

  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`No existing parent directory for path: ${filePath}`);
    }
    current = parent;
  }

  const parentRealPath = await realpath(current);
  assertPathInsideRoot(parentRealPath, rootRealPath, filePath);
}

function assertPathInsideRoot(targetPath: string, rootPath: string, originalPath: string): void {
  const relative = path.relative(rootPath, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace root: ${originalPath}`);
  }
}

export function toWorkspaceRelative(filePath: string): string {
  const relative = path.relative(getWorkspaceRoot(), filePath);
  return relative || ".";
}

// ─── Shared helpers ───

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (true) {
    index = text.indexOf(needle, index);
    if (index === -1) return count;
    count += 1;
    index += needle.length;
  }
}

async function triggerSkillHooksForPaths(
  context: { toolUseContext?: { skillManager?: {
    discoverSkillDirsForPaths?(filePaths: string[], cwd: string): Promise<string[]>;
    activateConditionalSkillsForPaths?(filePaths: string[], cwd: string): string[];
  }; dynamicSkillDirTriggers: Set<string> } },
  filePaths: string[],
): Promise<void> {
  const toolUseContext = context.toolUseContext;
  const skillManager = toolUseContext?.skillManager;
  if (!toolUseContext || !skillManager) return;

  const cwd = getWorkspaceRoot();
  const newSkillDirs = await skillManager.discoverSkillDirsForPaths?.(filePaths, cwd) ?? [];
  for (const dir of newSkillDirs) {
    toolUseContext.dynamicSkillDirTriggers.add(dir);
  }
  skillManager.activateConditionalSkillsForPaths?.(filePaths, cwd);
}

// ─── ripgrep / node fallback helpers ───

function buildGrepArgs(
  input: {
    pattern: string;
    glob?: string;
    output_mode?: "content" | "files_with_matches" | "count";
    "-B"?: number;
    "-A"?: number;
    "-C"?: number;
    context?: number;
    "-n"?: boolean;
    "-i"?: boolean;
    type?: string;
    multiline?: boolean;
  },
  outputMode: "content" | "files_with_matches" | "count",
  target: string,
): string[] {
  const args = ["--color", "never"];

  if (outputMode === "files_with_matches") args.push("--files-with-matches");
  if (outputMode === "count") args.push("--count");
  if (outputMode === "content" && input["-n"] !== false) args.push("--line-number");
  if (input["-i"]) args.push("--ignore-case");
  if (input.multiline) args.push("--multiline", "--multiline-dotall");
  if (input.glob) args.push("--glob", input.glob);
  if (input.type) args.push("--type", input.type);

  const context = input.context ?? input["-C"];
  if (context !== undefined) args.push("-C", String(context));
  if (input["-A"] !== undefined) args.push("-A", String(input["-A"]));
  if (input["-B"] !== undefined) args.push("-B", String(input["-B"]));

  args.push("--", input.pattern, target);
  return args;
}

async function runRg(
  args: string[],
  cwd: string,
  allowedExitCodes: number[],
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFile("rg", args, {
      cwd,
      maxBuffer: MAX_TOOL_OUTPUT_CHARS * 4,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const execError = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    if (execError.code !== undefined && allowedExitCodes.includes(execError.code)) {
      return {
        stdout: execError.stdout ?? "",
        stderr: execError.stderr ?? "",
      };
    }
    throw new Error(execError.stderr || execError.message || "ripgrep command failed");
  }
}

function isMissingRipgrepError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes("spawn rg ENOENT") || error.message.includes("ENOENT");
}

async function globFilesWithNode(
  root: string,
  pattern: string,
  limit: number,
): Promise<string[]> {
  const normalizedPattern = normalizeGlobPath(pattern);
  const results: string[] = [];

  async function walk(directory: string): Promise<void> {
    if (results.length >= limit) return;

    let entries: Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
    }>;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (results.length >= limit) return;
      const absolutePath = path.join(directory, entry.name);
      const relativePath = normalizeGlobPath(path.relative(root, absolutePath));

      if (entry.isDirectory()) {
        if (!GLOB_SKIP_DIR_NAMES.has(entry.name)) {
          await walk(absolutePath);
        }
        continue;
      }

      if (entry.isFile() && matchesGlobPattern(relativePath, normalizedPattern)) {
        results.push(relativePath);
      }
    }
  }

  await walk(root);
  return results;
}

async function grepFilesWithNode(input: {
  target: string;
  pattern: string;
  glob?: string;
  outputMode: "content" | "files_with_matches" | "count";
  ignoreCase: boolean;
  includeLineNumber: boolean;
}): Promise<string> {
  const matcher = buildSearchRegExp(input.pattern, input.ignoreCase);
  const files = await collectSearchFiles(input.target, input.glob);
  const output: string[] = [];

  for (const filePath of files) {
    let content: string;
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile() || fileStat.size > MAX_READ_BYTES) continue;
      content = await readFile(filePath, "utf8");
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    const matches: string[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      matcher.lastIndex = 0;
      if (!matcher.test(lines[index]!)) continue;

      if (input.outputMode === "files_with_matches") {
        matches.push(toWorkspaceRelative(filePath));
        break;
      }
      if (input.outputMode === "count") {
        matches.push(lines[index]!);
        continue;
      }

      const prefix = input.includeLineNumber
        ? `${toWorkspaceRelative(filePath)}:${index + 1}:`
        : `${toWorkspaceRelative(filePath)}:`;
      matches.push(`${prefix}${lines[index]}`);
    }

    if (input.outputMode === "count" && matches.length > 0) {
      output.push(`${toWorkspaceRelative(filePath)}:${matches.length}`);
    } else {
      output.push(...matches);
    }

    if (output.join("\n").length > MAX_TOOL_OUTPUT_CHARS * 2) break;
  }

  return output.join("\n");
}

async function collectSearchFiles(target: string, glob?: string): Promise<string[]> {
  const targetStat = await stat(target);
  if (targetStat.isFile()) {
    return glob && !matchesGlobPattern(toWorkspaceRelative(target), normalizeGlobPath(glob))
      ? []
      : [target];
  }
  if (!targetStat.isDirectory()) return [];

  const relativeFiles = await globFilesWithNode(
    target,
    glob ? normalizeGlobPath(glob) : "**/*",
    MAX_GLOB_RESULTS * 20,
  );
  return relativeFiles.map((relativePath) => path.join(target, relativePath));
}

function buildSearchRegExp(pattern: string, ignoreCase: boolean): RegExp {
  assertSafeNodeFallbackRegex(pattern);
  try {
    return new RegExp(pattern, ignoreCase ? "iu" : "u");
  } catch {
    return new RegExp(escapeRegExp(pattern), ignoreCase ? "iu" : "u");
  }
}

function assertSafeNodeFallbackRegex(pattern: string): void {
  if (pattern.length > MAX_NODE_FALLBACK_REGEX_PATTERN_CHARS) {
    throw new Error(
      `Grep pattern is too long for the Node fallback regex engine (${pattern.length} chars, max ${MAX_NODE_FALLBACK_REGEX_PATTERN_CHARS}).`,
    );
  }
  if (/[+*?}]\s*[+*?{]/.test(pattern) || /\([^)]*[*+][^)]*\)\s*[*+{]/.test(pattern)) {
    throw new Error(
      "Grep pattern is too complex for the Node fallback regex engine. Install ripgrep or use a simpler literal pattern.",
    );
  }
}
