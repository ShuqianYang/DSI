# Memory MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Memory MVP that recalls bounded summaries from recent completed tasks for the same user, injecting them as `memorySections` without writing long-term memory.

**Architecture:** Keep ContextProvider task-scoped and leave `transcript.resume_context` unchanged. Add a dedicated `SessionSummaryMemoryManager` that runs through the existing `MemoryManager.startRelevantMemoryPrefetch()` hook, loads recent same-user completed tasks, converts their transcripts into bounded `memory.session_summary.*` sections, and fail-closes on database or transcript errors. Gate pipeline usage behind an environment variable so production behavior changes only when explicitly enabled.

**Tech Stack:** TypeScript 5, existing `MemoryManager`, Drizzle `tasks`, existing `AgentTranscriptStore`, existing `summarizeTranscriptForContext()`, script tests via local `tsx`, backend typecheck via local `tsc`.

---

## Current State

Already available:

- `api/src/modules/agent-loop/memoryManager.ts`
  - Defines `MemoryManager`, `RememberInput`, `startRelevantMemoryPrefetch()`, optional `filterDuplicateMemorySections()`, and optional `remember()`.
- `api/src/modules/agent-loop/runAgentLoop.ts`
  - Starts memory prefetch before the loop.
  - Consumes settled memory prefetch after tool execution.
  - Appends returned sections into `memorySections`.
  - Passes `memorySections` into `PromptManager`.
  - Calls `memoryManager.remember()` after final answer when implemented.
- `api/src/modules/agent-loop/transcriptStore.ts`
  - Provides `summarizeTranscriptForContext()` with bounded JSON-safe transcript summaries.
- `api/src/modules/tasks/pipeline.ts`
  - Currently does not pass a memory manager, so Agent Loop uses `noopMemoryManager`.
- `api/src/db/schema.ts`
  - `tasks` has `userId`, `status`, `createdAt`, `completedAt`.
  - `agent_transcript_entries` is keyed by `taskId`.

## MVP Scope

In scope:

- Read-only recall from recent completed tasks with the same `userId`.
- No recall when current task has no `userId`.
- No recall from the current `taskId`.
- Bounded `memory.session_summary.<taskId>` sections.
- Fail-closed memory lookup.
- Dedupe by section id.
- Pipeline env-gated opt-in.
- Tests proving memory sections reach model requests.

Out of scope:

- automatic long-term memory writes
- user preference extraction
- project-level memory files
- vector search or semantic retrieval
- model-generated summary compression
- cross-user recall
- editing stored memories
- UI for memory inspection

## Design Decisions

Section id:

```text
memory.session_summary.<taskId>
```

Section content:

```json
{
  "source": "recent_completed_task",
  "taskId": "...",
  "query": "...",
  "completedAt": "...",
  "summary": {
    "stoppedBy": "final_answer",
    "finalAnswerPreview": "...",
    "recentTools": []
  }
}
```

Limits:

- `AGENT_MEMORY_SESSION_SUMMARY=1` enables the pipeline integration.
- `AGENT_MEMORY_RECENT_TASK_LIMIT`, default `3`.
- `AGENT_MEMORY_SECTION_MAX_CHARS`, default `3000`.
- Total memory sections should remain small. MVP should not add a global memory budget manager.

Failure behavior:

- DB failure returns no memory sections and logs a warning.
- transcript load failure for one candidate skips that candidate.
- invalid transcript summary JSON skips that candidate.
- memory recall must never fail the user task.

## File Structure

- Create: `api/src/modules/agent-loop/sessionSummaryMemoryManager.ts`
  - Implements read-only same-user recent task recall.
  - Exports testable helpers.

- Modify: `api/src/modules/agent-loop/tools/_shared/serialization.ts`
  - Export shared `truncateText()` helper so memory does not add a third truncation implementation.

- Modify: `api/src/modules/tasks/pipeline.ts`
  - Adds env-gated `memoryManager` injection.
  - Reads the persisted current task row to get `userId`; do not rely on `CreateTaskRequest.userId`.

