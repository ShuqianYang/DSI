# Context Provider And Window Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement production-useful `contextProvider.ts` and `contextWindowManager.ts` methods by adapting Claude Code's context injection and context-window governance patterns to this project's Agent Loop.

**Architecture:** Keep Claude Code's three-way split: `ContextProvider` loads runtime context, `PromptManager` renders prompt sections, and `ContextWindowManager` prepares exact model messages without breaking assistant tool-call/tool-result adjacency. Phase 1 deliberately avoids full LLM auto-compact; it implements deterministic context loading, budget enforcement, and safe truncation first.

**Tech Stack:** TypeScript 5, Express backend, Drizzle task tables, Zod-shaped `AgentMessage`, Node built-ins, local `tsx`/`tsc` verification.

---

## Claude Code Reference Points

Use these ideas from `S:/Projects/claude-code-analysis/analysis`:

- `04g-prompt-management.md`: `getUserContext()` injects `CLAUDE.md` and current date outside the static system prompt; `getSystemContext()` injects git status/cache-breaker style runtime state.
- `04f-context-management.md`: context-window handling reserves budget, trims low-value payloads before model calls, and protects against prompt-too-long loops.
- `05-differentiators-and-comparison.md`: full compact is not simple truncation; post-compact reinjection restores tool/file/plan state.
- `06-extra-findings.md`: memory/config file loading needs bounded include depth, path de-duplication, and explicit trust assumptions.

Adaptation for this repo:

- Do not implement full `compactConversation()` yet. This project does not yet have durable transcript/resume or a summary model path.
- Implement deterministic budget management in `ContextWindowManager` first.
- Keep tool-call adjacency intact: an assistant message with `toolCalls` must remain followed by matching `tool` messages, or both must be preserved as a unit.
- Keep context source loading bounded: small file list, max chars per file, no arbitrary `@include` execution in Phase 1.
- Treat Phase 1 budgeting as character budgeting, not token budgeting. Diagnostics must explicitly label `estimateMethod: "json-chars"` so later maintainers do not mistake it for model token accounting.

## File Structure

- Modify: `api/src/modules/agent-loop/contextProvider.ts`
  - Add concrete project/user/system context loading.
  - Read `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, and `CONTEXT.md` when present.
  - Add bounded `git status --short` capture.
  - Add task metadata context through Drizzle.

- Modify: `api/src/modules/agent-loop/contextWindowManager.ts`
  - Add `defaultContextWindowManager`.
  - Enforce message character budget.
  - Truncate large tool results.
  - Preserve tool-call groups.
  - Prefer truncating/removing tool-heavy groups before trimming user/system/assistant prose.
  - Add diagnostics through `PreparedModelMessages.contextSections`.

- Modify: `api/src/modules/agent-loop/runAgentLoop.ts`
  - Swap default from `noopContextWindowManager` to `defaultContextWindowManager`.
  - Keep `RunAgentLoopOptions.contextWindowManager` override intact.

- Create: `api/tests/test-context-provider.mjs`
  - Lightweight script test for date/project file/system context behavior.

- Create: `api/tests/test-context-window-manager.mjs`
  - Lightweight script test for budget trimming and tool-call adjacency.

- Optional follow-up later: `api/src/modules/agent-loop/contextCompactor.ts`
  - Only create this after transcript persistence exists.

## Task 1: Add Concrete Context Provider

**Files:**
- Modify: `api/src/modules/agent-loop/contextProvider.ts`
- Test: `api/tests/test-context-provider.mjs`

- [x] **Step 1: Write the context-provider test script**

Create `api/tests/test-context-provider.mjs`:

```js
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { defaultContextProvider } from "../src/modules/agent-loop/contextProvider.ts";

const root = path.resolve("tmp/context-provider-test");
await rm(root, { recursive: true, force: true });
await mkdir(path.join(root, ".claude"), { recursive: true });
await writeFile(path.join(root, "AGENTS.md"), "# Agent Rules\nUse project vocabulary.\n", "utf8");
await writeFile(path.join(root, "CONTEXT.md"), "# Glossary\nTask = agent run.\n", "utf8");
await writeFile(path.join(root, ".claude", "CLAUDE.md"), "# Local Claude\nPrefer concise replies.\n", "utf8");

const previousRoot = process.env.AGENT_WORKSPACE_ROOT;
process.env.AGENT_WORKSPACE_ROOT = root;

