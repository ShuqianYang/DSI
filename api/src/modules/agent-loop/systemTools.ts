import { exec as execCallback, execFile as execFileCallback } from "node:child_process";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import type { ToolRegistry } from "./toolRegistry.js";

const exec = promisify(execCallback);
const execFile = promisify(execFileCallback);

const MAX_READ_BYTES = 200_000;
const MAX_TOOL_OUTPUT_CHARS = 60_000;
const MAX_GLOB_RESULTS = 100;
const DEFAULT_GREP_HEAD_LIMIT = 250;
const GLOB_SKIP_DIR_NAMES = new Set([".git", "node_modules", ".next", "dist", "build", "coverage"]);
const WEBFETCH_TIMEOUT_MS = parsePositiveIntegerEnv(process.env.WEBFETCH_TIMEOUT_MS, 30_000);
const WEBFETCH_DEFAULT_MAX_CHARS = parsePositiveIntegerEnv(
  process.env.WEBFETCH_MAX_CHARS,
  20_000,
);
const WEBFETCH_USER_AGENT = process.env.WEBFETCH_USER_AGENT || "DSI-AgentLoop/0.1";
const WEBSEARCH_TIMEOUT_MS = parsePositiveIntegerEnv(process.env.WEBSEARCH_TIMEOUT_MS, 30_000);
const TAVILY_SEARCH_URL = process.env.TAVILY_SEARCH_URL || "https://api.tavily.com/search";

export function registerClaudeCodeBaseSystemTools(registry: ToolRegistry): void {
  for (const tool of buildClaudeCodeBaseSystemTools()) {
    registry.register(tool);
  }
}

export function buildClaudeCodeBaseSystemTools(): ToolDefinition[] {
  return [
    buildBashTool(),
    buildGlobTool(),
    buildGrepTool(),
    buildReadTool(),
    buildWriteTool(),
    buildEditTool(),
    buildWebSearchTool(),
    buildWebFetchTool(),
  ];
}

function buildBashTool(): ToolDefinition {
  return {
    name: "Bash",
    description:
      'Run a shell command in the workspace. Input: {"command":"pnpm build","cwd":"optional relative dir","timeout_ms":120000}.',
    kind: "system",
    inputSchema: z.strictObject({
      command: z.string().min(1),
      cwd: z.string().optional(),
      timeout_ms: z.number().int().positive().max(120_000).optional(),
      description: z.string().optional(),
    }),
    isReadOnly: () => false,
    isDestructive: () => true,
    isConcurrencySafe: () => false,
    riskLevel: "high",
    maxResultSizeChars: MAX_TOOL_OUTPUT_CHARS,
    async execute(input, context) {
      const parsed = input as {
        command: string;
        cwd?: string;
        timeout_ms?: number;
      };
      const cwd = parsed.cwd ? resolveWorkspacePath(parsed.cwd) : getWorkspaceRoot();
      await assertDirectory(cwd);

      try {
        const result = await exec(parsed.command, {
          cwd,
          timeout: parsed.timeout_ms ?? 30_000,
          maxBuffer: MAX_TOOL_OUTPUT_CHARS * 4,
          signal: context.signal,
        });
        return {
          command: parsed.command,
          cwd: toWorkspaceRelative(cwd),
          exitCode: 0,
          stdout: truncate(result.stdout, MAX_TOOL_OUTPUT_CHARS),
          stderr: truncate(result.stderr, MAX_TOOL_OUTPUT_CHARS),
        };
      } catch (error) {
        const execError = error as {
          code?: number;
          signal?: string;
          stdout?: string;
          stderr?: string;
          message?: string;
        };
        const output = {
          command: parsed.command,
          cwd: toWorkspaceRelative(cwd),
          exitCode: execError.code ?? null,
          signal: execError.signal ?? null,
          stdout: truncate(execError.stdout ?? "", MAX_TOOL_OUTPUT_CHARS),
          stderr: truncate(execError.stderr ?? execError.message ?? "", MAX_TOOL_OUTPUT_CHARS),
        };
        const interpretation =
          typeof output.exitCode === "number"
            ? interpretCommandResult(parsed.command, output.exitCode)
            : { isError: true, message: execError.message || "Command failed" };

        if (interpretation.isError) {
          const failure = new Error(interpretation.message || "Command failed");
          (failure as Error & { toolOutput?: unknown }).toolOutput = output;
          throw failure;
        }

        return {
          ...output,
          semanticMessage: interpretation.message,
        };
      }
    },
  };
}