- Modify: `api/src/modules/agent-loop/runAgentLoop.ts`
  - Consume settled memory prefetch before prompt assembly so read-only memory can affect the first model request when recall is fast.

- Test: `api/tests/agent-loop/test-session-summary-memory-manager.mjs`
  - Unit tests for section generation, fail-closed behavior, current-task exclusion, and dedupe.

- Test: `api/tests/agent-loop/test-agent-loop-session-memory.mjs`
  - Integration test proving `memorySections` appear in a model request.

- Modify: `api/plan/agent-loop-migration-roadmap.md`
  - Mark Memory MVP status after implementation.

---

## Task 1: Add Session Summary Memory Manager Unit Tests

**Files:**

- Create: `api/tests/agent-loop/test-session-summary-memory-manager.mjs`

- [x] **Step 1: Write the failing test**

Create `api/tests/agent-loop/test-session-summary-memory-manager.mjs`:

```js
import assert from "node:assert/strict";

const {
  createSessionSummaryMemoryManager,
  formatSessionMemorySection,
} = await import("../../src/modules/agent-loop/sessionSummaryMemoryManager.ts");

const currentTaskId = "00000000-0000-0000-0000-000000000001";
const priorTaskId = "00000000-0000-0000-0000-000000000002";
const otherTaskId = "00000000-0000-0000-0000-000000000003";

const priorTask = {
  id: priorTaskId,
  userId: "user-1",
  query: "圈选台湾海峡并查询风场",
  status: "completed",
  completedAt: new Date("2026-06-15T10:00:00.000Z"),
};

const section = formatSessionMemorySection({
  task: priorTask,
  transcriptSummary: {
    taskId: priorTaskId,
    stoppedBy: "final_answer",
    finalAnswerPreview: "台湾海峡风场已查询。",
    recentTools: [{ toolName: "WeatherFetch", toolCallId: "call-1", ok: true, error: null }],
  },
  maxChars: 3000,
});

assert.equal(section.id, `memory.session_summary.${priorTaskId}`);
assert.match(section.content, /recent_completed_task/);
assert.match(section.content, /台湾海峡风场已查询/);
assert(section.content.length <= 3000);

const loadedTaskIds = [];
const warnings = [];
const manager = createSessionSummaryMemoryManager({
  enabled: true,
  currentTaskId,
  currentUserId: "user-1",
  recentTaskLimit: 3,
  listRecentCompletedTasks: async ({ userId, excludeTaskId, limit }) => {
    assert.equal(userId, "user-1");
    assert.equal(excludeTaskId, currentTaskId);
    assert.equal(limit, 3);
    return [
      priorTask,
      {
        id: otherTaskId,
        userId: "user-1",
        query: "无 transcript 的任务",
        status: "completed",
        completedAt: new Date("2026-06-14T10:00:00.000Z"),
      },
    ];
  },
  transcriptStore: {
    async append() {
      throw new Error("append should not be called");
    },
    async load(taskId) {
      loadedTaskIds.push(taskId);
      if (taskId === otherTaskId) throw new Error("one transcript failed");
      return [
        {
          taskId,
          turn: 1,
          sequence: 1,
          kind: "assistant_message",
          message: { role: "assistant", content: "台湾海峡风场已查询。" },
        },
        {
          taskId,
          turn: 1,
          sequence: 2,
          kind: "loop_stop",
          stoppedBy: "final_answer",
          finalAnswer: "台湾海峡风场已查询。",
        },
      ];
    },
  },
  logger: { warn: (...args) => warnings.push(args) },
});

const prefetch = manager.startRelevantMemoryPrefetch(
  [{ role: "user", content: "再查一下台湾海峡" }],
  {
    taskId: currentTaskId,
    query: "再查一下台湾海峡",
    messages: [],
    observations: [],
    options: { tools: [] },
    readFileState: new Map(),
    todoState: [],
    nestedMemoryAttachmentTriggers: new Set(),
    dynamicSkillDirTriggers: new Set(),
    discoveredSkillNames: new Set(),
    invokedSkillSections: [],
  }
);

assert(prefetch);
assert.equal(prefetch.settledAt, null);
assert.equal(prefetch.consumedOnIteration, -1);

const sections = await prefetch.promise;
assert.equal(prefetch.settledAt > 0, true);
assert.deepEqual(loadedTaskIds, [priorTaskId, otherTaskId]);
assert.equal(sections.length, 1);
assert.equal(sections[0].id, `memory.session_summary.${priorTaskId}`);
assert.equal(warnings.length, 1);
assert.equal(warnings[0][0], "[Memory] session summary candidate failed:");

const deduped = manager.filterDuplicateMemorySections?.([sections[0], sections[0]], {
  taskId: currentTaskId,
  query: "再查一下台湾海峡",
  messages: [],
  observations: [],
  options: { tools: [] },
  readFileState: new Map(),
  todoState: [],
  nestedMemoryAttachmentTriggers: new Set(),
  dynamicSkillDirTriggers: new Set(),
  discoveredSkillNames: new Set(),
  invokedSkillSections: [],
});
assert.equal(deduped.length, 1);
assert.equal(deduped[0].id, `memory.session_summary.${priorTaskId}`);

const disabled = createSessionSummaryMemoryManager({
  enabled: false,
  currentTaskId,
  currentUserId: "user-1",
  transcriptStore: manager.transcriptStore,
  listRecentCompletedTasks: async () => {
    throw new Error("should not list tasks when disabled");
  },
});
assert.equal(disabled.startRelevantMemoryPrefetch([], { taskId: currentTaskId }), undefined);

const noUser = createSessionSummaryMemoryManager({
  enabled: true,
  currentTaskId,
  currentUserId: null,
  transcriptStore: manager.transcriptStore,
  listRecentCompletedTasks: async () => {
    throw new Error("should not list tasks without user id");
  },
});
assert.equal(noUser.startRelevantMemoryPrefetch([], { taskId: currentTaskId }), undefined);

console.log("session summary memory manager test passed");
```

