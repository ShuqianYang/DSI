# Agent Loop Logging Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade current task-level Agent Loop JSONL logs into a session-aware, date-partitioned, auditable logging system while keeping full transcript capture controlled and optional.

**Architecture:** Keep `api/src/modules/agent-loop/fileLogger.ts` as the append-only JSONL writer, but add a small run metadata layer around it. Store queryable indexes in Postgres where useful, keep full debug transcript in files or `agent_transcript_entries`, and keep operational logs separated from high-risk full prompt/tool payloads.

**Tech Stack:** TypeScript 5, Express, Drizzle ORM, PostgreSQL, existing Agent Loop runtime, existing `tasks` and `agent_transcript_entries` tables, JSONL log files, script tests via `tsx`.

## Global Constraints

- Do not implement full `/resume` in the first logging pass.
- Do not require a new LLM model, tool registry rewrite, or prompt manager rewrite.
- Keep JSONL append-only for crash-friendly debug artifacts.
- Treat raw model prompts, tool outputs, user queries, IP addresses, and external API payloads as sensitive.
- Prefer opt-in full debug transcript retention; operational logs should remain safe enough for normal backend diagnostics.
- Preserve current `logFilePath` behavior returned through task results and SSE projections.

## Prerequisites

- Add `api/package.json` script `"ts-check": "tsc --noEmit"` before using `pnpm ts-check`.
- Ensure `api/tests/observability/` exists before adding observability tests.
- Add `AGENT_LOOP_LOG_DIR` to `api/.env.example` so the log root is explicit.
- After `api/src/db/schema.ts` changes, run `pnpm db:generate` and `pnpm db:migrate` from `api/`.
- Treat `clientRequestId` as tracing metadata only in this plan. Do not add idempotency or deduplication behavior unless a later product decision asks for it.

---

## Design Input From Claude Code Analysis

Relevant analysis files:

- `S:/Projects/claude-code-analysis/analysis/04i-session-storage-resume.md`
- `S:/Projects/claude-code-analysis/analysis/02-user-data-and-usage.md`
- `S:/Projects/claude-code-analysis/analysis/03-privacy-avoidance.md`
- `S:/Projects/claude-code-analysis/analysis/04f-context-management.md`

Useful lessons to adapt:

- Treat transcript as an append-only event stream, not a mutable snapshot.
- Keep write path simple; put recovery/listing complexity in read paths.
- Separate high-frequency UI progress from durable transcript entries.
- Store metadata such as title, tag, session id, agent identity, mode, and worktree-like runtime context near the stream.
- Full resume needs more than messages: it needs chain repair, interrupted turn handling, tool-result invariant checks, skill state restore, and runtime state handoff.
- Full transcript and memory retention increase privacy exposure; provide retention controls and a way to disable full persistence.

## Current Project State

Already present:

- `api/src/modules/agent-loop/fileLogger.ts`
  - Writes append-only JSONL files under `logs/`.
  - Emits `run_start`, `agent_loop_event`, `run_stop`, and `run_error`.
  - Adds `logFilePath` back to `AgentLoopResult`.
- `api/src/modules/agent-loop/transcriptStore.ts`
  - Persists model request, assistant message, tool message, and loop stop into Postgres.
  - Supports loading transcript entries by `taskId`.
- `api/src/db/schema.ts`
  - `tasks.userId` exists.
  - `agent_transcript_entries.metadata` exists.
- `api/src/modules/tasks/pipeline.ts`
  - Creates `fileLogger` for each task.
  - Injects `transcriptStore` and memory manager into `runAgentLoop`.
- `packages/shared/src/types/task.ts`
  - `CreateTaskRequest` already allows `userId`, `scenarioId`, and `context`.

Missing:

- Real `sessionId` and `requestId` propagation.
- Request IP / user-agent / route audit metadata.
- Date-partitioned log directory layout.
- Log retention / cleanup policy.
- Operational-safe logs that avoid raw prompt/tool payloads.
- A queryable log manifest or DB index for file artifacts.
- Token, duration, model, and cost metadata in logs.
- Sidechain logs for future subagents or skill runs.
- Resume-grade message UUID / parent UUID chain.