function buildGlobTool(): ToolDefinition {
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

function buildGrepTool(): ToolDefinition {
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
      const result = await runRg(args, cwd, [0, 1]);
      const lines = result.stdout.split("\n").filter(Boolean);
      const offset = parsed.offset ?? 0;
      const headLimit = parsed.head_limit ?? DEFAULT_GREP_HEAD_LIMIT;
      const selected = headLimit === 0 ? lines.slice(offset) : lines.slice(offset, offset + headLimit);

      return {
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

function buildReadTool(): ToolDefinition {
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

function buildWriteTool(): ToolDefinition {
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
    async execute(input) {
      const parsed = input as { file_path: string; content: string };
      const filePath = resolveWorkspacePath(parsed.file_path);
      assertWritableWorkspacePath(filePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, parsed.content, "utf8");
      return {
        filePath: toWorkspaceRelative(filePath),
        bytesWritten: Buffer.byteLength(parsed.content, "utf8"),
      };
    },
  };
}

function buildEditTool(): ToolDefinition {
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
    async execute(input) {
      const parsed = input as {
        file_path: string;
        old_string: string;
        new_string: string;
        replace_all?: boolean;
      };
      const filePath = resolveWorkspacePath(parsed.file_path);
      assertWritableWorkspacePath(filePath);
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

      return {
        filePath: toWorkspaceRelative(filePath),
        replacements: parsed.replace_all ? matches : 1,
      };
    },
  };
}

function buildWebSearchTool(): ToolDefinition {
  return {
    name: "WebSearch",
    description:
      'Search the web for current or unknown information. Input: {"query":"北京今天的天气","max_results":5,"search_depth":"basic|advanced","include_answer":true,"topic":"general|news","time_range":"day|week|month|year"}. Use WebFetch only after WebSearch returns a URL worth reading.',
    kind: "system",
    inputSchema: z.strictObject({
      query: z.string().min(1),
      max_results: z.number().int().positive().max(10).optional(),
      search_depth: z.enum(["basic", "advanced"]).optional(),
      include_answer: z.boolean().optional(),
      topic: z.enum(["general", "news"]).optional(),
      time_range: z.enum(["day", "week", "month", "year"]).optional(),
      include_domains: z.array(z.string().min(1)).max(10).optional(),
      exclude_domains: z.array(z.string().min(1)).max(10).optional(),
    }),
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "medium",
    maxResultSizeChars: MAX_TOOL_OUTPUT_CHARS,
    async execute(input, context) {
      const parsed = input as {
        query: string;
        max_results?: number;
        search_depth?: "basic" | "advanced";
        include_answer?: boolean;
        topic?: "general" | "news";
        time_range?: "day" | "week" | "month" | "year";
        include_domains?: string[];
        exclude_domains?: string[];
      };

      const apiKey = process.env.TAVILY_API_KEY;
      if (!apiKey) {
        throw new Error("TAVILY_API_KEY is required for WebSearch.");
      }

      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), WEBSEARCH_TIMEOUT_MS);
      if (context.signal) {
        if (context.signal.aborted) abortController.abort(context.signal.reason);
        context.signal.addEventListener("abort", () => abortController.abort(context.signal?.reason), {
          once: true,
        });
      }

      const body = {
        api_key: apiKey,
        query: parsed.query,
        search_depth: parsed.search_depth ?? "basic",
        max_results: parsed.max_results ?? 5,
        include_answer: parsed.include_answer ?? true,
        topic: parsed.topic ?? "general",
        time_range: parsed.time_range,
        include_domains: parsed.include_domains,
        exclude_domains: parsed.exclude_domains,
      };

      const response = await fetch(TAVILY_SEARCH_URL, {
        method: "POST",
        signal: abortController.signal,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(dropUndefined(body)),
      }).finally(() => clearTimeout(timeout));

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Tavily search failed: ${response.status} ${truncate(text, 2_000)}`);
      }

      const json = parseJsonObject(text, "Tavily search response");
      const results = Array.isArray(json.results) ? json.results : [];

      return {
        provider: "tavily",
        query: parsed.query,
        answer: typeof json.answer === "string" ? json.answer : undefined,
        results: results.slice(0, parsed.max_results ?? 5).map(normalizeTavilyResult),
        responseTime:
          typeof json.response_time === "number" || typeof json.response_time === "string"
            ? json.response_time
            : undefined,
      };
    },
  };
}

function buildWebFetchTool(): ToolDefinition {
  return {
    name: "WebFetch",
    description:
      'Fetch text from a URL. Input: {"url":"https://example.com","max_chars":20000}. Returns truncated response text.',
    kind: "system",
    inputSchema: z.strictObject({
      url: z.string().url(),
      max_chars: z.number().int().positive().max(MAX_TOOL_OUTPUT_CHARS).optional(),
    }),
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "medium",
    maxResultSizeChars: MAX_TOOL_OUTPUT_CHARS,
    async execute(input, context) {
      const parsed = input as { url: string; max_chars?: number };
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), WEBFETCH_TIMEOUT_MS);
      if (context.signal) {
        if (context.signal.aborted) abortController.abort(context.signal.reason);
        context.signal.addEventListener("abort", () => abortController.abort(context.signal?.reason), {
          once: true,
        });
      }
      const response = await fetch(parsed.url, {
        signal: abortController.signal,
        headers: {
          "user-agent": WEBFETCH_USER_AGENT,
        },
      }).finally(() => clearTimeout(timeout));
      const text = await response.text();
      const maxChars = parsed.max_chars ?? WEBFETCH_DEFAULT_MAX_CHARS;

      return {
        url: parsed.url,
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get("content-type"),
        truncated: text.length > maxChars,
        text: truncate(text, maxChars),
      };
    },
  };
}

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

function normalizeGlobPath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.\//, "");
}

function matchesGlobPattern(relativePath: string, pattern: string): boolean {
  const pathParts = relativePath.split("/").filter(Boolean);
  const patternParts = pattern.split("/").filter(Boolean);
  return matchGlobSegments(patternParts, pathParts);
}

function matchGlobSegments(patternParts: string[], pathParts: string[]): boolean {
  if (patternParts.length === 0) return pathParts.length === 0;

  const [currentPattern, ...remainingPatterns] = patternParts;
  if (currentPattern === "**") {
    if (matchGlobSegments(remainingPatterns, pathParts)) return true;
    return pathParts.length > 0 && matchGlobSegments(patternParts, pathParts.slice(1));
  }

  if (pathParts.length === 0) return false;
  return (
    matchesGlobSegment(pathParts[0]!, currentPattern) &&
    matchGlobSegments(remainingPatterns, pathParts.slice(1))
  );
}

function matchesGlobSegment(value: string, pattern: string): boolean {
  const regex = new RegExp(
    `^${pattern
      .split("")
      .map((char) => {
        if (char === "*") return ".*";
        if (char === "?") return ".";
        return escapeRegExp(char);
      })
      .join("")}$`,
  );
  return regex.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getWorkspaceRoot(): string {
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

function resolveWorkspacePath(inputPath: string): string {
  const root = getWorkspaceRoot();
  const resolved = path.resolve(root, inputPath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace root: ${inputPath}`);
  }
  return resolved;
}