- [x] **Step 2: Run the test and verify it fails**

Run:

```powershell
cd api
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-session-summary-memory-manager.mjs
```

Expected: FAIL because `sessionSummaryMemoryManager.ts` does not exist.

## Task 2: Implement Session Summary Memory Manager

**Files:**

- Modify: `api/src/modules/agent-loop/tools/_shared/serialization.ts`
- Create: `api/src/modules/agent-loop/sessionSummaryMemoryManager.ts`

- [x] **Step 1: Add shared truncation helper**

In `api/src/modules/agent-loop/tools/_shared/serialization.ts`, add:

```ts
export function truncateText(value: unknown, maxChars: number): string {
  const text = typeof value === "string" ? value : "";
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  if (maxChars < 3) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 3)}...`;
}
```

- [x] **Step 2: Create the manager**

Create `api/src/modules/agent-loop/sessionSummaryMemoryManager.ts`:

```ts
import { desc, eq, and, ne } from "drizzle-orm";
import { tasks } from "../../db/schema.js";
import type { AgentTranscriptStore } from "./transcriptStore.js";
import { summarizeTranscriptForContext } from "./transcriptStore.js";
import type { MemoryManager } from "./memoryManager.js";
import { truncateText } from "./tools/_shared/serialization.js";
import type { AgentLoopPrefetch, PromptSection } from "./tools/_shared/types.js";

const DEFAULT_RECENT_TASK_LIMIT = 3;
const DEFAULT_SECTION_MAX_CHARS = 3000;

export interface SessionMemoryTaskSummary {
  id: string;
  userId: string | null;
  query: string;
  status: string;
  completedAt: Date | string | null;
}

export interface ListRecentCompletedTasksInput {
  userId: string;
  excludeTaskId: string;
  limit: number;
}