## Agent Loop Feature Dependency Answer

Most logging improvements do **not** depend on implementing extra Agent Loop features.

Can be implemented now with existing runtime hooks:

- Date-based log folders.
- `sessionId`, `requestId`, `runId`, `userId`, `scenarioId` metadata.
- HTTP access/audit logging.
- IP hash or masked IP capture.
- `seq`, `durationMs`, `startedAt`, `endedAt`, `status`, and error metadata.
- Model/provider/prompt-version/tool-catalog metadata.
- Operational vs debug log modes.
- Retention cleanup scripts.
- DB manifest table for log files.
- Frontend passing a browser/session id.

Needs small interface extensions but not new Agent Loop behavior:

- Passing request metadata from Express `createTask` into `runAgentPipeline`.
- Extending `CreateAgentLoopFileLoggerOptions`.
- Adding columns/tables through Drizzle migrations.
- Adding tests for path layout and metadata shape.

Requires extra Agent Loop features only if selected later:

- Full `/resume` from logs.
- Conversation graph repair with `uuid` / `parentUuid`.
- Interrupted-turn recovery.
- Subagent sidechain transcript routing.
- Remote ingress / hydrate.
- Context-collapse state restoration.
- Skill invocation state restoration for resumed sessions.

Recommendation: implement Tasks 1-8 first. Treat Tasks 9-10 as a separate feature track after observability is stable.

---

## Planned File Structure

- Modify: `packages/shared/src/types/task.ts`
  - Add optional request/session metadata fields to `CreateTaskRequest`.
- Modify: `src/lib/api.ts`
  - Generate or reuse frontend `sessionId`; pass it when creating tasks.
- Modify: `api/src/modules/tasks/controller.ts`
  - Extract request metadata from Express request.
  - Pass enriched metadata to `runAgentPipeline`.
- Modify: `api/src/modules/tasks/service.ts`
  - Persist task metadata where DB schema supports it.
- Modify: `api/src/modules/tasks/pipeline.ts`
  - Pass metadata into file logger and Agent Loop context.
- Modify: `api/src/modules/agent-loop/fileLogger.ts`
  - Add date/session directory layout.
  - Add run metadata, event sequence, and safe log mode.
- Modify: `api/src/modules/agent-loop/runAgentLoop.ts`
  - Add duration and model/tool metadata at existing emit points where available.
- Modify: `api/src/db/schema.ts`
  - Add a log manifest table or task metadata columns.
- Modify: `api/package.json`
  - Add `ts-check` script used by this plan's verification commands.
- Modify: `api/.env.example`
  - Document `AGENT_LOOP_LOG_DIR`, `AGENT_LOOP_LOG_MODE`, and `AGENT_LOOP_LOG_RETENTION_DAYS`.
- Create: `api/src/modules/observability/requestMetadata.ts`
  - Extract `requestId`, masked/hashed IP, user-agent, route, method, and timestamps.
- Create: `api/src/modules/observability/logManifestStore.ts`
  - Write/read log manifest records.
- Create: `api/src/modules/observability/logRetention.ts`
  - Cleanup old logs according to env policy.
- Create: `api/tests/agent-loop/test-agent-loop-log-date-session-path.mjs`
  - Verify new path layout.
- Create: `api/tests/agent-loop/test-agent-loop-log-metadata.mjs`
  - Verify run metadata fields.
- Create: `api/tests/observability/test-request-metadata.mjs`
  - Verify request metadata extraction and IP masking/hash behavior.
- Create: `api/tests/observability/test-log-retention.mjs`
  - Verify retention deletes only expected date partitions under a test temp directory.

---

### Task 0: Execution Prerequisites

**Files:**

- Modify: `api/package.json`
- Modify: `api/.env.example`
- Create as needed: `api/tests/observability/.gitkeep`

**Interfaces:**

- Produces script: `pnpm ts-check`
- Produces env documentation for log root, mode, and retention.
- Produces test directory for later observability tests.

- [ ] **Step 1: Add the typecheck script**

In `api/package.json`, add:

```json
"ts-check": "tsc --noEmit"
```

Keep the existing `"build": "tsc"` script unchanged.

- [ ] **Step 2: Ensure the observability test directory exists**

Create:

```text
api/tests/observability/.gitkeep
```

If Task 2 immediately creates `test-request-metadata.mjs`, the `.gitkeep` can be omitted because the directory will be materialized by the test file.

- [ ] **Step 3: Document logging env variables**

Add to `api/.env.example`:

```env
# Optional explicit Agent Loop log root. Defaults to AGENT_WORKSPACE_ROOT/logs or ../logs from api cwd.
AGENT_LOOP_LOG_DIR=

# debug keeps full Agent Loop JSONL payloads; operational keeps safe summaries.
AGENT_LOOP_LOG_MODE=debug

# Date-partition cleanup window for local JSONL artifacts.
AGENT_LOOP_LOG_RETENTION_DAYS=14
```

- [ ] **Step 4: Run prerequisite verification**

Run:

```bash
cd api
pnpm ts-check
```

Expected: TypeScript completes successfully with no emitted files.

---

### Task 1: Session and Request Metadata Contract

**Files:**

- Modify: `packages/shared/src/types/task.ts`
- Modify: `src/lib/api.ts`
- Test: `api/tests/agent-loop/test-frontend-create-agent-task-user-id.mjs`

**Interfaces:**

- Produces: `CreateTaskRequest.sessionId?: string`
- Produces: `CreateTaskRequest.clientRequestId?: string`
- Produces: `CreateTaskRequest.context?: Record<string, unknown>` remains supported
- Clarifies: `clientRequestId` is for tracing and log correlation only; it does not imply idempotent task creation.

- [ ] **Step 1: Extend shared request schema**

Add optional fields to `CreateTaskRequest`:

```ts
export const CreateTaskRequest = z.object({
  query: z.string().min(1),
  userId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  clientRequestId: z.string().min(1).optional(),
  scenarioId: ScenarioIdSchema.optional(),
  context: z.record(z.string(), z.any()).optional(),
});
```

- [ ] **Step 2: Add frontend session id helper**

In `src/lib/api.ts`, create a browser-stable session id:

```ts
const AGENT_LOOP_SESSION_STORAGE_KEY = "agent-loop-session-id";

function getAgentLoopSessionId(): string {
  if (typeof window === "undefined") return "server-session";
  const existing = window.sessionStorage.getItem(AGENT_LOOP_SESSION_STORAGE_KEY);
  if (existing) return existing;
  const sessionId = crypto.randomUUID();
  window.sessionStorage.setItem(AGENT_LOOP_SESSION_STORAGE_KEY, sessionId);
  return sessionId;
}
```

- [ ] **Step 3: Pass session and client request metadata**

Update task creation body:

```ts
body: JSON.stringify({
  query,
  userId: AGENT_LOOP_FIXED_USER_ID,
  sessionId: getAgentLoopSessionId(),
  clientRequestId: crypto.randomUUID(),
  scenarioId: options.scenarioId,
}),
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
cd api
pnpm ts-check
node tests/agent-loop/test-frontend-create-agent-task-user-id.mjs
```

Expected: typecheck passes and existing task creation payload expectations are updated to include session metadata.

---

### Task 2: Express Request Metadata Extraction

**Files:**

- Create: `api/src/modules/observability/requestMetadata.ts`
- Modify: `api/src/modules/tasks/controller.ts`
- Test: `api/tests/observability/test-request-metadata.mjs`

**Interfaces:**

- Produces: `RequestMetadata`
- Produces: `extractRequestMetadata(req: Request, now?: Date): RequestMetadata`

- [ ] **Step 1: Ensure test directory exists**

Create the directory before adding observability tests:

```bash
mkdir -p api/tests/observability
```

On Windows PowerShell, the equivalent command is:

```powershell
New-Item -ItemType Directory -Force -Path api/tests/observability
```

- [ ] **Step 2: Create request metadata module**

