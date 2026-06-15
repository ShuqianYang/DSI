# Transcript Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Agent Loop transcript entries in a structured, queryable store so future resume, context recovery, prompt versioning, and audit views can build on reliable run history.

**Architecture:** Use the existing `AgentTranscriptStore` interface and `runAgentLoop` append points. The first version writes append-only transcript entries into Postgres via Drizzle, while keeping JSONL file logs as human-readable audit artifacts. Do not implement full resume yet; only implement durable write, ordered read, and context-ready data shape.

**Tech Stack:** TypeScript 5, Drizzle ORM, PostgreSQL, existing `tasks` table, `runAgentLoop` transcriptStore injection, script tests via `tsx`, backend typecheck via `tsc`.

---

## Design Input From Claude Code Analysis

Relevant analysis files:

- `S:/Projects/claude-code-analysis/analysis/04i-session-storage-resume.md`
- `S:/Projects/claude-code-analysis/analysis/04f-context-management.md`
- `S:/Projects/claude-code-analysis/analysis/04g-prompt-management.md`
- `S:/Projects/claude-code-analysis/analysis/04-agent-memory.md`

Useful lessons:

- Treat transcript as an append-only event stream, not a mutable message snapshot.
- Keep write path simple; push complexity into read/recovery later.
- Persist messages that matter for model/context reconstruction separately from high-frequency UI progress.
- Preserve ordering with a monotonically increasing sequence.
- Record metadata next to the stream so list/resume/debug operations do not need to infer everything from final task result.
- Full resume is more than loading messages; it eventually needs chain repair, interrupted turn handling, prompt/context version restore, and tool-result invariant checks.

Project-specific adaptation:

- Claude Code uses local JSONL as the primary transcript. This project already has Postgres task state and API dashboards, so the MVP should use Postgres as the structured source of truth.
- Existing JSONL files in `projects_new/logs` remain useful as audit logs and smoke artifacts.
- Do not copy Claude Code's full resume complexity in v1.

## Current Code State

Already present:

- `api/src/modules/agent-loop/transcriptStore.ts`
  - Defines `AgentTranscriptStore`.
  - Provides `disabledTranscriptStore`.
- `api/src/modules/agent-loop/runAgentLoop.ts`
  - Accepts `transcriptStore?: AgentTranscriptStore`.
  - Appends `model_request`, `assistant_message`, `tool_message`, and `loop_stop`.
- `api/src/modules/agent-loop/fileLogger.ts`
  - Writes JSONL log files for human inspection.
- `api/src/db/schema.ts`
  - Defines `tasks`, `taskSteps`, and projection/display tables.

Missing:

- Database table for transcript entries.
- Concrete DB-backed `AgentTranscriptStore`.
- Pipeline wiring so normal task runs use the DB store.
- Tests verifying append order and loop integration.
- Read API or ContextProvider integration.

## MVP Boundaries

In scope:

- Create `agent_transcript_entries`.
- Implement DB-backed append/load.
- Inject store into `runAgentLoop` from `runAgentPipeline`.
- Use best-effort transcript writes by default in production wiring.
- Add tests with fake/in-memory store and pure serialization checks.
- Add a small read helper for later ContextProvider Phase 3.

Out of scope:

- Full `/resume`.
- Conversation graph repair.
- Sidechain/subagent transcripts.
- Remote ingress.
- Session list UI.
- Memory extraction.
- Prompt versioning, except leaving fields that can support it.

## Proposed Data Model

Add table:

```ts
export const agentTranscriptEntries = pgTable(
  "agent_transcript_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    turn: integer("turn").notNull(),
    sequence: integer("sequence").notNull(),
    kind: text("kind", {
      enum: ["model_request", "assistant_message", "tool_message", "loop_stop"],
    }).notNull(),
    message: jsonb("message"),
    messages: jsonb("messages"),
    finalAnswer: text("final_answer"),
    error: text("error"),
    stoppedBy: text("stopped_by"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("agent_transcript_entries_task_seq_idx").on(table.taskId, table.sequence),
    index("agent_transcript_entries_task_kind_idx").on(table.taskId, table.kind),
    index("agent_transcript_entries_created_at_idx").on(table.createdAt),
  ]
);
```

Notes:

- `sequence` is scoped to `taskId`.
- `kind` mirrors `AgentTranscriptEntryKind`.
- `messages` is for full model request payload after ContextWindowManager preparation.
- `message` is for single assistant/tool messages.
- `metadata` is reserved for future prompt version, context diagnostics, model name, token estimates, and compaction markers.
- `message`, `messages`, and `metadata` must be sanitized before insert with existing `safeJsonStringify` / `sanitizeForJson` helpers, then JSON round-tripped into plain JSON values. Transcript storage must not rely on raw object identity or non-JSON values.

## Implementation Tasks

### Task 1: Add Schema

**Files:**

- Modify: `api/src/db/schema.ts`
- Test: `api/tests/agent-loop/test-transcript-store-shape.mjs`

- [x] Add `agentTranscriptEntries` table.
- [x] Export the table from `schema.ts`.
- [x] Add a shape test that imports the table and verifies expected column names are present.

Command:

```powershell
cd api
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-transcript-store-shape.mjs
```

Expected:

```text
transcript store shape test passed
```

### Task 2: Implement DB Transcript Store

**Files:**

- Modify: `api/src/modules/agent-loop/transcriptStore.ts`
- Test: `api/tests/agent-loop/test-transcript-store.mjs`

- [x] Add `createDbTranscriptStore(db)` or `dbTranscriptStore`.
- [x] Serialize `message`, `messages`, and `metadata` through existing `safeJsonStringify` / `sanitizeForJson` helpers.
- [x] Before insert, JSON round-trip sanitized payloads into plain JSON values:

```ts
function toJsonbValue(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(safeJsonStringify(sanitizeForJson(value)));
}
```

- [x] Apply `toJsonbValue` to `message`, `messages`, and `metadata` before inserting rows.
- [x] Insert entries append-only.
- [x] Load entries ordered by `(sequence asc, createdAt asc)`.
- [x] Keep `disabledTranscriptStore` unchanged for tests and explicit opt-out.

Expected behavior:

- `append(entry)` inserts one row.
- `load(taskId)` returns entries in original sequence.
- DB store unit tests should verify DB errors surface when calling the raw DB store directly.
- Serialization tests should include non-JSON-adjacent values such as `undefined`, `Error`, circular-safe sanitized objects if existing helpers support them, and nested tool outputs.

### Task 3: Wire Store Into Pipeline

**Files:**

- Modify: `api/src/modules/tasks/pipeline.ts`
- Modify: `api/src/modules/agent-loop/transcriptStore.ts` if the store needs a default export/helper.
- Test: `api/tests/agent-loop/test-agent-loop-transcript-integration.mjs`

- [x] Create the DB-backed store in the pipeline.
- [x] Add `createBestEffortTranscriptStore(store, logger)` wrapper.
- [x] Pass the best-effort wrapped `transcriptStore` to `runAgentLoop` by default.
- [x] Keep JSONL `fileLogger` enabled independently.
- [x] If transcript append fails, log a warning and continue the Agent Loop task.
- [x] Use fake model integration test to assert rows for:
  - `model_request`
  - `assistant_message`
  - `tool_message` when tools are used
  - `loop_stop`

Write strategy:

- `runAgentLoop` keeps `await transcriptStore.append(...)`.
- `dbTranscriptStore.append` throws on DB failure.
- Unit tests call `dbTranscriptStore` directly and expect failures to surface.
- `pipeline.ts` wraps the DB store with `createBestEffortTranscriptStore(...)`.
- Production transcript persistence is observability/audit infrastructure, not a task-success dependency.

Suggested wrapper shape:

```ts
export function createBestEffortTranscriptStore(
  store: AgentTranscriptStore,
  logger: Pick<Console, "warn"> = console
): AgentTranscriptStore {
  return {
    async append(entry) {
      try {
        await store.append(entry);
      } catch (error) {
        logger.warn("[AgentTranscript] append failed:", error instanceof Error ? error.message : String(error));
      }
    },
    load(taskId) {
      return store.load(taskId);
    },
  };
}
```

### Task 4: Add Read Helper for ContextProvider Phase 3

**Files:**

- Modify: `api/src/modules/agent-loop/transcriptStore.ts`
- Test: `api/tests/agent-loop/test-transcript-read-model.mjs`

Added helpers:

```ts
export function entriesToConversationMessages(entries: AgentTranscriptEntry[]): AgentMessage[] {
  // model_request is historical input, not appended into the reconstructed conversation.
  // assistant_message and tool_message are replayable messages.
  // loop_stop is terminal metadata, not a model message.
}

export function summarizeTranscriptForContext(entries: AgentTranscriptEntry[]): PromptSection | undefined {
  // Return a bounded `transcript.resume_context` section for ContextProvider Phase 3.
}
```

MVP summary content:

- [x] task id
- [x] total entries
- [x] final status / stoppedBy
- [x] last assistant answer preview
- [x] last N tool names and ok/error state if available

- [x] Do not feed full transcript back into prompt in this task.

### Task 5: ContextProvider Phase 3 Hook

**Files:**

- Modify: `api/src/modules/agent-loop/contextProvider.ts`
- Test: `api/tests/agent-loop/test-context-provider-transcript-context.mjs`

Added one bounded section:

```text
transcript.resume_context
```

Rules:

- [x] Only load transcript entries for the current `taskId`.
- [x] Only include bounded summary, not full model requests.
- [x] Fail closed if transcript table is unavailable.
- [x] Do not change PromptManager section order; ContextProvider simply emits another context section.

This task can happen immediately after Tasks 1-4.

### Task 6: Add Migration / DB Lifecycle

**Files:**

- Verify: `api/drizzle.config.ts`
- Verify: `api/README.md`

Current workflow:

- [x] `api/drizzle.config.ts` uses `schema: "./src/db/schema.ts"`.
- [x] `api/package.json` defines `db:push` as `drizzle-kit push`.
- [x] `api/README.md` documents `pnpm db:push`.
- [x] `api/README.md` documents that `agent_transcript_entries` follows the normal Drizzle schema lifecycle.

Acceptance:

- [x] `agentTranscriptEntries` is exported from `api/src/db/schema.ts`.
- [x] `drizzle.config.ts` continues to point at `./src/db/schema.ts`, so the new table is included.
- [x] Run with Postgres available:

```powershell
cd api
pnpm db:push
```

- [x] Docker Postgres can start with the new table.
- [x] Existing non-DB transcript tests still run.
- [x] Agent Loop smoke still writes task result and JSONL log.
- [x] Transcript rows are visible by task id.

Current Task 6 note:

- `pnpm` is not available on the current PATH, so use `.\node_modules\.bin\drizzle-kit.CMD push --force` as the local equivalent.
- Earlier on 2026-06-15, local Postgres was not listening on `127.0.0.1:5432`; after Docker/Postgres startup, `drizzle-kit.CMD push --force` reported `No changes detected`.
- `agent_transcript_entries` was visible in Postgres and contained transcript rows during runtime verification.

## Testing Checklist

Run from `api/`:

```powershell
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-transcript-store-shape.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-transcript-store.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-agent-loop-transcript-integration.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-transcript-read-model.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-context-provider-transcript-context.mjs
..\node_modules\.bin\tsc.CMD -p tsconfig.json --noEmit --pretty false
pnpm db:push
```

Manual smoke:

```powershell
cd api
pnpm agent:smoke -- --scenario gis-toolchain
```

Then query transcript rows by task id and verify ordered entries.

## Relationship To ContextProvider Phase 3

After transcript persistence MVP is complete, it is reasonable to start the `context-provider-phase2-plan.md` deferred Phase 3 item:

```text
Add transcript-resume context after transcript persistence is enabled.
```

But this should be interpreted narrowly:

- Yes: add bounded `transcript.resume_context` sections.
- Yes: use transcript summaries for debugging and future resume preparation.
- No: do not immediately implement full `/resume`.
- No: do not replay full `model_request.messages` into every future prompt.

Full resume should wait until:

- transcript rows are stable in real tasks,
- prompt versioning records exist,
- tool result invariants are understood,
- interrupted turn behavior is specified,
- large transcript summarization strategy exists.

## Acceptance Checklist

- [x] Transcript entries are persisted append-only.
- [x] Entries are ordered by task-scoped sequence.
- [x] Normal Agent Loop runs use DB transcript store.
- [x] JSONL file logs continue to work.
- [x] `load(taskId)` returns structured entries.
- [x] A bounded transcript context section can be generated.
- [x] ContextProvider can include transcript resume context fail-closed.
- [x] No full resume behavior is introduced accidentally.