export interface CreateSessionSummaryMemoryManagerInput {
  enabled: boolean;
  currentTaskId: string;
  currentUserId?: string | null;
  recentTaskLimit?: number;
  maxSectionChars?: number;
  transcriptStore: AgentTranscriptStore;
  listRecentCompletedTasks(input: ListRecentCompletedTasksInput): Promise<SessionMemoryTaskSummary[]>;
  logger?: Pick<Console, "warn">;
}

export interface FormatSessionMemorySectionInput {
  task: SessionMemoryTaskSummary;
  transcriptSummary: Record<string, unknown>;
  maxChars: number;
}

export function createSessionSummaryMemoryManager(
  input: CreateSessionSummaryMemoryManagerInput
): MemoryManager & { transcriptStore: AgentTranscriptStore } {
  const logger = input.logger ?? console;
  const recentTaskLimit = positiveIntegerOrDefault(input.recentTaskLimit, DEFAULT_RECENT_TASK_LIMIT);
  const maxSectionChars = Math.max(
    200,
    positiveIntegerOrDefault(input.maxSectionChars, DEFAULT_SECTION_MAX_CHARS)
  );

  return {
    transcriptStore: input.transcriptStore,
    startRelevantMemoryPrefetch(): AgentLoopPrefetch | undefined {
      if (!input.enabled || !input.currentUserId) return undefined;

      let settledAt: number | null = null;
      const prefetch: AgentLoopPrefetch = {
        settledAt,
        consumedOnIteration: -1,
        promise: Promise.resolve().then(async () => {
          try {
            const recentTasks = await input.listRecentCompletedTasks({
              userId: input.currentUserId!,
              excludeTaskId: input.currentTaskId,
              limit: recentTaskLimit,
            });
            const sections: PromptSection[] = [];
            for (const task of recentTasks) {
              try {
                if (task.id === input.currentTaskId) continue;
                const transcriptSection = summarizeTranscriptForContext(
                  await input.transcriptStore.load(task.id)
                );
                if (!transcriptSection) continue;
                const transcriptSummary = parseTranscriptSummary(transcriptSection.content);
                if (!transcriptSummary) continue;
                sections.push(formatSessionMemorySection({
                  task,
                  transcriptSummary,
                  maxChars: maxSectionChars,
                }));
              } catch (error) {
                logger.warn(
                  "[Memory] session summary candidate failed:",
                  task.id,
                  error instanceof Error ? error.message : String(error)
                );
              }
            }
            return sections;
          } catch (error) {
            logger.warn(
              "[Memory] session summary recall failed:",
              error instanceof Error ? error.message : String(error)
            );
            return [];
          } finally {
            prefetch.settledAt = Date.now();
          }
        }),
      };
      return prefetch;
    },
    filterDuplicateMemorySections(sections) {
      const seen = new Set<string>();
      return sections.filter((section) => {
        if (seen.has(section.id)) return false;
        seen.add(section.id);
        return true;
      });
    },
  };
}

export function formatSessionMemorySection(input: FormatSessionMemorySectionInput): PromptSection {
  return {
    id: `memory.session_summary.${input.task.id}`,
    content: truncateText(JSON.stringify({
      source: "recent_completed_task",
      taskId: input.task.id,
      query: input.task.query,
      completedAt: input.task.completedAt,
      summary: input.transcriptSummary,
    }, null, 2), input.maxChars),
  };
}

export function createDbRecentTaskLister(database: {
  select(): {
    from(table: typeof tasks): {
      where(condition: unknown): {
        orderBy(...columns: unknown[]): {
          limit(limit: number): Promise<SessionMemoryTaskSummary[]>;
        };
      };
    };
  };
}) {
  return async function listRecentCompletedTasks(input: ListRecentCompletedTasksInput) {
    return database
      .select()
      .from(tasks)
      .where(and(
        eq(tasks.userId, input.userId),
        eq(tasks.status, "completed"),
        ne(tasks.id, input.excludeTaskId)
      ))
      .orderBy(desc(tasks.completedAt), desc(tasks.createdAt))
      .limit(input.limit);
  };
}