```ts
import crypto from "node:crypto";
import type { Request } from "express";

export interface RequestMetadata {
  requestId: string;
  method: string;
  path: string;
  userAgent?: string;
  ipHash?: string;
  ipMasked?: string;
  receivedAt: string;
}

export function extractRequestMetadata(req: Request, now = new Date()): RequestMetadata {
  const requestId = headerValue(req.headers["x-request-id"]) ?? crypto.randomUUID();
  const userAgent = headerValue(req.headers["user-agent"]);
  const rawIp = firstForwardedIp(req) ?? req.ip;
  return {
    requestId,
    method: req.method,
    path: req.originalUrl || req.path,
    ...(userAgent ? { userAgent } : {}),
    ...(rawIp ? { ipHash: hashIp(rawIp), ipMasked: maskIp(rawIp) } : {}),
    receivedAt: now.toISOString(),
  };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function firstForwardedIp(req: Request): string | undefined {
  const forwarded = headerValue(req.headers["x-forwarded-for"]);
  return forwarded?.split(",")[0]?.trim();
}

function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(ip).digest("hex");
}

function maskIp(ip: string): string {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    return ip.split(".").slice(0, 3).concat("0").join(".");
  }
  if (/^[0-9a-fA-F:]+$/.test(ip)) {
    return ip.replace(/(:[0-9a-fA-F]{0,4}){2}$/, ":0000:0000");
  }
  return "unknown";
}
```

- [ ] **Step 3: Test extraction**

Create test cases for:

- `x-request-id` is reused.
- `x-forwarded-for` first IP is used.
- IPv4 is masked to `/24` style.
- IPv6 is masked to a `/64`-style value by zeroing the last two hextets.
- hash is stable and does not equal raw IP.

- [ ] **Step 4: Wire controller**

In `createTask`, compute:

```ts
const requestMetadata = extractRequestMetadata(req);
```

Pass it to `runAgentPipeline` through a new third argument in Task 3.

- [ ] **Step 5: Run test**

Run:

```bash
cd api
node tests/observability/test-request-metadata.mjs
```

Expected: request metadata tests pass without touching the database.

---

### Task 3: Pipeline Run Metadata

**Files:**

- Modify: `api/src/modules/tasks/pipeline.ts`
- Modify: `api/src/modules/tasks/controller.ts`
- Modify: `api/src/modules/agent-loop/fileLogger.ts`
- Test: `api/tests/agent-loop/test-agent-loop-log-metadata.mjs`

**Interfaces:**

- Produces: `AgentLoopRunMetadata`
- Produces: `runAgentPipeline(taskId: string, body: CreateTaskRequest, metadata?: AgentLoopRunMetadata): Promise<void>`
- Consumes: `RequestMetadata` from Task 2

- [x] **Step 1: Confirm call sites before changing the signature**

Run:

```bash
rg -n "runAgentPipeline\(" api/src api/tests api/scripts -g "*.ts" -g "*.mjs" -g "*.js"
```

Expected at the time this plan was written:

```text
api/src/modules/tasks/pipeline.ts
api/src/modules/tasks/controller.ts
```

If additional callers appear, update them in this task before changing the signature.

- [x] **Step 2: Define metadata type**

Add to `pipeline.ts` or a small shared observability type module:

```ts
export interface AgentLoopRunMetadata {
  requestId?: string;
  clientRequestId?: string;
  sessionId?: string;
  userId?: string;
  scenarioId?: string;
  method?: string;
  path?: string;
  userAgent?: string;
  ipHash?: string;
  ipMasked?: string;
  receivedAt?: string;
}
```

- [x] **Step 3: Pass metadata into logger**

Build metadata from request + body:

```ts
const runMetadata: AgentLoopRunMetadata = {
  ...metadata,
  userId: body.userId,
  sessionId: body.sessionId,
  clientRequestId: body.clientRequestId,
  scenarioId: body.scenarioId,
};
fileLogger = await createAgentLoopFileLogger({
  taskId,
  query: body.query,
  metadata: runMetadata,
});
```

- [x] **Step 4: Extend file logger options**

```ts
export interface CreateAgentLoopFileLoggerOptions {
  taskId: string;
  query: string;
  metadata?: Record<string, unknown>;
}
```

