import { exec as execCallback } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { ToolDefinition } from "../_shared/types.js";
import {
  getWorkspaceRoot,
  resolveWorkspacePath,
  assertDirectory,
  toWorkspaceRelative,
  truncate,
} from "./file.js";

const exec = promisify(execCallback);
const MAX_TOOL_OUTPUT_CHARS = 60_000;

const DENIED_BASH_COMMANDS = new Set([
  "rm",
  "rmdir",
  "mv",
  "cp",
  "chmod",
  "chown",
  "sudo",
  "su",
  "kill",
  "pkill",
  "killall",
  "dd",
  "mkfs",
  "mount",
  "umount",
  "ssh",
  "scp",
]);

export function buildBashTool(): ToolDefinition {
  return {
    name: "Bash",
    displayName: "命令执行",
    description:
      'Run a shell command in the workspace. Input: {"command":"pnpm build","cwd":"optional relative dir","timeout_ms":120000}.',
    kind: "system",
    inputSchema: z.strictObject({
      command: z.string().min(1),
      cwd: z.string().optional(),
      timeout_ms: z.number().int().positive().max(120_000).optional(),
      description: z.string().optional(),
    }),
    isReadOnly: (input) => {
      const command = (input as { command?: unknown }).command;
      return typeof command === "string" && classifyBashCommand(command).readOnly;
    },
    isDestructive: () => true,
    isConcurrencySafe: () => false,
    riskLevel: "high",
    maxResultSizeChars: MAX_TOOL_OUTPUT_CHARS,
    async validateInput(input) {
      const parsed = input as {
        command: string;
        cwd?: string;
      };
      const cwd = parsed.cwd ? resolveWorkspacePath(parsed.cwd) : getWorkspaceRoot();
      await assertDirectory(cwd);
    },
    checkPermissions(input) {
      const parsed = input as {
        command: string;
      };
      const classification = classifyBashCommand(parsed.command);
      if (!classification.allowed) {
        return {
          behavior: "deny",
          message: `Bash command denied by workspace policy: ${classification.reason}`,
        };
      }
      return {
        behavior: "sandbox",
        message:
          "Bash commands run in the portable workspace sandbox by default. This MVP enforces workspace cwd, restricted env, timeout/output limits, and command policy checks.",
      };
    },
    async execute(input, context) {
      const parsed = input as {
        command: string;
        cwd?: string;
        timeout_ms?: number;
      };
      const cwd = parsed.cwd ? resolveWorkspacePath(parsed.cwd) : getWorkspaceRoot();
      await assertDirectory(cwd);
      const sandboxEnabled = context.sandbox?.enabled === true;

      try {
        const result = await exec(parsed.command, {
          cwd,
          env: sandboxEnabled ? buildPortableSandboxEnv(cwd) : process.env,
          timeout: parsed.timeout_ms ?? 30_000,
          maxBuffer: MAX_TOOL_OUTPUT_CHARS * 4,
          signal: context.signal,
        });
        return {
          command: parsed.command,
          cwd: toWorkspaceRelative(cwd),
          sandbox: sandboxEnabled
            ? {
                enabled: true,
                kind: context.sandbox?.kind ?? "portable",
                reason: context.sandbox?.reason,
              }
            : { enabled: false },
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
          sandbox: sandboxEnabled
            ? {
                enabled: true,
                kind: context.sandbox?.kind ?? "portable",
                reason: context.sandbox?.reason,
              }
            : { enabled: false },
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

function classifyBashCommand(command: string): {
  allowed: boolean;
  readOnly: boolean;
  reason?: string;
} {
  const trimmed = command.trim();
  if (!trimmed) return { allowed: false, readOnly: false, reason: "empty command" };

  const hardDenyReason = getHardDeniedBashReason(trimmed);
  if (hardDenyReason) return { allowed: false, readOnly: false, reason: hardDenyReason };

  const pathDenyReason = getOutsideWorkspacePathReason(trimmed);
  if (pathDenyReason) return { allowed: false, readOnly: false, reason: pathDenyReason };

  const commandNames = extractBashCommandNames(trimmed);
  const readOnly =
    commandNames.length > 0 &&
    commandNames.every((name) =>
      [
        "pwd",
        "ls",
        "cat",
        "head",
        "tail",
        "wc",
        "grep",
        "rg",
        "find",
        "git",
        "diff",
        "test",
        "[",
        "echo",
        "sed",
      ].includes(name),
    ) &&
    !/\bsed\s+(-[^\s]*i|--in-place)\b/.test(trimmed) &&
    !/\bgit\s+(add|commit|push|reset|checkout|clean|merge|rebase|pull|switch|restore|tag)\b/.test(
      trimmed,
    );

  return { allowed: true, readOnly };
}

function getHardDeniedBashReason(command: string): string | undefined {
  if (/`/.test(command)) {
    return "backtick command substitution is not allowed";
  }
  if (/\$\s*\(/.test(command)) {
    return "command substitution with $() is not allowed";
  }
  if (/(^|[^<])>>?|&>|2>/.test(command)) {
    return "shell output redirection is not allowed; use Write/Edit for file changes";
  }
  if (/<<-?/.test(command)) {
    return "heredoc shell input is not allowed";
  }
  if (/\b(?:curl|wget)\b[\s\S]*\|[\s\S]*\b(?:sh|bash|zsh|python|node|ruby|perl)\b/i.test(command)) {
    return "piping downloaded content into an interpreter is not allowed";
  }
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|update|upgrade|dlx|create)\b/.test(command)) {
    return "package mutation commands are not allowed from Bash";
  }
  if (/\b(?:pip|pip3|uv)\s+(?:install|uninstall|sync|add|remove)\b/.test(command)) {
    return "Python package mutation commands are not allowed from Bash";
  }
  if (/\bgit\s+(?:push|commit|reset|checkout|clean|merge|rebase|pull|switch|restore|tag)\b/.test(command)) {
    return "git mutation commands are not allowed from Bash";
  }
  if (/\bsed\s+(-[^\s]*i|--in-place)\b/.test(command)) {
    return "in-place sed edits are not allowed; use Edit instead";
  }

  const deniedCommand = extractBashCommandNames(command).find((name) =>
    DENIED_BASH_COMMANDS.has(name),
  );
  if (deniedCommand) return `command '${deniedCommand}' is not allowed`;

  return undefined;
}

function getOutsideWorkspacePathReason(command: string): string | undefined {
  const root = getWorkspaceRoot();
  for (const token of tokenizeShellLike(command)) {
    const value = token.replace(/^["']|["']$/g, "");
    if (!value.startsWith("/") || value.startsWith("//")) continue;
    if (/^https?:\/\//i.test(value)) continue;

    const normalized = path.resolve(value);
    const relative = path.relative(root, normalized);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return `absolute path outside workspace is not allowed: ${value}`;
    }
  }
  return undefined;
}

function extractBashCommandNames(command: string): string[] {
  const segments = command
    .split(/&&|\|\||[;|]/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments
    .map((segment) => {
      const token = tokenizeShellLike(segment).find((part) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(part));
      if (!token) return "";
      return path.basename(token.replace(/^["']|["']$/g, ""));
    })
    .filter(Boolean);
}

function tokenizeShellLike(command: string): string[] {
  return command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

function buildPortableSandboxEnv(cwd: string): NodeJS.ProcessEnv {
  const allowedNames = [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "ComSpec",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
    "LANG",
    "LC_ALL",
  ];
  const env: NodeJS.ProcessEnv = {};

  for (const name of allowedNames) {
    const value = process.env[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }

  env.AGENT_WORKSPACE_ROOT = getWorkspaceRoot();
  env.PWD = cwd;
  return env;
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
