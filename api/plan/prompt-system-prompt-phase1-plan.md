# Prompt / System Prompt Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal `defaultPromptManager` prompt with a deterministic, Claude Code-inspired system prompt renderer that gives the model clear operating rules, tool-use rules, and context priority.

**Architecture:** Keep `PromptManager` as a pure renderer: it consumes already-loaded context/memory/skill/tool materials and returns model messages. It must not fetch context, call tools, inspect files, compact messages, or mutate runtime state. The implementation should be deterministic and regression-tested so future context/memory/skill work can rely on stable section ordering.

**Tech Stack:** TypeScript 5, existing `AgentMessage` / `PromptSection` / `ToolDefinition` types, script tests via local `tsx`, backend typecheck via local `tsc`.

---

## Grill-Me Decision

Recommended answer: write the system prompt rules in English, but explicitly instruct the agent to answer in the user's language unless the user asks otherwise.

Why: the current tool protocol, model-facing tool names, and existing prompt are English. English rules tend to be compact and stable for tool-use behavior, while the final-answer language rule preserves the Chinese-first user experience.

If this assumption is wrong, update Task 2 Step 3 and Task 3 Step 2 before implementation.

## Scope

In scope:

- Add prompt-manager regression tests.
- Render a stable system prompt with clear role, tool-use policy, context priority, and final-answer policy.
- Render tools with useful metadata from `ToolDefinition`.
- Render prompt sections in a fixed order: user context, system context, project/context sections, runtime sections, memory sections, skill sections.
- Keep the final user message as the original query.
- Update docs to mark Prompt/System Prompt Phase 1 as implemented.

Out of scope:

- Model/provider-specific prompt adapters.
- Context fetching changes in `ContextProvider`.
- Memory retrieval or durable memory.
- Skill discovery behavior changes.
- Context-window trimming or compaction.
- Tool permission logic changes in `toolGateway`.
- Prompt localization beyond "answer in the user's language".

## File Structure

- Create: `api/tests/test-prompt-manager.mjs`
  - Regression tests for prompt shape, tool metadata rendering, section ordering, runtime sections, and empty-input behavior.

- Modify: `api/src/modules/agent-loop/promptManager.ts`
  - Replace the minimal prompt with named rendering helpers.
  - Keep `PromptManagerInput` and `PromptManager` interfaces unchanged.
  - Keep `recordToPromptSections` private, but make its ordering deterministic.

- Modify: `api/src/todo.md`
  - Mark Prompt/System Prompt Phase 1 as implemented.
  - Keep provider-specific prompts and advanced prompt personalization deferred.

## Design Notes

The system prompt should be composed from stable blocks:

```text
# Agent Role
# Operating Rules
# Tool Use Rules
# Context Priority
# Available Tools
# Additional Context
```

The default prompt should include these rules:

- Work as a software engineering agent inside the current project.
- Follow project instructions when present.
- Use tools when workspace state or external facts are needed.
- Do not invent tool names, tool arguments, files, commands, or observations.
- If a tool fails, use the observation to decide whether to retry, choose another tool, or explain the limitation.
- Treat destructive or permission-sensitive actions cautiously; the gateway enforces policy, but the model should still avoid unnecessary risk.
- Answer in the user's language unless the user asks for another language.
- Keep final answers concise and include relevant file references when discussing code.

Tool metadata should be rendered without executing tool callbacks. Function-valued metadata should be represented as `"dynamic"` instead of being called.

Review decisions:

- Use bytewise ASCII key ordering for `recordToPromptSections` instead of `localeCompare`, so section order does not depend on Node.js locale settings if non-ASCII keys appear later.
- Treat `null` metadata like `undefined`; do not render it.
- Do not render empty-string metadata values. Tool descriptions remain required by `ToolDefinition`, but optional metadata should not produce empty `label:` lines.

---

## Task 1: Add Prompt Manager Regression Tests

**Files:**
- Create: `api/tests/test-prompt-manager.mjs`

- [x] **Step 1: Create the test file with imports and helpers**

Create `api/tests/test-prompt-manager.mjs`:

```js
import assert from "node:assert/strict";
import { z } from "zod";
import { defaultPromptManager } from "../src/modules/agent-loop/promptManager.ts";

function makeTool(name, description, extra = {}) {
  return {
    name,
    description,
    inputSchema: z.object({}),
    async execute() {
      return {};
    },
    ...extra,
  };
}

function buildInput(overrides = {}) {
  return {
    query: "请查看项目状态并给出下一步建议",
    tools: [
      makeTool("Read", "Read a file from the workspace.", {
        kind: "system",
        aliases: ["View"],
        isReadOnly: () => true,
        isConcurrencySafe: () => true,
        riskLevel: "low",
        maxResultSizeChars: 18000,
      }),
      makeTool("Edit", "Edit a file in the workspace.", {
        kind: "system",
        isDestructive: () => true,
        riskLevel: () => "high",
      }),
    ],
    userContext: {
      currentDate: "Today's date is 2026-06-05. Time zone: Asia/Shanghai.",
      projectInstructions: "Follow AGENTS.md.",
    },
    systemContext: {
      workspaceRoot: "S:/Projects/projects_new",
      gitStatus: " M api/src/modules/agent-loop/promptManager.ts",
    },
    contextSections: [
      { id: "project.domain", content: "Domain context." },
    ],
    runtimeSections: [
      { id: "runtime.todo", content: "Todo state." },
    ],
    memorySections: [
      { id: "memory.session", content: "Remembered project preference." },
    ],
    skillSections: [
      { id: "skill.listing", content: "Available skills index." },
    ],
    observations: [],
    ...overrides,
  };
}
```

- [x] **Step 2: Add prompt shape assertions**

Append:

```js
const result = defaultPromptManager.buildMessages(buildInput());

assert.equal(result.length, 2);
assert.equal(result[0].role, "system");
assert.equal(result[1].role, "user");
assert.equal(result[1].content, "请查看项目状态并给出下一步建议");

const system = result[0].content;
assert.match(system, /# Agent Role/);
assert.match(system, /# Operating Rules/);
assert.match(system, /# Tool Use Rules/);
assert.match(system, /# Context Priority/);
assert.match(system, /# Available Tools/);
assert.match(system, /# Additional Context/);
assert.doesNotMatch(system, /minimal tool-using agent/);
```

- [x] **Step 3: Add tool metadata assertions**

Append:

```js
assert.match(system, /## Read/);
assert.match(system, /description: Read a file from the workspace\./);
assert.match(system, /kind: system/);
assert.match(system, /aliases: View/);
assert.match(system, /readOnly: dynamic/);
assert.match(system, /concurrencySafe: dynamic/);
assert.match(system, /riskLevel: low/);
assert.match(system, /maxResultSizeChars: 18000/);

assert.match(system, /## Edit/);
assert.match(system, /destructive: dynamic/);
assert.match(system, /riskLevel: dynamic/);
```

- [x] **Step 4: Add section ordering assertions**

Append:

```js
const orderedMarkers = [
  "## user_context.currentDate",
  "## user_context.projectInstructions",
  "## system_context.gitStatus",
  "## system_context.workspaceRoot",
  "## project.domain",
  "## runtime.todo",
  "## memory.session",
  "## skill.listing",
];

let previousIndex = -1;
for (const marker of orderedMarkers) {
  const index = system.indexOf(marker);
  assert.notEqual(index, -1, `${marker} should be rendered`);
  assert.ok(index > previousIndex, `${marker} should appear after the previous section`);
  previousIndex = index;
}
```

This test expects record keys to be sorted alphabetically inside each context group.

- [x] **Step 5: Add empty input assertions**

Append:

```js
const emptyResult = defaultPromptManager.buildMessages(buildInput({
  tools: [],
  userContext: {},
  systemContext: {},
  contextSections: [],
  runtimeSections: [],
  memorySections: [],
  skillSections: [],
}));

const emptySystem = emptyResult[0].content;
assert.match(emptySystem, /\(none\)/);
assert.doesNotMatch(emptySystem, /# Additional Context\s+\S/s);
assert.equal(emptyResult[1].content, "请查看项目状态并给出下一步建议");

console.log("prompt manager test passed");
```