Write metadata in `run_start`:

```ts
logger.writeLine({
  kind: "run_start",
  timestamp: new Date().toISOString(),
  taskId: options.taskId,
  query: options.query,
  metadata: sanitizeForJson(options.metadata ?? {}),
});
```

- [x] **Step 5: Test metadata persistence**

Create a logger with metadata and assert first JSONL line includes:

- `metadata.sessionId`
- `metadata.requestId`
- `metadata.userId`
- `metadata.scenarioId`

- [x] **Step 6: Run tests**

Run:

```bash
cd api
node tests/agent-loop/test-agent-loop-log-metadata.mjs
```

Expected: first line has metadata and existing file logger tests still pass.

---

### Task 4: Date and Session Partitioned Log Paths

**Files:**

- Modify: `api/src/modules/agent-loop/fileLogger.ts`
- Modify: `api/tests/agent-loop/test-agent-loop-log-file-path.mjs`
- Create: `api/tests/agent-loop/test-agent-loop-log-date-session-path.mjs`

**Interfaces:**

- Produces path shape: `logs/YYYY-MM-DD/{sessionId}/agent-loop-{taskId}-{timestamp}.jsonl`
- Falls back to `logs/YYYY-MM-DD/no-session/agent-loop-{taskId}-{timestamp}.jsonl`

- [x] **Step 1: Add date path formatter**

```ts
function formatDateFolder(date: Date): string {
  return date.toISOString().slice(0, 10);
}
```

- [x] **Step 2: Add session folder sanitizer**

```ts
function safeSessionFolder(value: unknown): string {
  return typeof value === "string" && value.trim()
    ? safeFilePart(value)
    : "no-session";
}
```

- [x] **Step 3: Build partitioned log directory**

In `createAgentLoopFileLogger`:

```ts
const now = new Date();
const baseLogDir = resolveAgentLoopLogDir();
const sessionFolder = safeSessionFolder(options.metadata?.sessionId);
const logDir = path.join(baseLogDir, formatDateFolder(now), sessionFolder);
await mkdir(logDir, { recursive: true });
```

- [x] **Step 4: Preserve old result behavior**

Keep returning the full `filePath` through `withAgentLoopLogFilePath`.

- [x] **Step 5: Run tests**

Run:

```bash
cd api
tsx tests/agent-loop/test-agent-loop-log-file-path.mjs
tsx tests/agent-loop/test-agent-loop-log-date-session-path.mjs
```

Expected: old test updated for new path; new test confirms date/session folder.

---

### Task 5: Event Sequence, Duration, and Status Fields

**Files:**

- Modify: `api/src/modules/agent-loop/fileLogger.ts`
- Modify: `api/src/modules/agent-loop/runAgentLoop.ts`
- Test: `api/tests/agent-loop/test-agent-loop-file-logger.mjs`

**Interfaces:**

- Produces per-line `seq: number`
- Produces run-level `durationMs` on `run_stop` and `run_error`
- Does not add `elapsedMs` to every event in the MVP; use `seq` for ordering and `durationMs` for run completion timing.

- [x] **Step 1: Track start time and sequence in logger**

Add private fields:

```ts
private seq = 0;
private readonly startedAtMs = Date.now();
```

- [x] **Step 2: Add sequence in `writeLine`**

```ts
writeLine(value: Record<string, unknown>): void {
  if (this.closed) return;
  this.seq += 1;
  this.stream.write(`${JSON.stringify({
    seq: this.seq,
    ...value,
  })}\n`);
}
```

- [x] **Step 3: Add duration to finish/fail**

```ts
durationMs: Date.now() - this.startedAtMs,
```

- [x] **Step 4: Assert sequence**

Update tests to assert:

- first line `seq === 1`
- sequence is strictly increasing
- final line has numeric `durationMs`

- [x] **Step 5: Run tests**

Run:

```bash
cd api
tsx tests/agent-loop/test-agent-loop-file-logger.mjs
```

Expected: sequence and duration assertions pass.

---

### Task 6: Operational Log Mode vs Debug Transcript Mode

**Files:**

