# Context Provider Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve `defaultContextProvider` so it provides safer, richer project/task/workspace context while preserving the newer PromptManager, runtimeSections, SkillManager, MemoryManager, and ContextWindowManager boundaries.

**Architecture:** Keep `ContextProvider` as a deterministic context material loader. It may read bounded project files, Git status, and task database records, but it must not assemble the final prompt, discover skills, render runtime tool state, call tools, call models, or compact messages. Phase 2 adds explicit project-instruction policy, project domain/ADR sections, task requirement/progress sections, richer diagnostics, and regression tests around the latest sandbox/skill changes.

**Tech Stack:** TypeScript 5, Node built-ins, Drizzle task schema, existing `ContextProvider` / `PromptSection` types, script tests via local `tsx`, backend typecheck via local `tsc`.

---

## Current Latest State

This plan is based on `agent-loop` after fast-forwarding to:

```text
fe21410 skill test done
```

Current known status:

- `PromptManager Phase 1` is implemented and renders sections in this order: user context, system context, project/domain context, runtime state, memory, skills.
- `ContextWindowManager Phase 2` is implemented with priority groups, tool-result metadata, diagnostics, and compaction candidates.
- `SkillManager` now exists and owns skill listing/discovery. ContextProvider must not duplicate that work.
- `runAgentLoop` now injects `runtimeSections` from current tool state such as TodoWrite/plan mode. ContextProvider must not produce runtime tool-state sections.
- `contextProvider.ts` currently has `CONTEXT_FILE_CANDIDATES: string[] = []`, temporarily disabling AGENTS/CLAUDE project instruction injection.
- `api/tests/test-context-provider.mjs` currently fails on latest code because it still expects `projectInstructions` by default.

## Scope

In scope:

- Fix ContextProvider tests to match latest project-instruction policy.
- Add an explicit environment-gated way to re-enable AGENTS/CLAUDE project instruction files.
- Add project/domain context sections for `CONTEXT.md` and a bounded `docs/adr` index.
- Add deterministic task sections from task records and task steps.
- Add diagnostics for context-provider policy and loaded/skipped sources.
- Keep all context sections bounded and cancellation-aware.
- Update `api/src/todo.md` to record ContextProvider Phase 2 status.

Out of scope:

- Memory retrieval.
- Skill listing, discovery, or Skill tool behavior.
- Runtime TodoWrite/plan mode section rendering.
- Prompt section ordering changes.
- Context-window trimming or compaction.
- Durable transcript resume.
- Persistent storage for large context files.

## File Structure

- Modify: `api/src/modules/agent-loop/contextProvider.ts`
  - Add dynamic env readers for context limits and project-instruction policy.
  - Add project source diagnostics.
  - Add ADR index loading.
  - Add pure task section formatters and wire them into `getContextSections`.

- Modify: `api/tests/test-context-provider.mjs`
  - Update default project-instruction assertions for latest disabled-by-default policy.
  - Add env opt-in tests for AGENTS/CLAUDE loading.
  - Add tests for ADR index, truncation, cancellation, and task section formatters.

- Modify: `api/src/todo.md`
  - Mark ContextProvider Phase 2 deterministic context improvements as implemented.
  - Keep user preferences, include expansion, and durable resume deferred.

## Design Decisions

Project instruction policy:

- Default: disabled. This matches latest `fe21410 skill test done`, which excluded AGENTS/CLAUDE from ContextProvider for sandbox safety.
- Opt-in: `AGENT_CONTEXT_PROJECT_INSTRUCTIONS=1`.
- When disabled, `getUserContext()` returns `currentDate` but no `projectInstructions`.
- When enabled, load `AGENTS.md`, `CLAUDE.md`, and `.claude/CLAUDE.md` with the existing bounded file reader.

Context ownership:

- `ContextProvider.getUserContext()` owns stable user/project instruction records only.
- `ContextProvider.getSystemContext()` owns workspace and task status records only.
- `ContextProvider.getContextSections()` owns project/task/domain sections such as `project.domain`, `project.adr_index`, `task.requirements`, and `task.progress`.
- `PromptManager` owns final rendering and ordering.
- `runAgentLoop` owns `runtimeSections`.
- `SkillManager` owns skill sections.
- `MemoryManager` owns memory sections.
- `ContextWindowManager` owns final pre-model budget enforcement.