const input = {
  taskId: "task-test",
  query: "测试上下文",
  tools: [],
  toolUseContext: {
    taskId: "task-test",
    query: "测试上下文",
    messages: [],
    observations: [],
    options: { tools: [] },
    readFileState: new Map(),
    nestedMemoryAttachmentTriggers: new Set(),
    dynamicSkillDirTriggers: new Set(),
    discoveredSkillNames: new Set(),
  },
};

const userContext = await defaultContextProvider.getUserContext(input);
assert.match(userContext.currentDate, /Today's date is \d{4}-\d{2}-\d{2}/);
assert.match(userContext.projectInstructions, /AGENTS\.md/);
assert.match(userContext.projectInstructions, /Use project vocabulary/);
assert.match(userContext.projectInstructions, /\.claude\/CLAUDE\.md/);

const sections = await defaultContextProvider.getContextSections(input);
assert.equal(sections.some((section) => section.id === "project.domain"), true);
assert.match(sections.find((section) => section.id === "project.domain").content, /Task = agent run/);

const systemContext = await defaultContextProvider.getSystemContext(input);
assert.equal(systemContext.taskStatus, undefined);

const emptyRoot = path.resolve("tmp/context-provider-empty-test");
await rm(emptyRoot, { recursive: true, force: true });
await mkdir(emptyRoot, { recursive: true });
process.env.AGENT_WORKSPACE_ROOT = emptyRoot;
const emptyInput = {
  ...input,
  taskId: "missing-task",
  toolUseContext: { ...input.toolUseContext, taskId: "missing-task" },
};
const emptyUserContext = await defaultContextProvider.getUserContext(emptyInput);
assert.equal(emptyUserContext.projectInstructions, undefined);
const emptySystemContext = await defaultContextProvider.getSystemContext(emptyInput);
assert.equal(emptySystemContext.gitStatus, undefined);
assert.equal(emptySystemContext.taskStatus, undefined);

const longRoot = path.resolve("tmp/context-provider-long-test");
await rm(longRoot, { recursive: true, force: true });
await mkdir(longRoot, { recursive: true });
await writeFile(path.join(longRoot, "AGENTS.md"), "A".repeat(20_000), "utf8");
process.env.AGENT_WORKSPACE_ROOT = longRoot;
const longUserContext = await defaultContextProvider.getUserContext(input);
assert.match(longUserContext.projectInstructions, /\[truncated /);

if (previousRoot === undefined) {
  delete process.env.AGENT_WORKSPACE_ROOT;
} else {
  process.env.AGENT_WORKSPACE_ROOT = previousRoot;
}
await rm(root, { recursive: true, force: true });
await rm(emptyRoot, { recursive: true, force: true });
await rm(longRoot, { recursive: true, force: true });
console.log("context provider test passed");
```

- [x] **Step 2: Run the test to verify it fails**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-context-provider.mjs
```

Expected: FAIL because `projectInstructions`, `project.domain`, missing-file behavior, and long-file truncation are not all implemented yet.

- [x] **Step 3: Implement bounded context loading**

Modify `api/src/modules/agent-loop/contextProvider.ts`:

```ts
import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { db } from "../../config/database.js";
import { tasks, taskSteps } from "../../db/schema.js";
import { eq } from "drizzle-orm";
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

// Keep existing ContextProviderInput and ContextProvider interfaces.

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
```

Also add helper functions in the same file:

```ts
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

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}

function parsePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
```

- [x] **Step 4: Run the test to verify it passes**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-context-provider.mjs
```

Expected: PASS and prints `context provider test passed`.

- [x] **Step 5: Run backend typecheck**

Run from `api/`:

```powershell
.\node_modules\.bin\tsc.CMD
```

Expected: no TypeScript errors.

## Task 2: Implement Context Window Budgeting

**Files:**
- Modify: `api/src/modules/agent-loop/contextWindowManager.ts`
- Modify: `api/src/modules/agent-loop/runAgentLoop.ts`
- Test: `api/tests/test-context-window-manager.mjs`

- [x] **Step 1: Write the context-window test script**

Create `api/tests/test-context-window-manager.mjs`:

```js
import assert from "node:assert/strict";
import { defaultContextWindowManager } from "../src/modules/agent-loop/contextWindowManager.ts";

const messages = [
  { role: "system", content: "system ".repeat(200) },
  { role: "user", content: "first user message" },
  {
    role: "assistant",
    content: "need tool",
    toolCalls: [{ id: "call-1", toolName: "Read", input: { file_path: "a.ts" } }],
  },
  { role: "tool", toolCallId: "call-1", toolName: "Read", content: JSON.stringify({ output: "x".repeat(50_000) }) },
  { role: "user", content: "latest user question" },
];

const result = await defaultContextWindowManager.prepareMessages({
  messages,
  toolUseContext: {
    taskId: "task-window",
    query: "latest user question",
    messages,
    observations: [],
    options: { tools: [] },
    readFileState: new Map(),
    nestedMemoryAttachmentTriggers: new Set(),
    dynamicSkillDirTriggers: new Set(),
    discoveredSkillNames: new Set(),
  },
});

assert.equal(result.messages.at(0).role, "system");
assert.equal(result.messages.at(-1).content, "latest user question");
const assistantIndex = result.messages.findIndex((message) => message.role === "assistant" && message.toolCalls?.length);
if (assistantIndex !== -1) {
  assert.equal(result.messages[assistantIndex + 1]?.role, "tool");
  assert.equal(result.messages[assistantIndex + 1]?.toolCallId, "call-1");
  assert.ok(result.messages[assistantIndex + 1].content.length < 16_500);
  assert.match(result.messages[assistantIndex + 1].content, /\[truncated /);
}
assert.ok(JSON.stringify(result.messages).length < JSON.stringify(messages).length);
assert.equal(result.contextSections?.some((section) => section.id === "context_window.diagnostics"), true);
const diagnostics = JSON.parse(result.contextSections.find((section) => section.id === "context_window.diagnostics").content);
assert.equal(diagnostics.estimateMethod, "json-chars");
assert.equal(typeof diagnostics.removedTurns, "number");
console.log("context window manager test passed");
```

- [x] **Step 2: Run the test to verify it fails**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-context-window-manager.mjs
```

Expected: FAIL because `defaultContextWindowManager` is not exported yet.

- [x] **Step 3: Implement `defaultContextWindowManager`**

Modify `api/src/modules/agent-loop/contextWindowManager.ts`:

```ts
const DEFAULT_CONTEXT_WINDOW_CHARS = parsePositiveIntegerEnv(
  process.env.AGENT_CONTEXT_WINDOW_CHARS,
  120_000,
);
const DEFAULT_SUMMARY_RESERVE_CHARS = parsePositiveIntegerEnv(
  process.env.AGENT_CONTEXT_SUMMARY_RESERVE_CHARS,
  12_000,
);
const DEFAULT_TOOL_MESSAGE_MAX_CHARS = parsePositiveIntegerEnv(
  process.env.AGENT_TOOL_MESSAGE_MAX_CHARS,
  16_000,
);
const MIN_MESSAGES_TO_KEEP = 2;

export const defaultContextWindowManager: ContextWindowManager = {
  async prepareMessages(input) {
    const effectiveBudget = Math.max(
      20_000,
      DEFAULT_CONTEXT_WINDOW_CHARS - DEFAULT_SUMMARY_RESERVE_CHARS,
    );
    const compressedToolMessages = input.messages.map((message) =>
      message.role === "tool" ? truncateMessageContent(message, DEFAULT_TOOL_MESSAGE_MAX_CHARS) : message
    );
    const messages = trimToBudgetPreservingToolGroups(compressedToolMessages, effectiveBudget);
    const diagnostics = buildContextWindowDiagnostics(input.messages, messages, effectiveBudget);
    return {
      messages,
      contextSections: [
        {
          id: "context_window.diagnostics",
          content: JSON.stringify(diagnostics),
        },
      ],
    };
  },
};
```

Add helper functions in the same file:

```ts
function trimToBudgetPreservingToolGroups(messages: AgentMessage[], budgetChars: number): AgentMessage[] {
  if (estimateMessagesChars(messages) <= budgetChars) return messages;
  const groups = groupMessages(messages);
  while (groups.length > MIN_MESSAGES_TO_KEEP && estimateMessagesChars(groups.flat()) > budgetChars) {
    const removableIndex = chooseGroupToRemove(groups);
    if (removableIndex === -1) break;
    groups.splice(removableIndex, 1);
  }
  const trimmed = groups.flat();
  if (estimateMessagesChars(trimmed) <= budgetChars) return trimmed;
  return trimSingleLargeMessages(trimmed, budgetChars);
}

function groupMessages(messages: AgentMessage[]): AgentMessage[][] {
  const groups: AgentMessage[][] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "assistant" && message.toolCalls?.length) {
      const toolCallIds = new Set(message.toolCalls.map((toolCall) => toolCall.id));
      const group = [message];
      let cursor = index + 1;
      while (cursor < messages.length && messages[cursor].role === "tool") {
        const toolMessage = messages[cursor];
        if (!toolMessage.toolCallId || !toolCallIds.has(toolMessage.toolCallId)) break;
        group.push(toolMessage);
        cursor += 1;
      }
      groups.push(group);
      index = cursor - 1;
      continue;
    }
    groups.push([message]);
  }
  return groups;
}

function chooseGroupToRemove(groups: AgentMessage[][]): number {
  const candidates = groups
    .map((group, index) => ({ group, index, chars: estimateMessagesChars(group) }))
    .filter((candidate) => candidate.index > 0 && candidate.index < groups.length - 1);
  if (candidates.length === 0) return -1;

  const toolHeavy = candidates
    .filter((candidate) => candidate.group.some((message) => message.role === "tool"))
    .sort((left, right) => right.chars - left.chars || left.index - right.index);
  if (toolHeavy.length > 0) return toolHeavy[0].index;

  return candidates.sort((left, right) => left.index - right.index)[0].index;
}

function trimSingleLargeMessages(messages: AgentMessage[], budgetChars: number): AgentMessage[] {
  let next = messages.map((message) =>
    message.role === "tool" ? truncateMessageContent(message, DEFAULT_TOOL_MESSAGE_MAX_CHARS) : message
  );
  if (estimateMessagesChars(next) <= budgetChars) return next;

  const nonToolBudget = Math.max(2_000, Math.floor(budgetChars / Math.max(next.length, 1)));
  next = next.map((message) =>
    message.role === "tool" ? message : truncateMessageContent(message, nonToolBudget)
  );
  return next;
}

function truncateMessageContent(message: AgentMessage, maxChars: number): AgentMessage {
  if (message.content.length <= maxChars) return message;
  return {
    ...message,
    content: `${message.content.slice(0, maxChars)}\n\n[truncated ${message.content.length - maxChars} chars by ContextWindowManager]`,
  };
}

function estimateMessagesChars(messages: AgentMessage[]): number {
  return JSON.stringify(messages).length;
}

function buildContextWindowDiagnostics(
  originalMessages: AgentMessage[],
  preparedMessages: AgentMessage[],
  effectiveBudget: number,
): Record<string, unknown> {
  return {
    estimateMethod: "json-chars",
    originalChars: estimateMessagesChars(originalMessages),
    preparedChars: estimateMessagesChars(preparedMessages),
    effectiveBudget,
    removedMessages: originalMessages.length - preparedMessages.length,
    removedTurns: countUserMessages(originalMessages) - countUserMessages(preparedMessages),
  };
}

function countUserMessages(messages: AgentMessage[]): number {
  return messages.filter((message) => message.role === "user").length;
}

function parsePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
```

- [x] **Step 4: Use default manager in the loop**

Modify `api/src/modules/agent-loop/runAgentLoop.ts` import:

```ts
import {
  defaultContextWindowManager,
  type ContextWindowManager,
} from "./contextWindowManager.js";
```

Modify default selection:

```ts
const contextWindowManager = options.contextWindowManager ?? defaultContextWindowManager;
```

- [x] **Step 5: Run the context-window test**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-context-window-manager.mjs
```

Expected: PASS and prints `context window manager test passed`.

- [x] **Step 6: Run backend typecheck**

Run from `api/`:

```powershell
.\node_modules\.bin\tsc.CMD
```

Expected: no TypeScript errors.

## Task 3: Protect Tool-Call Adjacency With A Regression Case

**Files:**
- Modify: `api/tests/test-context-window-manager.mjs`

- [x] **Step 1: Add a second regression case**

Append this to `api/tests/test-context-window-manager.mjs`:

```js
const adjacencyMessages = [
  { role: "system", content: "system" },
  { role: "user", content: "old ".repeat(3000) },
  {
    role: "assistant",
    content: "calling tools",
    toolCalls: [
      { id: "call-a", toolName: "Read", input: { file_path: "a.ts" } },
      { id: "call-b", toolName: "Grep", input: { pattern: "foo" } },
    ],
  },
  { role: "tool", toolCallId: "call-a", toolName: "Read", content: "read-result" },
  { role: "tool", toolCallId: "call-b", toolName: "Grep", content: "grep-result" },
  { role: "user", content: "new question" },
];

const adjacencyResult = await defaultContextWindowManager.prepareMessages({
  messages: adjacencyMessages,
  toolUseContext: {
    taskId: "task-window-adjacency",
    query: "new question",
    messages: adjacencyMessages,
    observations: [],
    options: { tools: [] },
    readFileState: new Map(),
    nestedMemoryAttachmentTriggers: new Set(),
    dynamicSkillDirTriggers: new Set(),
    discoveredSkillNames: new Set(),
  },
});

for (let index = 0; index < adjacencyResult.messages.length; index += 1) {
  const message = adjacencyResult.messages[index];
  if (message.role !== "assistant" || !message.toolCalls?.length) continue;
  const expectedIds = message.toolCalls.map((toolCall) => toolCall.id);
  const actualIds = adjacencyResult.messages
    .slice(index + 1, index + 1 + expectedIds.length)
    .map((toolMessage) => toolMessage.toolCallId);
  assert.deepEqual(actualIds, expectedIds);
}
```

- [x] **Step 2: Run the regression script**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-context-window-manager.mjs
```

Expected: PASS.

## Task 4: Update Agent Loop Documentation

**Files:**
- Modify: `api/src/todo.md`
- Modify: `docs/agents/tool-registration.md`

- [x] **Step 1: Document the default implementations**

In `api/src/todo.md`, update the `Context Provider` and `Context Window` sections to record:

```md
Implemented Phase 1:

- `defaultContextProvider.getUserContext()` injects current date and bounded project instruction files.
- `defaultContextProvider.getSystemContext()` injects workspace root, bounded git status, and task status when available.
- `defaultContextProvider.getContextSections()` injects bounded `CONTEXT.md` as `project.domain`.
- `defaultContextWindowManager.prepareMessages()` enforces a character budget, truncates large tool messages, and preserves assistant/tool adjacency.

Deferred:

- LLM summary compaction.
- post-compact reinjection of file state and skill/tool declarations.
- durable transcript-based resume.
```

- [x] **Step 2: Document context-window invariants**

In `docs/agents/tool-registration.md`, add:

```md
## Context-window invariants

`ContextWindowManager` may truncate content and remove old message groups, but it must preserve tool-call adjacency:

- If an assistant message with `toolCalls` remains, its matching `tool` messages must remain immediately after it.
- A tool result must not remain without the assistant tool call that created it.
- The latest user request must remain.
- The system message should remain unless a future prompt manager deliberately replaces it.
```

- [x] **Step 3: Run typecheck**

Run from `api/`:

```powershell
.\node_modules\.bin\tsc.CMD
```

Expected: no TypeScript errors.

## Task 5: Acceptance Checklist

- [x] `api/tests/test-context-provider.mjs` passes.
- [x] `api/tests/test-context-window-manager.mjs` passes.
- [x] `api/node_modules/.bin/tsc.CMD` passes from `api/`.
- [x] `defaultContextProvider` is the default in `runAgentLoop.ts`.
- [x] `defaultContextWindowManager` is the default in `runAgentLoop.ts`.
- [x] PromptManager remains responsible only for rendering sections.
- [x] ContextProvider does not include memory or skills.
- [x] ContextWindowManager does not fetch context or call models.
- [x] No assistant tool-call message is separated from its tool messages.
- [x] README or `api/src/todo.md` no longer claims these two modules are pure noop.

## Deferred Phase 2: Claude Code-Style Compact

Do this only after transcript persistence exists.

Recommended sequence:

1. Add database-backed `AgentTranscriptStore`.
2. Add `contextCompactor.ts` with a `compactMessages(messages, toolUseContext)` interface.
3. Summarize old message groups into one synthetic summary message.
4. Reinject current file state from `toolUseContext.readFileState`.
5. Reinject active skill/tool listing sections.
6. Add a circuit breaker: stop compaction after 3 consecutive failures for a task.
7. Add a prompt-too-long fallback that removes the oldest 20% of compact input groups before retrying.

This mirrors Claude Code's `autoCompactIfNeeded()` and `buildPostCompactMessages()` strategy without prematurely importing its full complexity.