function assertWritableWorkspacePath(filePath: string): void {
  const relative = path.relative(getWorkspaceRoot(), filePath);
  const parts = relative.split(path.sep);
  if (parts.includes(".git")) {
    throw new Error("Refusing to write inside .git.");
  }
}

async function assertDirectory(filePath: string): Promise<void> {
  const fileStat = await stat(filePath);
  if (!fileStat.isDirectory()) {
    throw new Error(`Path is not a directory: ${toWorkspaceRelative(filePath)}`);
  }
}

async function assertExists(filePath: string): Promise<void> {
  await access(filePath, constants.F_OK);
}

function toWorkspaceRelative(filePath: string): string {
  const relative = path.relative(getWorkspaceRoot(), filePath);
  return relative || ".";
}

function truncate(text: string, maxChars: number): string {
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

function interpretCommandResult(
  command: string,
  exitCode: number,
): { isError: boolean; message?: string } {
  const baseCommand = extractExitCodeCommand(command);
  if (baseCommand === "grep" || baseCommand === "rg") {
    return {
      isError: exitCode >= 2,
      message: exitCode === 1 ? "No matches found" : undefined,
    };
  }

  if (baseCommand === "find") {
    return {
      isError: exitCode >= 2,
      message: exitCode === 1 ? "Some directories were inaccessible" : undefined,
    };
  }

  if (baseCommand === "diff") {
    return {
      isError: exitCode >= 2,
      message: exitCode === 1 ? "Files differ" : undefined,
    };
  }

  if (baseCommand === "test" || baseCommand === "[") {
    return {
      isError: exitCode >= 2,
      message: exitCode === 1 ? "Condition is false" : undefined,
    };
  }

  return {
    isError: exitCode !== 0,
    message: exitCode !== 0 ? `Command failed with exit code ${exitCode}` : undefined,
  };
}

function extractExitCodeCommand(command: string): string {
  const segments = command
    .split(/[;|]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const lastSegment = segments.at(-1) || command;
  return (lastSegment.split(/\s+/)[0] || "").replace(/^["']|["']$/g, "");
}

function dropUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function normalizeTavilyResult(value: unknown): Record<string, unknown> {
  const result = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return dropUndefined({
    title: typeof result.title === "string" ? result.title : undefined,
    url: typeof result.url === "string" ? result.url : undefined,
    content: typeof result.content === "string" ? result.content : undefined,
    rawContent: typeof result.raw_content === "string" ? result.raw_content : undefined,
    score: typeof result.score === "number" ? result.score : undefined,
    publishedDate:
      typeof result.published_date === "string" ? result.published_date : undefined,
  });
}

function parsePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