function parseTranscriptSummary(content: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function positiveIntegerOrDefault(value: unknown, fallback: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(1, Math.floor(numberValue));
}
```

- [x] **Step 3: Run the unit test**

Run:

```powershell
cd api
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-session-summary-memory-manager.mjs
```

Expected: PASS and prints:

```text
session summary memory manager test passed
```

## Task 3: Consume Settled Memory Before Prompt Assembly

**Files:**

- Modify: `api/src/modules/agent-loop/runAgentLoop.ts`
- Test: `api/tests/agent-loop/test-agent-loop-session-memory.mjs`

- [x] **Step 1: Write integration test**

Create `api/tests/agent-loop/test-agent-loop-session-memory.mjs`:

```js
import assert from "node:assert/strict";

const { runAgentLoopEvents } = await import("../../src/modules/agent-loop/runAgentLoop.ts");

const taskId = crypto.randomUUID();
const query = "继续分析台湾海峡";
const modelRequests = [];

const memoryManager = {
  startRelevantMemoryPrefetch() {
    return {
      settledAt: Date.now(),
      consumedOnIteration: -1,
      promise: Promise.resolve([
        {
          id: "memory.session_summary.prior-task",
          content: JSON.stringify({
            source: "recent_completed_task",
            query: "圈选台湾海峡并查询风场",
            summary: { finalAnswerPreview: "台湾海峡风场已查询。" },
          }),
        },
      ]),
    };
  },
  filterDuplicateMemorySections(sections) {
    return sections;
  },
};

const modelClient = {
  async decide(input) {
    modelRequests.push(input.messages);
    return { type: "final_answer", content: "已参考上一轮会话摘要。" };
  },
};

const contextProvider = {
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

let result;
for await (const event of runAgentLoopEvents({
  taskId,
  query,
  modelClient,
  contextProvider,
  memoryManager,
  fileLogger: false,
  maxTurns: 2,
})) {
  if (event.type === "loop_stop") result = event.result;
}

assert.equal(result.stoppedBy, "final_answer");
assert.equal(modelRequests.length, 1);
assert(modelRequests[0][0].content.includes("## memory.session_summary.prior-task"));
assert(modelRequests[0][0].content.includes("台湾海峡风场已查询"));

console.log("agent loop session memory test passed");
```

- [x] **Step 2: Run the test and verify it fails**

Run:

```powershell
cd api
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-agent-loop-session-memory.mjs
```

Expected: FAIL because memory prefetch is not consumed before first prompt assembly.

- [x] **Step 3: Consume memory before prompt assembly**

In `api/src/modules/agent-loop/runAgentLoop.ts`, before building `promptInput`, add:

```ts
const prePromptMemorySections = await consumeMemoryPrefetchIfReady({
  prefetch: memoryPrefetch,
  turn,
  memoryManager,
  toolUseContext,
});
if (prePromptMemorySections.length > 0) {
  memorySections = [...memorySections, ...prePromptMemorySections];
}
```

Keep the existing post-tool consume call. `consumeMemoryPrefetchIfReady()` already checks `consumedOnIteration !== -1`, so the same prefetch will not be injected twice.

- [x] **Step 4: Run integration test**

Run:

```powershell
cd api
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-agent-loop-session-memory.mjs
```

Expected: PASS and prints:

```text
agent loop session memory test passed
```

## Task 4: Wire Memory MVP Into Pipeline Behind Env Flag

**Files:**

- Modify: `api/src/modules/tasks/pipeline.ts`
- Create: `api/src/modules/tasks/pipelineMemory.ts`
- Test: `api/tests/agent-loop/test-session-summary-memory-manager.mjs`
- Test: `api/tests/agent-loop/test-pipeline-memory-manager.mjs`

- [x] **Step 1: Add imports**

In `api/src/modules/tasks/pipeline.ts`, add:

```ts
import {
  createDbRecentTaskLister,
  createSessionSummaryMemoryManager,
} from "../agent-loop/sessionSummaryMemoryManager.js";
```

- [x] **Step 2: Create one transcript store variable**

Replace:

```ts
const loopResult = await runAgentLoop({
  taskId,
  query: body.query,
  fileLogger,
  transcriptStore: createBestEffortTranscriptStore(createDbTranscriptStore(db), console),
});
```

with:

```ts
const transcriptStore = createDbTranscriptStore(db);
const memoryEnabled = process.env.AGENT_MEMORY_SESSION_SUMMARY === "1";
const currentTask = await taskService.getTaskById(taskId);
const loopResult = await runAgentLoop({
  taskId,
  query: body.query,
  fileLogger,
  transcriptStore: createBestEffortTranscriptStore(transcriptStore, console),
  memoryManager: createSessionSummaryMemoryManager({
    enabled: memoryEnabled,
    currentTaskId: taskId,
    currentUserId: currentTask?.userId ?? null,
    recentTaskLimit: parseMemoryIntegerEnv(process.env.AGENT_MEMORY_RECENT_TASK_LIMIT),
    maxSectionChars: parseMemoryIntegerEnv(process.env.AGENT_MEMORY_SECTION_MAX_CHARS),
    transcriptStore,
    listRecentCompletedTasks: createDbRecentTaskLister(db),
    logger: console,
  }),
});
```

Do not infer user id from query text. If `currentTask?.userId` is missing, the memory manager must return no prefetch.

- [x] **Step 3: Add env integer parser**

In `api/src/modules/tasks/pipeline.ts`, add near the bottom:

```ts
function parseMemoryIntegerEnv(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
```

Invalid env values intentionally become `undefined`; `createSessionSummaryMemoryManager()` applies defaults.

- [x] **Step 4: Run typecheck**

Run:

```powershell
cd api
..\node_modules\.bin\tsc.CMD
```

Expected: PASS.

## Task 5: Documentation And Regression

**Files:**

- Modify: `api/plan/agent-loop-migration-roadmap.md`

- [x] **Step 1: Update roadmap**

After implementation, update Memory section:

```md
### P4. Memory

MVP in progress / completed:
- Read-only session summary memory is env-gated by `AGENT_MEMORY_SESSION_SUMMARY=1`.
- It recalls bounded summaries from recent completed tasks with the same `userId`.
- It does not write long-term memory.
- It does not duplicate `transcript.resume_context` for the current task.
```

- [x] **Step 2: Run regression commands**

Run:

```powershell
cd api
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-session-summary-memory-manager.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-agent-loop-session-memory.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-prompt-manager.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-context-provider-transcript-context.mjs
..\node_modules\.bin\tsc.CMD
```

Expected:

```text
session summary memory manager test passed
agent loop session memory test passed
prompt manager test passed
context provider transcript context test passed
```

## Acceptance Checklist

- [x] Memory MVP is disabled unless `AGENT_MEMORY_SESSION_SUMMARY=1`.
- [x] Current task transcript resume remains owned by ContextProvider.
- [x] Memory MVP recalls only same-user completed task summaries.
- [x] Memory MVP excludes current task.
- [x] Missing user id produces no memory recall.
- [x] Recent task list DB failure returns no memory sections and does not fail Agent Loop.
- [x] One candidate transcript load failure logs a warning, skips that candidate, and keeps other candidates.
- [x] Invalid numeric env values fall back to manager defaults.
- [x] Memory sections use `memory.session_summary.<taskId>` ids.
- [x] Memory sections are bounded.
- [x] Memory section dedupe removes duplicate ids within the same returned batch.
- [x] Memory sections reach a later model request through existing `memorySections`.
- [x] No long-term memory write path is added.
- [x] Backend typecheck passes.

## Open Questions Before Write-Capable Memory

- What is the durable user identity source for frontend-created tasks?
- Should project-level memory be file-based, DB-backed, or both?
- Who can inspect/delete memories?
- What confirmation UX is required before writing long-term memory?
- Should memory recall be keyword-only, metadata-filtered, or eventually vector-backed?