- Modify: `api/src/modules/agent-loop/fileLogger.ts`
- Modify: `api/.env.example`
- Test: `api/tests/agent-loop/test-agent-loop-file-logger.mjs`

**Interfaces:**

- Consumes env: `AGENT_LOOP_LOG_MODE=debug|operational`
- `debug`: keeps current full event payload behavior.
- `operational`: records event summaries and safe metadata, omits raw `model_request.messages`, raw tool stdout/stderr, and full final answer.

- [x] **Step 1: Add mode resolver**

```ts
type AgentLoopLogMode = "debug" | "operational";

function resolveAgentLoopLogMode(): AgentLoopLogMode {
  return process.env.AGENT_LOOP_LOG_MODE === "operational" ? "operational" : "debug";
}
```

- [x] **Step 2: Sanitize event by mode using the discriminated union**

```ts
function sanitizeEventForMode(event: AgentLoopEvent, mode: AgentLoopLogMode): unknown {
  if (mode === "debug") return sanitizeForJson(event);
  switch (event.type) {
    case "agent_turn":
      return { type: event.type, taskId: event.taskId, turn: event.turn, message: event.message };
    case "model_request":
      return { type: event.type, taskId: event.taskId, turn: event.turn, messageCount: event.messages.length };
    case "assistant_message":
      return {
        type: event.type,
        taskId: event.taskId,
        turn: event.turn,
        toolCallCount: event.message.toolCalls?.length ?? 0,
        message: formatAgentLoopLogMessage(event),
      };
    case "tool_call":
    case "tool_progress":
    case "tool_observation":
      return {
        type: event.type,
        taskId: event.taskId,
        turn: event.turn,
        toolName: event.toolName,
        message: formatAgentLoopLogMessage(event),
      };
    case "tool_calls":
    case "tool_batch":
    case "tool_message":
    case "loop_stop":
      return {
        type: event.type,
        taskId: event.taskId,
        turn: event.turn,
        message: formatAgentLoopLogMessage(event),
      };
    default:
      return assertNeverAgentLoopEvent(event);
  }
}

function assertNeverAgentLoopEvent(event: never): never {
  throw new Error(`Unhandled AgentLoopEvent type: ${JSON.stringify(event)}`);
}
```

- [x] **Step 3: Apply in `logEvent`**

```ts
event: sanitizeEventForMode(event, this.mode),
```

- [x] **Step 4: Document env**

Add to `api/.env.example`:

```env
# Optional explicit Agent Loop log root. Defaults to AGENT_WORKSPACE_ROOT/logs or ../logs from api cwd.
AGENT_LOOP_LOG_DIR=

# debug keeps full Agent Loop JSONL payloads; operational keeps safe summaries.
AGENT_LOOP_LOG_MODE=debug
```

- [x] **Step 5: Test operational mode**

Set `process.env.AGENT_LOOP_LOG_MODE = "operational"` in a focused test and assert a `model_request` log does not include raw `messages`.

---

### Task 7: Log Manifest Index

**Files:**

- Modify: `api/src/db/schema.ts`
- Create migration in `api/src/db/migrations/`
- Create: `api/src/modules/observability/logManifestStore.ts`
- Modify: `api/src/modules/tasks/pipeline.ts`
- Test: `api/tests/agent-loop/test-agent-loop-log-manifest-pipeline.mjs`

**Interfaces:**

- Produces table: `agent_loop_log_files`
- Produces: `AgentLoopLogManifestStore`

- [x] **Step 1: Add schema table**

Columns:

- `id uuid primary key defaultRandom`
- `taskId uuid references tasks(id)`
- `sessionId text`
- `requestId text`
- `userId text`
- `filePath text not null`
- `mode text not null`
- `status text enum: running|completed|failed`
- `startedAt timestamp with time zone`
- `endedAt timestamp with time zone`
- `createdAt timestamp with time zone defaultNow`

- [x] **Step 2a: Generate Drizzle migration**

Run from `api/` after editing `api/src/db/schema.ts`:

```bash
pnpm db:generate
pnpm db:migrate
```