- [x] **Step 6: Run the test and verify it fails**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-prompt-manager.mjs
```

Expected: FAIL because the current prompt still says `You are a minimal tool-using agent.` and does not render structured sections or metadata.

---

## Task 2: Add Prompt Rendering Helpers

**Files:**
- Modify: `api/src/modules/agent-loop/promptManager.ts`

- [x] **Step 1: Add metadata helper types**

Add below the `PromptManager` interface:

```ts
type ToolMetadataValue = string | number | boolean | "dynamic";
```

- [x] **Step 2: Add system prompt constants**

Add below the type:

```ts
const BASE_SYSTEM_PROMPT = [
  "# Agent Role",
  "You are a software engineering agent running inside this project's agent loop.",
  "You help with code, project analysis, tool-assisted investigation, and implementation planning.",
  "",
  "# Operating Rules",
  "- Follow the user's request and the project instructions provided in context.",
  "- Answer in the user's language unless the user asks for a different language.",
  "- Be concise, but include enough technical detail for the user to act.",
  "- When discussing code, reference relevant files or symbols when they are known.",
  "- Do not invent files, tool outputs, commands, APIs, or project facts.",
  "",
  "# Tool Use Rules",
  "- Use tools when workspace state, file contents, command output, or external facts are needed.",
  "- Use only the available tool names and valid arguments.",
  "- If a tool fails, use the observation to decide whether to retry, choose another tool, or explain the limitation.",
  "- Avoid unnecessary destructive or permission-sensitive actions.",
  "- Treat tool observations as authoritative for the current run.",
  "",
  "# Context Priority",
  "Use context in this priority order: explicit user request, project instructions, system/workspace context, project/domain context, runtime state, memory, then skill listings.",
  "If two context sections conflict, prefer the more specific and more recent section, and mention important uncertainty to the user.",
].join("\n");
```

- [x] **Step 3: Add metadata formatting helpers**

Add:

```ts
function metadataValue(value: unknown): ToolMetadataValue | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "function") return "dynamic";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function renderMetadataLine(label: string, value: ToolMetadataValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  return `${label}: ${value}`;
}
```

- [x] **Step 4: Add `renderToolCatalog`**

Add:

```ts
function renderToolCatalog(tools: ToolDefinition[]): string {
  if (tools.length === 0) return "(none)";

  return tools
    .map((tool) => {
      const lines = [
        `## ${tool.name}`,
        `description: ${tool.description}`,
        renderMetadataLine("kind", metadataValue(tool.kind)),
        renderMetadataLine("aliases", tool.aliases?.length ? tool.aliases.join(", ") : undefined),
        renderMetadataLine("readOnly", metadataValue(tool.isReadOnly)),
        renderMetadataLine("destructive", metadataValue(tool.isDestructive)),
        renderMetadataLine("concurrencySafe", metadataValue(tool.isConcurrencySafe)),
        renderMetadataLine("riskLevel", metadataValue(tool.riskLevel)),
        renderMetadataLine("requiresUserInteraction", metadataValue(tool.requiresUserInteraction)),
        renderMetadataLine("maxResultSizeChars", metadataValue(tool.maxResultSizeChars)),
      ].filter((line): line is string => Boolean(line));
      return lines.join("\n");
    })
    .join("\n\n");
}
```

- [x] **Step 5: Add `renderPromptSections`**

Add:

```ts
function renderPromptSections(sections: PromptSection[]): string {
  return sections
    .map((section) => `## ${section.id}\n${section.content}`)
    .join("\n\n");
}
```

---

## Task 3: Replace The Minimal System Prompt

**Files:**
- Modify: `api/src/modules/agent-loop/promptManager.ts`

- [x] **Step 1: Replace `buildMessages` internals**

Replace the body of `buildMessages(input)` with:

```ts
const toolCatalog = renderToolCatalog(input.tools);
const sections = [
  ...recordToPromptSections("user_context", input.userContext),
  ...recordToPromptSections("system_context", input.systemContext),
  ...input.contextSections,
  ...input.runtimeSections,
  ...input.memorySections,
  ...input.skillSections,
];
const additionalContext = renderPromptSections(sections);

const system = [
  BASE_SYSTEM_PROMPT,
  "",
  "# Available Tools",
  toolCatalog,
  additionalContext ? ["", "# Additional Context", additionalContext].join("\n") : "",
].filter(Boolean).join("\n");

return [
  { role: "system", content: system },
  { role: "user", content: input.query },
];
```

- [x] **Step 2: Make record section ordering deterministic**

Replace `recordToPromptSections` with:

```ts
function recordToPromptSections(prefix: string, record: Record<string, string>): PromptSection[] {
  return Object.entries(record)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, content]) => ({
      id: `${prefix}.${key}`,
      content,
    }));
}
```

- [x] **Step 3: Remove the large `need to change` comment block**

Delete the star-banner comment block around the old minimal system prompt. Keep normal code only.

- [x] **Step 4: Run the prompt-manager test**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-prompt-manager.mjs
```

Expected: PASS and prints `prompt manager test passed`.

---

## Task 4: Add Regression Coverage For Prompt Integration Boundaries

**Files:**
- Modify: `api/tests/test-prompt-manager.mjs`

- [x] **Step 1: Add an assertion that PromptManager stays a pure renderer**

Append before final `console.log`:

```js
const beforeInput = buildInput();
const beforeSnapshot = JSON.stringify({
  query: beforeInput.query,
  userContext: beforeInput.userContext,
  systemContext: beforeInput.systemContext,
  contextSections: beforeInput.contextSections,
  runtimeSections: beforeInput.runtimeSections,
  memorySections: beforeInput.memorySections,
  skillSections: beforeInput.skillSections,
});

defaultPromptManager.buildMessages(beforeInput);

const afterSnapshot = JSON.stringify({
  query: beforeInput.query,
  userContext: beforeInput.userContext,
  systemContext: beforeInput.systemContext,
  contextSections: beforeInput.contextSections,
  runtimeSections: beforeInput.runtimeSections,
  memorySections: beforeInput.memorySections,
  skillSections: beforeInput.skillSections,
});

assert.equal(afterSnapshot, beforeSnapshot);
```

- [x] **Step 2: Add an assertion that observations are not rendered yet**

Append before final `console.log`:

```js
const observationResult = defaultPromptManager.buildMessages(buildInput({
  observations: [
    {
      toolCallId: "call-1",
      toolName: "Read",
      ok: true,
      output: { content: "already present in conversation" },
    },
  ],
}));

assert.doesNotMatch(observationResult[0].content, /already present in conversation/);
```

Rationale: tool observations already become `tool` messages in `runAgentLoop`; rendering them again inside the system prompt would duplicate context.

- [x] **Step 3: Run the prompt-manager test**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-prompt-manager.mjs
```

Expected: PASS.

---

## Task 5: Update TODO Documentation

**Files:**
- Modify: `api/src/todo.md`

- [x] **Step 1: Add implemented/deferred bullets under Prompt/System Prompt**

In the `## Prompt / System Prompt` section, after the current explanatory bullets and before `## Context Provider`, add:

```md
Implemented:

- Phase 1: `defaultPromptManager.buildMessages()` renders a structured system prompt with agent role, operating rules, tool-use rules, context priority, available tools, and additional context.
- Phase 1: tool metadata is rendered deterministically without executing tool callbacks.
- Phase 1: prompt sections are rendered in a stable order: user context, system context, project/domain context, runtime state, memory, then skills.

Deferred:

- provider/model-specific prompt variants.
- prompt personalization beyond answering in the user's language.
- rendering observations into summary sections; current loop keeps observations as conversation tool messages.
- prompt section token budgeting beyond `ContextWindowManager`.
```

- [x] **Step 2: Run typecheck**

Run from `api/`:

```powershell
.\node_modules\.bin\tsc.CMD
```

Expected: PASS.

---

## Task 6: Final Verification

**Files:**
- Verify only.

- [x] **Step 1: Run prompt-manager regression script**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-prompt-manager.mjs
```

Expected: PASS and prints `prompt manager test passed`.

- [x] **Step 2: Run context-provider regression script**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-context-provider.mjs
```

Expected: PASS and prints `context provider test passed`.

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
git diff -- api/src/modules/agent-loop/promptManager.ts api/tests/test-prompt-manager.mjs api/src/todo.md api/plan/prompt-system-prompt-phase1-plan.md
```

Expected:

- `promptManager.ts` contains only pure rendering helpers and no context fetching, tool execution, or context-window logic.
- `test-prompt-manager.mjs` covers prompt shape, tool metadata, section ordering, empty input, purity, and observation non-duplication.
- `api/src/todo.md` marks Prompt/System Prompt Phase 1 implemented and keeps advanced prompt work deferred.

## Acceptance Checklist

- [x] `defaultPromptManager.buildMessages()` still returns exactly one system message and one user message before conversation history is appended by `runAgentLoop`.
- [x] The user message content remains the original `input.query`.
- [x] The system prompt no longer says `minimal tool-using agent`.
- [x] The system prompt includes `# Agent Role`, `# Operating Rules`, `# Tool Use Rules`, `# Context Priority`, and `# Available Tools`.
- [x] Empty tools render as `(none)`.
- [x] Tool metadata includes description and available non-executed metadata.
- [x] Function-valued tool metadata renders as `dynamic`.
- [x] Additional context renders only when at least one section exists.
- [x] Context section order is deterministic, including runtime sections between project/domain context and memory.
- [x] Observations are not duplicated into the system prompt.
- [x] No context fetching is added to `PromptManager`.
- [x] No model calls are added to `PromptManager`.
- [x] No context-window trimming is added to `PromptManager`.
- [x] `api/tests/test-prompt-manager.mjs` passes.
- [x] `api/tests/test-context-provider.mjs` passes.
- [x] `api/tests/test-context-window-manager.mjs` passes.
- [x] `api/node_modules/.bin/tsc.CMD` passes from `api/`.

## Deferred Phase 2

1. Add provider/model-specific prompt adapters if DeepSeek/OpenAI/Coze require different formatting.
2. Add system-prompt version diagnostics in model request telemetry.
3. Add richer domain-specific agent policy for GIS/data-intelligence workflows.
4. Add prompt snapshots for smoke tests.
5. Revisit observation summarization only after transcript persistence is stable.