Review decisions:

- `readAdrIndex()` must be fail-closed. If `docs/adr` exists but `stat`, `readdir`, or file reads fail because of permissions or transient filesystem errors, return `undefined` rather than failing the whole agent loop.
- Keep database access as dynamic `await import("../../config/database.js")` inside task context helpers. The latest `contextProvider.ts` does not statically import `db`; dynamic import keeps missing/unavailable database behavior consistent with the existing `getTaskStatusSection()` fallback.
- Keep `todoState` and `invokedSkillSections` in test `makeToolUseContext()`. They are required fields in the latest `AgentLoopToolUseContext`; runtime TodoWrite/plan-mode rendering still belongs to `runAgentLoop`, not ContextProvider.

Section ids:

- `project.domain`: bounded `CONTEXT.md` content.
- `project.adr_index`: bounded list of Markdown files under `docs/adr`.
- `context_provider.diagnostics`: JSON metadata describing policy and loaded/skipped context sources.
- `task.requirements`: deterministic task goal/plan/actions summary.
- `task.progress`: deterministic step status summary.

---

## Task 1: Align ContextProvider Tests With Latest Instruction Policy

**Files:**
- Modify: `api/tests/test-context-provider.mjs`

- [x] **Step 1: Add environment save/restore helpers**

Add near the top of `api/tests/test-context-provider.mjs`, after imports:

```js
function setEnv(name, value) {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  return () => {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  };
}

function makeToolUseContext(taskId, query) {
  return {
    taskId,
    query,
    messages: [],
    observations: [],
    options: { tools: [] },
    readFileState: new Map(),
    todoState: [],
    nestedMemoryAttachmentTriggers: new Set(),
    dynamicSkillDirTriggers: new Set(),
    discoveredSkillNames: new Set(),
    invokedSkillSections: [],
  };
}
```

- [x] **Step 2: Replace inline toolUseContext**

Replace the inline `toolUseContext` object in `input` with:

```js
toolUseContext: makeToolUseContext("task-test", "测试上下文"),
```

When creating `emptyInput`, replace:

```js
toolUseContext: { ...input.toolUseContext, taskId: "missing-task" },
```

with:

```js
toolUseContext: makeToolUseContext("missing-task", "测试上下文"),
```

- [x] **Step 3: Assert instructions are disabled by default**

Replace the existing default assertions:

```js
assert.match(userContext.projectInstructions, /AGENTS\.md/);
assert.match(userContext.projectInstructions, /Use project vocabulary/);
assert.match(userContext.projectInstructions, /\.claude\/CLAUDE\.md/);
```

with:

```js
assert.equal(userContext.projectInstructions, undefined);
```

- [x] **Step 4: Add an opt-in project instruction test**

Append after the default `userContext` assertions:

```js
const restoreProjectInstructions = setEnv("AGENT_CONTEXT_PROJECT_INSTRUCTIONS", "1");
try {
  const optedInUserContext = await defaultContextProvider.getUserContext(input);
  assert.match(optedInUserContext.projectInstructions, /AGENTS\.md/);
  assert.match(optedInUserContext.projectInstructions, /Use project vocabulary/);
  assert.match(optedInUserContext.projectInstructions, /\.claude\/CLAUDE\.md/);
} finally {
  restoreProjectInstructions();
}
```

- [x] **Step 5: Update long project instruction test to opt in**

Replace:

```js
const longUserContext = await defaultContextProvider.getUserContext(input);
assert.match(longUserContext.projectInstructions, /\[truncated /);
```

with:

```js
const restoreLongProjectInstructions = setEnv("AGENT_CONTEXT_PROJECT_INSTRUCTIONS", "1");
try {
  const longUserContext = await defaultContextProvider.getUserContext(input);
  assert.match(longUserContext.projectInstructions, /\[truncated /);
} finally {
  restoreLongProjectInstructions();
}
```