Expected: a migration is generated under `api/src/db/migrations/` and applied to the configured database.

Generated: `api/src/db/migrations/0003_minor_blink.sql`.

- [ ] **Step 2b: Apply Drizzle migration to the configured database**

Attempted `drizzle-kit migrate`; local database failed before the new migration because existing tables such as `events` already exist while migration history is not aligned. Apply remains pending until the local/target DB migration state is reconciled.

- [x] **Step 3: Add manifest store**

Implement insert on log creation and update on finish/fail.

- [x] **Step 4: Wire best-effort manifest writes**

In pipeline, after logger creation, record a `running` manifest row. On completion, mark `completed`; on catch, mark `failed`.

Manifest writes must be best-effort and must not change task outcome. Wrap manifest calls so failures are logged with `console.warn` and never escape into the main pipeline control flow:

```ts
async function bestEffortManifestWrite(action: () => Promise<void>, logger: Pick<Console, "warn"> = console) {
  try {
    await action();
  } catch (error) {
    logger.warn("[AgentLoopLogManifest] write failed:", error instanceof Error ? error.message : String(error));
  }
}
```

- [x] **Step 5: Test with a fake store**

Use an injected fake store if direct DB testing is too heavy. Assert pipeline calls:

- `recordStarted`
- `recordCompleted` or `recordFailed`
- rejected manifest writes do not reject `runAgentPipeline`

- [x] **Step 6: Run backend typecheck**

Run:

```bash
cd api
tsx tests/agent-loop/test-agent-loop-log-manifest-pipeline.mjs
tsc --noEmit
```

Expected: schema and store compile.

---

### Task 8: Retention and Cleanup

**Files:**

- Create: `api/src/modules/observability/logRetention.ts`
- Create: `api/scripts/ops/cleanup-agent-loop-logs.ts`
- Modify: `api/.env.example`
- Modify: `docker/.env.example`
- Test: `api/tests/observability/test-log-retention.mjs`

**Interfaces:**

- Consumes env: `AGENT_LOOP_LOG_RETENTION_DAYS`
- Produces: `cleanupAgentLoopLogs({ rootDir, retentionDays, now }): Promise<CleanupResult>`

- [x] **Step 1: Implement safe cleanup**

Only delete date folders under the configured logs root matching:

```text
YYYY-MM-DD
```

Do not delete arbitrary files directly under `logs/`.

- [x] **Step 2: Add result type**

```ts
export interface CleanupResult {
  scannedDateDirs: number;
  deletedDateDirs: string[];
  skipped: string[];
}
```

- [x] **Step 3: Add ops script**

Script reads:

- `AGENT_LOOP_LOG_DIR`
- `AGENT_WORKSPACE_ROOT`
- `AGENT_LOOP_LOG_RETENTION_DAYS`

Then prints JSON cleanup result.

- [x] **Step 4: Test deletion boundaries**

Create temp tree:

```text
logs/
  2026-01-01/session-a/file.jsonl
  2026-07-03/session-b/file.jsonl
  notes.txt
```

Assert only expired date folder is removed.

- [x] **Step 5: Run test**

Run:

```bash
cd api
tsx tests/observability/test-log-retention.mjs
```

Expected: cleanup never touches non-date entries.

---

### Task 9: Resume-Ready Transcript Metadata

**Files:**

- Modify: `api/src/modules/agent-loop/transcriptStore.ts`
- Modify: `api/src/modules/agent-loop/runAgentLoop.ts`
- Modify: `api/src/db/schema.ts`
- Test: `api/tests/agent-loop/test-transcript-store-shape.mjs`

**Interfaces:**

- Produces optional transcript fields in metadata:
  - `uuid`
  - `parentUuid`
  - `sessionId`
  - `requestId`
  - `model`
  - `promptVersion`
  - `toolCallIds`

- [ ] **Step 1: Add metadata without changing replay behavior**

Do not implement resume. Only write fields that future resume can use.

- [ ] **Step 2: Generate entry UUID**

Use `crypto.randomUUID()` per transcript entry.

- [ ] **Step 3: Track parent UUID in run-local memory**

For linear entries, set previous transcript UUID as `parentUuid`.

- [ ] **Step 4: Add tests**

Assert loaded transcript entries preserve metadata and are sorted by `sequence`.

- [ ] **Step 5: Run tests**

Run:

```bash
cd api
node tests/agent-loop/test-transcript-store-shape.mjs
```

Expected: no resume behavior changes, metadata shape is stable.

---

### Task 10: Sidechain Log Track for Future Subagents and Skill Runs

**Files:**

- Modify: `api/src/modules/agent-loop/fileLogger.ts`
- Modify: `api/src/modules/agent-loop/runAgentLoop.ts`
- Test: `api/tests/agent-loop/test-agent-loop-file-logger.mjs`

**Interfaces:**

- Produces optional sidechain path shape:
  - `logs/YYYY-MM-DD/{sessionId}/sidechains/{sidechainId}.jsonl`
- Does not change main task execution.

- [ ] **Step 1: Add sidechain path helper**

```ts
function resolveSidechainLogPath(baseRunDir: string, sidechainId: string): string {
  return path.join(baseRunDir, "sidechains", `${safeFilePart(sidechainId)}.jsonl`);
}
```

- [ ] **Step 2: Keep sidechain disabled by default**

Add only helper and tests first. Do not route tool calls to sidechains yet.

- [ ] **Step 3: Identify future routing points**

Document likely routing points:

- Skill tool execution.
- Future AgentTool/subagent execution.
- Long-running external orchestration scripts.

- [ ] **Step 4: Run tests**

Run:

```bash
cd api
node tests/agent-loop/test-agent-loop-file-logger.mjs
```

Expected: helper is safe and main log behavior unchanged.

---

## Suggested Execution Order

0. Task 0: Execution Prerequisites
1. Task 1: Session and Request Metadata Contract
2. Task 2: Express Request Metadata Extraction
3. Task 3: Pipeline Run Metadata
4. Task 4: Date and Session Partitioned Log Paths
5. Task 5: Event Sequence, Duration, and Status Fields
6. Task 6: Operational Log Mode vs Debug Transcript Mode
7. Task 7: Log Manifest Index
8. Task 8: Retention and Cleanup
9. Task 9: Resume-Ready Transcript Metadata
10. Task 10: Sidechain Log Track for Future Subagents and Skill Runs

Tasks 0-8 are the practical observability MVP. Tasks 9-10 should wait until the product decision is clear on whether this app needs Claude Code style resume/subagent recovery.

## Verification Gate

After each task:

```bash
cd api
pnpm ts-check
```

Run the focused test named in that task.

Before merging the whole logging MVP:

```bash
cd api
pnpm ts-check
node tests/agent-loop/test-agent-loop-file-logger.mjs
node tests/agent-loop/test-agent-loop-log-file-path.mjs
node tests/agent-loop/test-agent-loop-log-metadata.mjs
node tests/agent-loop/test-agent-loop-log-date-session-path.mjs
node tests/observability/test-request-metadata.mjs
node tests/observability/test-log-retention.mjs
```

Expected: all checks pass; generated logs live under `logs/YYYY-MM-DD/{sessionId}/`.

## Open Product Decisions

- Store raw IP, masked IP, hash only, or both masked + hash. Recommended default: masked + hash.
- Default `AGENT_LOOP_LOG_MODE`. Recommended default for local/dev: `debug`; for deployed/prod: `operational`.
- Retention days. Recommended default: 14 days for debug JSONL, 90 days for operational DB manifest.
- Whether full transcript persistence can be disabled per environment. Recommended: yes, via env.
- Whether session IDs should be browser-session scoped or login-session scoped. Recommended: login-session scoped after auth is real.

## Completion Criteria

- Each task run has a stable `sessionId`, `requestId`, `taskId`, and `logFilePath`.
- Log files are partitioned by date and session.
- Operational mode avoids raw prompt/tool payloads.
- Debug mode preserves current deep troubleshooting capability.
- Logs can be found from a DB manifest or task result.
- Old logs can be cleaned safely by date folder.
- No full resume or sidechain behavior is required for the logging MVP.