- [x] **Step 6: Run the context-provider test and verify it fails**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-context-provider.mjs
```

Expected: FAIL because `AGENT_CONTEXT_PROJECT_INSTRUCTIONS=1` is not implemented yet.

---

## Task 2: Implement Dynamic Project Instruction Policy

**Files:**
- Modify: `api/src/modules/agent-loop/contextProvider.ts`

- [x] **Step 1: Replace static instruction candidate constant**

Replace:

```ts
// Temporarily exclude project instruction files from context.
// Uncomment to restore: AGENTS.md, CLAUDE.md, .claude/CLAUDE.md.
const CONTEXT_FILE_CANDIDATES: string[] = [];
```

with:

```ts
const PROJECT_INSTRUCTION_CANDIDATES = [
  "AGENTS.md",
  "CLAUDE.md",
  path.join(".claude", "CLAUDE.md"),
] as const;
```

- [x] **Step 2: Add opt-in env helper**

Add below `getWorkspaceRoot()`:

```ts
function shouldLoadProjectInstructions(): boolean {
  return process.env.AGENT_CONTEXT_PROJECT_INSTRUCTIONS === "1";
}
```

- [x] **Step 3: Update `readProjectInstructionFiles`**

Replace the `for` loop source in `readProjectInstructionFiles`:

```ts
for (const relativePath of CONTEXT_FILE_CANDIDATES) {
```

with:

```ts
if (!shouldLoadProjectInstructions()) return undefined;
for (const relativePath of PROJECT_INSTRUCTION_CANDIDATES) {
```

- [x] **Step 4: Run the context-provider test**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-context-provider.mjs
```

Expected: PASS and prints `context provider test passed`.

---

## Task 3: Add Project ADR Index Sections

**Files:**
- Modify: `api/src/modules/agent-loop/contextProvider.ts`
- Modify: `api/tests/test-context-provider.mjs`

- [x] **Step 1: Add failing ADR index test**

In `api/tests/test-context-provider.mjs`, after writing `CONTEXT.md`, create an ADR file:

```js
await mkdir(path.join(root, "docs", "adr"), { recursive: true });
await writeFile(path.join(root, "docs", "adr", "0001-context-boundaries.md"), "# ADR 0001 Context Boundaries\nKeep provider boundaries explicit.\n", "utf8");
```

After the existing `project.domain` assertions, add:

```js
assert.equal(sections.some((section) => section.id === "project.adr_index"), true);
const adrIndex = sections.find((section) => section.id === "project.adr_index").content;
assert.match(adrIndex, /0001-context-boundaries\.md/);
assert.match(adrIndex, /ADR 0001 Context Boundaries/);
```

- [x] **Step 2: Run test and verify it fails**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-context-provider.mjs
```

Expected: FAIL because `project.adr_index` is not implemented yet.

- [x] **Step 3: Add ADR index helper**

In `api/src/modules/agent-loop/contextProvider.ts`, update imports:

```ts
import { readFile, readdir, stat } from "node:fs/promises";
```

Add below `readOptionalContextFile`:

```ts
async function readAdrIndex(workspaceRoot: string): Promise<string | undefined> {
  try {
    const adrDir = path.join(workspaceRoot, "docs", "adr");
    if (!existsSync(adrDir)) return undefined;
    const adrStat = await stat(adrDir);
    if (!adrStat.isDirectory()) return undefined;

    const entries = await readdir(adrDir, { withFileTypes: true });
    const rows: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const relativePath = path.join("docs", "adr", entry.name).replace(/\\/g, "/");
      const content = await readOptionalContextFile(path.join(adrDir, entry.name));
      const title = content?.split(/\r?\n/).find((line) => line.startsWith("# "))?.replace(/^#\s+/, "").trim();
      rows.push(`- ${relativePath}${title ? `: ${title}` : ""}`);
    }

    if (rows.length === 0) return undefined;
    return truncate(rows.sort().join("\n"), MAX_CONTEXT_SECTION_CHARS);
  } catch {
    return undefined;
  }
}
```

- [x] **Step 4: Wire ADR index into `getContextSections`**

Replace `getContextSections` body:

```ts
const workspaceRoot = getWorkspaceRoot();
const domain = await readOptionalContextFile(path.join(workspaceRoot, "CONTEXT.md"));
return domain
  ? [{ id: "project.domain", content: domain }]
  : [];
```

with:

```ts
const workspaceRoot = getWorkspaceRoot();
const [domain, adrIndex] = await Promise.all([
  readOptionalContextFile(path.join(workspaceRoot, "CONTEXT.md")),
  readAdrIndex(workspaceRoot),
]);
return [
  ...(domain ? [{ id: "project.domain", content: domain }] : []),
  ...(adrIndex ? [{ id: "project.adr_index", content: adrIndex }] : []),
];
```

- [x] **Step 5: Run context-provider test**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-context-provider.mjs
```

Expected: PASS.

---

## Task 4: Add Task Section Formatters

**Files:**
- Modify: `api/src/modules/agent-loop/contextProvider.ts`
- Modify: `api/tests/test-context-provider.mjs`

- [x] **Step 1: Export narrow task formatter input types**

In `api/src/modules/agent-loop/contextProvider.ts`, add after the `ContextProvider` interface:

```ts
export interface ContextProviderTaskSnapshot {
  id: string;
  status: string;
  query: string;
  plan?: unknown;
  actions?: unknown;
  result?: unknown;
  error?: string | null;
}

export interface ContextProviderTaskStepSnapshot {
  id: string;
  actionType: string;
  actionConfig: unknown;
  status: string;
  result?: unknown;
  error?: string | null;
}
```

- [x] **Step 2: Add pure formatter helpers**

Add below `getTaskStatusSection`:

```ts
export function formatTaskRequirementSection(task: ContextProviderTaskSnapshot): PromptSection {
  return {
    id: "task.requirements",
    content: truncate(JSON.stringify({
      id: task.id,
      status: task.status,
      query: task.query,
      plan: task.plan ?? null,
      actions: task.actions ?? null,
    }, null, 2), MAX_CONTEXT_SECTION_CHARS),
  };
}

export function formatTaskProgressSection(steps: ContextProviderTaskStepSnapshot[]): PromptSection | undefined {
  if (steps.length === 0) return undefined;
  const statusCounts = steps.reduce<Record<string, number>>((counts, step) => {
    counts[step.status] = (counts[step.status] ?? 0) + 1;
    return counts;
  }, {});
  return {
    id: "task.progress",
    content: truncate(JSON.stringify({
      stepCount: steps.length,
      statusCounts,
      recentSteps: steps.slice(-10).map((step) => ({
        id: step.id,
        actionType: step.actionType,
        status: step.status,
        error: step.error ?? null,
      })),
    }, null, 2), MAX_CONTEXT_SECTION_CHARS),
  };
}
```

- [x] **Step 3: Add pure formatter tests**

At the top of `api/tests/test-context-provider.mjs`, update import:

```js
import {
  defaultContextProvider,
  formatTaskProgressSection,
  formatTaskRequirementSection,
} from "../src/modules/agent-loop/contextProvider.ts";
```

Before final cleanup, add:

```js
const requirementSection = formatTaskRequirementSection({
  id: "task-1",
  status: "running",
  query: "Find project context",
  plan: [{ step: "Inspect files" }],
  actions: [{ type: "Read" }],
});
assert.equal(requirementSection.id, "task.requirements");
assert.match(requirementSection.content, /Find project context/);
assert.match(requirementSection.content, /Inspect files/);

const progressSection = formatTaskProgressSection([
  { id: "step-1", actionType: "Read", actionConfig: {}, status: "completed" },
  { id: "step-2", actionType: "Grep", actionConfig: {}, status: "failed", error: "pattern missing" },
]);
assert.equal(progressSection.id, "task.progress");
assert.match(progressSection.content, /"completed": 1/);
assert.match(progressSection.content, /"failed": 1/);
assert.match(progressSection.content, /pattern missing/);
```

- [x] **Step 4: Run context-provider test**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-context-provider.mjs
```

Expected: PASS.

---

## Task 5: Wire Task Sections Into ContextProvider

**Files:**
- Modify: `api/src/modules/agent-loop/contextProvider.ts`
- Modify: `api/tests/test-context-provider.mjs`

- [x] **Step 1: Add task section loader**

Add below `getTaskStatusSection`:

```ts
async function getTaskContextSections(taskId: string): Promise<PromptSection[]> {
  try {
    const { db } = await import("../../config/database.js");
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task) return [];
    const steps = await db.select().from(taskSteps).where(eq(taskSteps.taskId, taskId));
    const progressSection = formatTaskProgressSection(steps);
    return [
      formatTaskRequirementSection(task),
      ...(progressSection ? [progressSection] : []),
    ];
  } catch {
    return [];
  }
}
```

- [x] **Step 2: Wire task sections into `getContextSections`**

In `getContextSections`, extend the `Promise.all` call:

```ts
const [domain, adrIndex, taskSections] = await Promise.all([
  readOptionalContextFile(path.join(workspaceRoot, "CONTEXT.md")),
  readAdrIndex(workspaceRoot),
  getTaskContextSections(input.taskId),
]);
```

Return:

```ts
return [
  ...(domain ? [{ id: "project.domain", content: domain }] : []),
  ...(adrIndex ? [{ id: "project.adr_index", content: adrIndex }] : []),
  ...taskSections,
];
```

- [x] **Step 3: Keep missing database behavior tested**

The existing test environment usually has no database row for `task-test`. Keep this assertion:

```js
assert.equal(systemContext.taskStatus, undefined);
```

Add:

```js
assert.equal(sections.some((section) => section.id === "task.requirements"), false);
assert.equal(sections.some((section) => section.id === "task.progress"), false);
```

- [x] **Step 4: Run context-provider test**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-context-provider.mjs
```

Expected: PASS.

---

## Task 6: Add Context Provider Diagnostics

**Files:**
- Modify: `api/src/modules/agent-loop/contextProvider.ts`
- Modify: `api/tests/test-context-provider.mjs`

- [x] **Step 1: Add diagnostics interface**

Add after task snapshot interfaces:

```ts
interface ContextProviderDiagnostics {
  projectInstructionsEnabled: boolean;
  loadedSections: string[];
  skippedSources: string[];
  estimateMethod: "chars";
}
```

- [x] **Step 2: Add diagnostics builder**

Add below `readAdrIndex`:

```ts
function buildContextProviderDiagnostics(input: {
  sections: PromptSection[];
  domainLoaded: boolean;
  adrIndexLoaded: boolean;
  taskSectionCount: number;
}): ContextProviderDiagnostics {
  const skippedSources: string[] = [];
  if (!shouldLoadProjectInstructions()) skippedSources.push("projectInstructions");
  if (!input.domainLoaded) skippedSources.push("CONTEXT.md");
  if (!input.adrIndexLoaded) skippedSources.push("docs/adr");
  if (input.taskSectionCount === 0) skippedSources.push("taskSections");
  return {
    projectInstructionsEnabled: shouldLoadProjectInstructions(),
    loadedSections: input.sections.map((section) => section.id),
    skippedSources,
    estimateMethod: "chars",
  };
}
```

- [x] **Step 3: Append diagnostics section**

In `getContextSections`, build `sections` first:

```ts
const sections = [
  ...(domain ? [{ id: "project.domain", content: domain }] : []),
  ...(adrIndex ? [{ id: "project.adr_index", content: adrIndex }] : []),
  ...taskSections,
];
return [
  ...sections,
  {
    id: "context_provider.diagnostics",
    content: JSON.stringify(buildContextProviderDiagnostics({
      sections,
      domainLoaded: Boolean(domain),
      adrIndexLoaded: Boolean(adrIndex),
      taskSectionCount: taskSections.length,
    })),
  },
];
```

- [x] **Step 4: Add diagnostics assertions**

In `api/tests/test-context-provider.mjs`, after section assertions, add:

```js
const diagnosticsSection = sections.find((section) => section.id === "context_provider.diagnostics");
assert.ok(diagnosticsSection);
const diagnostics = JSON.parse(diagnosticsSection.content);
assert.equal(diagnostics.projectInstructionsEnabled, false);
assert.ok(diagnostics.loadedSections.includes("project.domain"));
assert.ok(diagnostics.loadedSections.includes("project.adr_index"));
assert.ok(Array.isArray(diagnostics.skippedSources));
assert.equal(diagnostics.estimateMethod, "chars");
```

- [x] **Step 5: Run context-provider test**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-context-provider.mjs
```

Expected: PASS.

---

## Task 7: Update TODO Documentation

**Files:**
- Modify: `api/src/todo.md`

- [x] **Step 1: Replace Context Provider status block**

In the `## Context Provider` section, replace the existing `Implemented Phase 1` and `Deferred` blocks with:

```md
Implemented:

- Phase 1: `defaultContextProvider.getUserContext()` injects current date and bounded project instruction files when explicitly enabled.
- Phase 1: `defaultContextProvider.getSystemContext()` injects workspace root, bounded git status, and task status when available.
- Phase 1: `defaultContextProvider.getContextSections()` injects bounded `CONTEXT.md` as `project.domain`.
- Phase 2: project instruction files are disabled by default and can be enabled with `AGENT_CONTEXT_PROJECT_INSTRUCTIONS=1`.
- Phase 2: `docs/adr` is exposed as bounded `project.adr_index`.
- Phase 2: task records and task steps can be rendered as `task.requirements` and `task.progress`.
- Phase 2: `context_provider.diagnostics` reports loaded sections and skipped sources.

Deferred:

- user preference/config loading beyond project instruction files.
- bounded include expansion for project instruction files.
- full database-backed context-provider integration tests.
- durable transcript-based resume context.
```

- [x] **Step 2: Run typecheck**

Run from `api/`:

```powershell
.\node_modules\.bin\tsc.CMD
```

Expected: PASS.

---

## Task 8: Final Verification

**Files:**
- Verify only.

- [x] **Step 1: Run context-provider regression script**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-context-provider.mjs
```

Expected: PASS and prints `context provider test passed`.

- [x] **Step 2: Run prompt-manager regression script**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-prompt-manager.mjs
```

Expected: PASS and prints `prompt manager test passed`.

- [x] **Step 3: Run context-window regression script**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-context-window-manager.mjs
```

Expected: PASS and prints `context window manager test passed`.

- [x] **Step 4: Run backend typecheck**

Run from `api/`:

```powershell
.\node_modules\.bin\tsc.CMD
```

Expected: no TypeScript errors.

- [x] **Step 5: Inspect git diff**

Run from repo root:

```powershell
git diff -- api/src/modules/agent-loop/contextProvider.ts api/tests/test-context-provider.mjs api/src/todo.md api/plan/context-provider-phase2-plan.md
```

Expected:

- `contextProvider.ts` contains deterministic context loading only.
- `test-context-provider.mjs` covers disabled-by-default project instructions, env opt-in, ADR index, task formatter sections, diagnostics, and missing-source behavior.
- `api/src/todo.md` records ContextProvider Phase 2 and keeps memory/skill/runtime/window work out of scope.

## Acceptance Checklist

- [x] `getUserContext()` always returns `currentDate`.
- [x] Project instruction files are disabled by default.
- [x] `AGENT_CONTEXT_PROJECT_INSTRUCTIONS=1` enables bounded AGENTS/CLAUDE loading.
- [x] `getSystemContext()` still returns `workspaceRoot`.
- [x] Git status remains bounded and missing-git-safe.
- [x] Missing task rows do not throw.
- [x] `project.domain` is loaded from bounded `CONTEXT.md` when present.
- [x] `project.adr_index` is loaded from bounded `docs/adr` when present.
- [x] `task.requirements` and `task.progress` formatters are deterministic and tested.
- [x] `context_provider.diagnostics` reports loaded sections and skipped sources.
- [x] ContextProvider does not emit memory sections.
- [x] ContextProvider does not emit skill sections.
- [x] ContextProvider does not emit runtime TodoWrite or plan-mode sections.
- [x] ContextProvider does not call tools.
- [x] ContextProvider does not call models.
- [x] `api/tests/test-context-provider.mjs` passes.
- [x] `api/tests/test-prompt-manager.mjs` passes.
- [x] `api/tests/test-context-window-manager.mjs` passes.
- [x] `api/node_modules/.bin/tsc.CMD` passes from `api/`.

## Deferred Phase 3

1. Add user preference/config loading after a durable user settings source exists.
2. Add include expansion for project instruction files with cycle detection and bounded depth.
3. Add database-backed integration tests with an isolated test database.
4. Add transcript-resume context after transcript persistence is enabled.
5. Add project-context caching only after correctness and invalidation rules are clear.
