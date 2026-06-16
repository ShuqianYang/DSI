# Prompt Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record stable prompt/context/tool version metadata for every Agent Loop model request so future memory, resume, and audit behavior can be traced to the exact prompt surface used by that run.

**Architecture:** Add prompt version metadata as structured transcript metadata, not as a new table. `PromptManager` exposes template/component version information; a new `promptVersioning.ts` helper builds deterministic hashes/summaries for tool catalog and prompt context sections; `runAgentLoop` attaches that metadata to `model_request` transcript entries. The model-visible prompt content remains unchanged except for intentional future prompt edits.

**Tech Stack:** TypeScript 5, Node `crypto`, existing `PromptManager`, `runAgentLoop`, `AgentTranscriptStore.metadata`, script tests via local `tsx`, backend typecheck via local `tsc`.

---

## Current State

Already available:

- `api/src/modules/agent-loop/promptManager.ts`
  - Owns base system prompt, GIS routing rules, disaster satellite rules, tool catalog rendering, and final prompt section ordering.
- `api/src/modules/agent-loop/runAgentLoop.ts`
  - Calls `promptManager.buildMessages(...)`.
  - Calls `contextWindowManager.prepareMessages(...)`.
  - Appends `model_request` transcript entries before model calls.
- `api/src/modules/agent-loop/transcriptStore.ts`
  - `AgentTranscriptEntry.metadata?: Record<string, unknown>` already exists.
  - `createDbTranscriptStore()` persists `metadata` as JSONB after safe JSON serialization.
- `api/plan/transcript-persistence-plan.md`
  - Transcript Persistence MVP is complete and DB-verified.

Important boundary:

- Do not add a new DB table for this MVP.
- Do not render version metadata into the model-visible prompt.
- Do not implement memory in this plan.
- Do not implement full runtime resume in this plan.

## Desired Metadata Shape

Each `model_request` transcript entry should include:

```ts
metadata: {
  prompt: {
    promptVersion: "agent-loop-prompt-v1",
    componentVersions: {
      baseSystem: "base-system-v1",
      toolUseRules: "tool-use-rules-v1",
      gisRoutingRules: "gis-routing-rules-v2",
      disasterSatelliteRules: "disaster-satellite-rules-v1",
      contextPriorityRules: "context-priority-rules-v1",
      toolCatalogRenderer: "tool-catalog-renderer-v1",
      promptSectionRenderer: "prompt-section-renderer-v1"
    },
    toolCatalog: {
      count: 3,
      names: ["RegionResolve", "RegionMark", "WeatherFetch"],
      hash: "sha256:..."
    },
    contextSections: {
      count: 6,
      ids: ["project.database_description", "task.requirements", "transcript.resume_context"],
      hash: "sha256:..."
    },
    runtimeSections: {
      count: 0,
      ids: [],
      hash: "sha256:..."
    },
    memorySections: {
      count: 0,
      ids: [],
      hash: "sha256:..."
    },
    skillSections: {
      count: 1,
      ids: ["skill.listing"],
      hash: "sha256:..."
    },
    messages: {
      rawCount: 2,
      preparedCount: 2,
      rawHash: "sha256:...",
      preparedHash: "sha256:..."
    }
  }
}
```

Notes:

- Hashes must be deterministic for the same prompt inputs.
- Hashes are bounded audit fingerprints, not complete content fingerprints. They include ids/names, lengths, and leading previews so transcript metadata stays small. If a future workflow needs strong uniqueness, add separate full-content hashes behind explicit size limits.
- Section ids and tool names should preserve prompt order because ordering can affect model behavior.
- Tool catalog hashes should mirror every model-visible metadata line rendered by `PromptManager`: `kind`, `aliases`, `readOnly`, `destructive`, `concurrencySafe`, `riskLevel`, `requiresUserInteraction`, and `maxResultSizeChars`.
- The full `messages` payload is already stored in transcript `messages`; metadata is for audit/indexing, not duplication.

## File Structure

- Modify: `api/src/modules/agent-loop/promptManager.ts`
  - Export prompt version constants.
  - Export the tool metadata normalization helper used by the prompt renderer.
  - Add optional `getVersionMetadata()` to `PromptManager`.
  - Implement the default manager version metadata.

- Create: `api/src/modules/agent-loop/promptVersioning.ts`
  - Build deterministic prompt metadata from prompt input/materials.
  - Hash tool catalog summaries, section summaries, raw messages, and prepared messages.
  - Keep output JSON-safe and bounded.

- Modify: `api/src/modules/agent-loop/tools/_shared/serialization.ts`
  - Share stable JSON canonicalization between prompt versioning and duplicate read-only tool signatures.

- Modify: `api/src/modules/agent-loop/runAgentLoop.ts`
  - Build prompt metadata after raw/prepared messages are known.
  - Attach metadata to each `model_request` transcript entry.

- Test: `api/tests/agent-loop/test-prompt-versioning.mjs`
  - Unit-test deterministic metadata and hashing.

- Test: `api/tests/agent-loop/test-agent-loop-prompt-versioning.mjs`
  - Run Agent Loop with fake model/store and assert `model_request.metadata.prompt`.

- Modify: `api/tests/agent-loop/test-prompt-manager.mjs`
  - Assert default prompt manager exposes stable version metadata.

- Modify: `api/plan/agent-loop-migration-roadmap.md`
  - Mark Prompt Versioning MVP complete after implementation.

---

## Task 1: Expose Prompt Manager Version Metadata

**Files:**

- Modify: `api/src/modules/agent-loop/promptManager.ts`
- Test: `api/tests/agent-loop/test-prompt-manager.mjs`

- [x] **Step 1: Add failing test assertions**

In `api/tests/agent-loop/test-prompt-manager.mjs`, after:

```js
import { defaultPromptManager } from "../../src/modules/agent-loop/promptManager.ts";
```

change it to:

```js
import {
  DEFAULT_PROMPT_COMPONENT_VERSIONS,
  DEFAULT_PROMPT_VERSION,
  defaultPromptManager,
} from "../../src/modules/agent-loop/promptManager.ts";
```

Add this block after the import helper functions:

```js
assert.equal(DEFAULT_PROMPT_VERSION, "agent-loop-prompt-v1");
assert.deepEqual(DEFAULT_PROMPT_COMPONENT_VERSIONS, {
  baseSystem: "base-system-v1",
  toolUseRules: "tool-use-rules-v1",
  gisRoutingRules: "gis-routing-rules-v2",
  disasterSatelliteRules: "disaster-satellite-rules-v1",
  contextPriorityRules: "context-priority-rules-v1",
  toolCatalogRenderer: "tool-catalog-renderer-v1",
  promptSectionRenderer: "prompt-section-renderer-v1",
});

const versionMetadata = defaultPromptManager.getVersionMetadata();
assert.equal(versionMetadata.promptVersion, DEFAULT_PROMPT_VERSION);
assert.deepEqual(versionMetadata.componentVersions, DEFAULT_PROMPT_COMPONENT_VERSIONS);
```

- [x] **Step 2: Run the prompt-manager test and verify it fails**

Run from `api/`:

```powershell
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-prompt-manager.mjs
```

Expected: FAIL because exports and `getVersionMetadata()` do not exist yet.

- [x] **Step 3: Extend `PromptManager` interface**

In `api/src/modules/agent-loop/promptManager.ts`, add this interface before `PromptManagerInput`:

```ts
export interface PromptManagerVersionMetadata {
  promptVersion: string;
  componentVersions: Record<string, string>;
}
```

Then extend `PromptManager`:

```ts
export interface PromptManager {
  buildMessages(input: PromptManagerInput): AgentMessage[];
  getVersionMetadata?(): PromptManagerVersionMetadata;
}
```

Keep the existing comment for `buildMessages`; move it above `buildMessages` if needed.

- [x] **Step 4: Add default version constants**

In `api/src/modules/agent-loop/promptManager.ts`, above `const BASE_SYSTEM_PROMPT`, add:

```ts
export const DEFAULT_PROMPT_VERSION = "agent-loop-prompt-v1";

export const DEFAULT_PROMPT_COMPONENT_VERSIONS = {
  baseSystem: "base-system-v1",
  toolUseRules: "tool-use-rules-v1",
  gisRoutingRules: "gis-routing-rules-v2",
  disasterSatelliteRules: "disaster-satellite-rules-v1",
  contextPriorityRules: "context-priority-rules-v1",
  toolCatalogRenderer: "tool-catalog-renderer-v1",
  promptSectionRenderer: "prompt-section-renderer-v1",
} as const;
```

These names are intentionally semantic rather than hash-based. When a rule is edited intentionally, bump the matching component version.

- [x] **Step 5: Export tool metadata normalization**

In `api/src/modules/agent-loop/promptManager.ts`, export the same metadata normalization helper used by `renderToolCatalog`:

```ts
export type ToolMetadataValue = string | number | boolean | "dynamic";

export function metadataValue(value: unknown): ToolMetadataValue | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "function") return "dynamic";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return undefined;
}
```

Do not change the renderer semantics; this export exists so prompt-version metadata and model-visible prompt rendering stay in sync.

- [x] **Step 6: Implement default `getVersionMetadata()`**

In `defaultPromptManager`, add:

```ts
getVersionMetadata() {
  return {
    promptVersion: DEFAULT_PROMPT_VERSION,
    componentVersions: { ...DEFAULT_PROMPT_COMPONENT_VERSIONS },
  };
},
```

Place it before or after `buildMessages`; no behavior should change.

- [x] **Step 7: Run prompt-manager test**

Run:

```powershell
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-prompt-manager.mjs
```

Expected: PASS and prints:

```text
prompt manager test passed
```

---

## Task 2: Add Prompt Versioning Metadata Builder

**Files:**

- Create: `api/src/modules/agent-loop/promptVersioning.ts`
- Test: `api/tests/agent-loop/test-prompt-versioning.mjs`

- [x] **Step 1: Write the failing test**

Create `api/tests/agent-loop/test-prompt-versioning.mjs`:

```js
import assert from "node:assert/strict";
import { z } from "zod";

const {
  buildPromptVersionMetadata,
  hashStableJson,
} = await import("../../src/modules/agent-loop/promptVersioning.ts");
const {
  DEFAULT_PROMPT_COMPONENT_VERSIONS,
  DEFAULT_PROMPT_VERSION,
} = await import("../../src/modules/agent-loop/promptManager.ts");

function makeTool(name, description, extra = {}) {
  return {
    name,
    description,
    kind: "domain",
    inputSchema: z.object({}),
    async execute() {
      return {};
    },
    ...extra,
  };
}

const tools = [
  makeTool("RegionResolve", "Resolve named regions.", {
    aliases: ["region-resolve"],
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    maxResultSizeChars: 40000,
    requiresUserInteraction: false,
    riskLevel: "low",
  }),
  makeTool("RegionMark", "Mark GIS regions.", { aliases: ["region-mark"], maxResultSizeChars: 40000 }),
];

const metadata = buildPromptVersionMetadata({
  promptVersionMetadata: {
    promptVersion: DEFAULT_PROMPT_VERSION,
    componentVersions: DEFAULT_PROMPT_COMPONENT_VERSIONS,
  },
  tools,
  contextSections: [
    { id: "project.database_description", content: "Database catalog text." },
    { id: "transcript.resume_context", content: JSON.stringify({ stoppedBy: "final_answer" }) },
  ],
  runtimeSections: [],
  memorySections: [],
  skillSections: [{ id: "skill.listing", content: "Skill list" }],
  rawMessages: [
    { role: "system", content: "system prompt" },
    { role: "user", content: "query" },
  ],
  preparedMessages: [
    { role: "system", content: "system prompt" },
    { role: "user", content: "query" },
  ],
});

assert.equal(metadata.promptVersion, DEFAULT_PROMPT_VERSION);
assert.deepEqual(metadata.componentVersions, DEFAULT_PROMPT_COMPONENT_VERSIONS);
assert.equal(metadata.toolCatalog.count, 2);
assert.deepEqual(metadata.toolCatalog.names, ["RegionResolve", "RegionMark"]);
assert.match(metadata.toolCatalog.hash, /^sha256:[a-f0-9]{16}$/);
assert.equal(metadata.contextSections.count, 2);
assert.deepEqual(metadata.contextSections.ids, ["project.database_description", "transcript.resume_context"]);
assert.equal(metadata.runtimeSections.count, 0);
assert.equal(metadata.memorySections.count, 0);
assert.equal(metadata.skillSections.count, 1);
assert.deepEqual(metadata.skillSections.ids, ["skill.listing"]);
assert.equal(metadata.messages.rawCount, 2);
assert.equal(metadata.messages.preparedCount, 2);
assert.match(metadata.messages.rawHash, /^sha256:[a-f0-9]{16}$/);
assert.match(metadata.messages.preparedHash, /^sha256:[a-f0-9]{16}$/);

const changedToolMetadata = buildPromptVersionMetadata({
  promptVersionMetadata: {
    promptVersion: DEFAULT_PROMPT_VERSION,
    componentVersions: DEFAULT_PROMPT_COMPONENT_VERSIONS,
  },
  tools: [
    makeTool("RegionResolve", "Resolve named regions.", {
      aliases: ["region-resolve"],
      isReadOnly: () => true,
      isDestructive: () => false,
      isConcurrencySafe: () => true,
      maxResultSizeChars: 40000,
      requiresUserInteraction: true,
      riskLevel: "low",
    }),
    makeTool("RegionMark", "Mark GIS regions.", { aliases: ["region-mark"], maxResultSizeChars: 40000 }),
  ],
  contextSections: [
    { id: "project.database_description", content: "Database catalog text." },
    { id: "transcript.resume_context", content: JSON.stringify({ stoppedBy: "final_answer" }) },
  ],
  runtimeSections: [],
  memorySections: [],
  skillSections: [{ id: "skill.listing", content: "Skill list" }],
  rawMessages: [
    { role: "system", content: "system prompt" },
    { role: "user", content: "query" },
  ],
  preparedMessages: [
    { role: "system", content: "system prompt" },
    { role: "user", content: "query" },
  ],
});

assert.notEqual(changedToolMetadata.toolCatalog.hash, metadata.toolCatalog.hash);

const sameMetadata = buildPromptVersionMetadata({
  promptVersionMetadata: {
    promptVersion: DEFAULT_PROMPT_VERSION,
    componentVersions: DEFAULT_PROMPT_COMPONENT_VERSIONS,
  },
  tools,
  contextSections: [
    { id: "project.database_description", content: "Database catalog text." },
    { id: "transcript.resume_context", content: JSON.stringify({ stoppedBy: "final_answer" }) },
  ],
  runtimeSections: [],
  memorySections: [],
  skillSections: [{ id: "skill.listing", content: "Skill list" }],
  rawMessages: [
    { role: "system", content: "system prompt" },
    { role: "user", content: "query" },
  ],
  preparedMessages: [
    { role: "system", content: "system prompt" },
    { role: "user", content: "query" },
  ],
});

assert.deepEqual(sameMetadata, metadata);
assert.notEqual(
  hashStableJson({ a: 1, b: 2 }),
  hashStableJson({ a: 1, b: 3 })
);

const unknownPromptMetadata = buildPromptVersionMetadata({
  tools,
  contextSections: [],
  runtimeSections: [],
  memorySections: [],
  skillSections: [],
  rawMessages: [],
  preparedMessages: [],
});

assert.equal(unknownPromptMetadata.promptVersion, "custom-prompt-manager/unknown");
assert.deepEqual(unknownPromptMetadata.componentVersions, {});

console.log("prompt versioning test passed");
```

- [x] **Step 2: Run the test and verify it fails**

Run:

```powershell
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-prompt-versioning.mjs
```

Expected: FAIL because `promptVersioning.ts` does not exist.

- [x] **Step 3: Create `promptVersioning.ts`**

Create `api/src/modules/agent-loop/promptVersioning.ts`:

```ts
import { createHash } from "node:crypto";
import {
  metadataValue,
  type PromptManagerVersionMetadata,
} from "./promptManager.js";
import { stableStringify } from "./tools/_shared/serialization.js";
import type { AgentMessage, PromptSection, ToolDefinition } from "./tools/_shared/types.js";

const HASH_LENGTH = 16;
const MAX_SECTION_CONTENT_PREVIEW_CHARS = 240;
const MAX_TOOL_DESCRIPTION_PREVIEW_CHARS = 240;
const UNKNOWN_PROMPT_VERSION = "custom-prompt-manager/unknown";

// Bounded audit fingerprints keep transcript metadata compact. They are not
// complete content fingerprints; add separate full-content hashes only if a
// future workflow needs strong uniqueness.

export interface PromptVersionMetadata {
  promptVersion: string;
  componentVersions: Record<string, string>;
  toolCatalog: {
    count: number;
    names: string[];
    hash: string;
  };
  contextSections: PromptSectionSummary;
  runtimeSections: PromptSectionSummary;
  memorySections: PromptSectionSummary;
  skillSections: PromptSectionSummary;
  messages: {
    rawCount: number;
    preparedCount: number;
    rawHash: string;
    preparedHash: string;
  };
}

export interface PromptSectionSummary {
  count: number;
  ids: string[];
  hash: string;
}

export interface BuildPromptVersionMetadataInput {
  promptVersionMetadata?: PromptManagerVersionMetadata;
  tools: ToolDefinition[];
  contextSections: PromptSection[];
  runtimeSections: PromptSection[];
  memorySections: PromptSection[];
  skillSections: PromptSection[];
  rawMessages: AgentMessage[];
  preparedMessages: AgentMessage[];
}

export function buildPromptVersionMetadata(
  input: BuildPromptVersionMetadataInput
): PromptVersionMetadata {
  const prompt = input.promptVersionMetadata ?? {
    promptVersion: UNKNOWN_PROMPT_VERSION,
    componentVersions: {},
  };

  return {
    promptVersion: prompt.promptVersion,
    componentVersions: { ...prompt.componentVersions },
    toolCatalog: summarizeToolCatalog(input.tools),
    contextSections: summarizePromptSections(input.contextSections),
    runtimeSections: summarizePromptSections(input.runtimeSections),
    memorySections: summarizePromptSections(input.memorySections),
    skillSections: summarizePromptSections(input.skillSections),
    messages: {
      rawCount: input.rawMessages.length,
      preparedCount: input.preparedMessages.length,
      rawHash: hashStableJson(input.rawMessages.map(summarizeMessage)),
      preparedHash: hashStableJson(input.preparedMessages.map(summarizeMessage)),
    },
  };
}

export function hashStableJson(value: unknown): string {
  const hash = createHash("sha256")
    .update(stableStringify(value))
    .digest("hex")
    .slice(0, HASH_LENGTH);
  return `sha256:${hash}`;
}

function summarizeToolCatalog(tools: ToolDefinition[]): PromptVersionMetadata["toolCatalog"] {
  const summary = tools.map((tool) => {
    const description = typeof tool.description === "string" ? tool.description : "";
    return {
      name: tool.name,
      descriptionPreview: previewText(description, MAX_TOOL_DESCRIPTION_PREVIEW_CHARS),
      descriptionLength: description.length,
      kind: metadataValue(tool.kind),
      aliases: tool.aliases ?? [],
      readOnly: metadataValue(tool.isReadOnly),
      destructive: metadataValue(tool.isDestructive),
      concurrencySafe: metadataValue(tool.isConcurrencySafe),
      riskLevel: metadataValue(tool.riskLevel),
      requiresUserInteraction: metadataValue(tool.requiresUserInteraction),
      maxResultSizeChars: metadataValue(tool.maxResultSizeChars),
    };
  });

  return {
    count: tools.length,
    names: tools.map((tool) => tool.name),
    hash: hashStableJson(summary),
  };
}

function summarizePromptSections(sections: PromptSection[]): PromptSectionSummary {
  const contentOf = (section: PromptSection) =>
    typeof section.content === "string" ? section.content : "";
  const summary = sections.map((section) => ({
    id: section.id,
    contentPreview: previewText(contentOf(section), MAX_SECTION_CONTENT_PREVIEW_CHARS),
    contentLength: contentOf(section).length,
  }));

  return {
    count: sections.length,
    ids: sections.map((section) => section.id),
    hash: hashStableJson(summary),
  };
}

function summarizeMessage(message: AgentMessage): unknown {
  const content = typeof message.content === "string" ? message.content : "";
  return {
    role: message.role,
    contentPreview: previewText(content, 360),
    contentLength: content.length,
    toolCalls: message.toolCalls?.map((toolCall) => ({
      id: toolCall.id,
      toolName: toolCall.toolName,
    })),
    toolCallId: message.toolCallId,
    toolName: message.toolName,
  };
}

export function previewText(value: unknown, maxChars: number): string {
  const text = typeof value === "string" ? value : "";
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  if (maxChars < 3) return text.slice(0, maxChars);
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}
```

- [x] **Step 4: Run prompt-versioning test**

Run:

```powershell
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-prompt-versioning.mjs
```

Expected: PASS and prints:

```text
prompt versioning test passed
```

---

## Task 3: Attach Prompt Metadata To Model Request Transcript Entries

**Files:**

- Modify: `api/src/modules/agent-loop/runAgentLoop.ts`
- Test: `api/tests/agent-loop/test-agent-loop-prompt-versioning.mjs`

- [x] **Step 1: Write the failing integration test**

Create `api/tests/agent-loop/test-agent-loop-prompt-versioning.mjs`:

```js
import assert from "node:assert/strict";
import { z } from "zod";

const { runAgentLoop } = await import("../../src/modules/agent-loop/runAgentLoop.ts");
const { ToolRegistry } = await import("../../src/modules/agent-loop/tools/_shared/toolRegistry.ts");

const taskId = crypto.randomUUID();
const query = "Return a final answer without tools.";
const appendedEntries = [];

const transcriptStore = {
  async append(entry) {
    appendedEntries.push(entry);
  },
  async load() {
    return appendedEntries;
  },
};

const registry = new ToolRegistry();
registry.register({
  name: "DemoTool",
  description: "A demo tool visible to the prompt.",
  kind: "domain",
  inputSchema: z.object({}),
  async execute() {
    return {};
  },
});

const modelClient = {
  async decide() {
    return {
      type: "final_answer",
      content: "Done.",
    };
  },
};

const contextProvider = {
  async getUserContext() {
    return { currentDate: "2026-06-15" };
  },
  async getSystemContext() {
    return { workspaceRoot: "S:/Projects/projects_new" };
  },
  async getContextSections() {
    return [
      { id: "project.domain", content: "Domain context." },
      { id: "transcript.resume_context", content: "{}" },
    ];
  },
};

const result = await runAgentLoop({
  taskId,
  query,
  registry,
  modelClient,
  contextProvider,
  transcriptStore,
  fileLogger: false,
  maxTurns: 2,
});

assert.equal(result.stoppedBy, "final_answer");

const modelRequest = appendedEntries.find((entry) => entry.kind === "model_request");
assert(modelRequest);
assert(modelRequest.metadata);
assert(modelRequest.metadata.prompt);
assert.equal(modelRequest.metadata.prompt.promptVersion, "agent-loop-prompt-v1");
assert.equal(modelRequest.metadata.prompt.toolCatalog.count, 2);
assert.deepEqual(modelRequest.metadata.prompt.toolCatalog.names, ["DemoTool", "Skill"]);
assert.deepEqual(modelRequest.metadata.prompt.contextSections.ids, [
  "project.domain",
  "transcript.resume_context",
]);
assert.equal(modelRequest.metadata.prompt.messages.rawCount, 2);
assert.equal(modelRequest.metadata.prompt.messages.preparedCount, 2);
assert.match(modelRequest.metadata.prompt.messages.rawHash, /^sha256:[a-f0-9]{16}$/);
assert.match(modelRequest.metadata.prompt.messages.preparedHash, /^sha256:[a-f0-9]{16}$/);

console.log("agent loop prompt versioning test passed");
```

Note: `Skill` is expected because `runAgentLoop` registers the skill tool into the registry before model requests.

- [x] **Step 2: Run the test and verify it fails**

Run:

```powershell
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-agent-loop-prompt-versioning.mjs
```

Expected: FAIL because `model_request.metadata.prompt` is missing.

- [x] **Step 3: Import metadata builder in `runAgentLoop.ts`**

In `api/src/modules/agent-loop/runAgentLoop.ts`, add:

```ts
import { buildPromptVersionMetadata } from "./promptVersioning.js";
```

- [x] **Step 4: Keep prompt input materials in variables**

Replace the current raw message construction:

```ts
const rawMessages = promptManager.buildMessages({
  query: options.query,
  tools: activeTools,
  userContext,
  systemContext,
  contextSections,
  runtimeSections,
  memorySections,
  skillSections,
  observations,
}).concat(conversationMessages);
```

with:

```ts
const promptInput = {
  query: options.query,
  tools: activeTools,
  userContext,
  systemContext,
  contextSections,
  runtimeSections,
  memorySections,
  skillSections,
  observations,
};
const rawMessages = promptManager.buildMessages(promptInput).concat(conversationMessages);
```

- [x] **Step 5: Build metadata after context-window preparation**

After:

```ts
const messages = prepared.messages;
```

add:

```ts
const promptMetadata = buildPromptVersionMetadata({
  promptVersionMetadata: promptManager.getVersionMetadata?.(),
  tools: activeTools,
  contextSections,
  runtimeSections,
  memorySections,
  skillSections,
  rawMessages,
  preparedMessages: messages,
});
```

- [x] **Step 6: Attach metadata to `model_request` transcript entry**

Change:

```ts
await appendTranscript({
  turn,
  kind: "model_request",
  messages,
});
```

to:

```ts
await appendTranscript({
  turn,
  kind: "model_request",
  messages,
  metadata: {
    prompt: promptMetadata,
  },
});
```

Do not add metadata to `assistant_message`, `tool_message`, or `loop_stop` in this task.

- [x] **Step 7: Run prompt versioning integration test**

Run:

```powershell
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-agent-loop-prompt-versioning.mjs
```

Expected: PASS and prints:

```text
agent loop prompt versioning test passed
```

---

## Task 4: Verify DB Transcript Store Persists Prompt Metadata

**Files:**

- Modify: `api/tests/agent-loop/test-agent-loop-transcript-integration.mjs`

- [x] **Step 1: Add DB metadata assertions**

In `api/tests/agent-loop/test-agent-loop-transcript-integration.mjs`, after:

```js
const firstRequest = entries[0];
assert(Array.isArray(firstRequest.messages));
assert(firstRequest.messages.some((message) => message.role === "user" && message.content === query));
```

add:

```js
assert(firstRequest.metadata);
assert(firstRequest.metadata.prompt);
assert.equal(firstRequest.metadata.prompt.promptVersion, "agent-loop-prompt-v1");
assert.equal(firstRequest.metadata.prompt.toolCatalog.count, 2);
assert.deepEqual(firstRequest.metadata.prompt.toolCatalog.names, ["DemoLookup", "Skill"]);
assert.match(firstRequest.metadata.prompt.toolCatalog.hash, /^sha256:[a-f0-9]{16}$/);
assert.match(firstRequest.metadata.prompt.messages.preparedHash, /^sha256:[a-f0-9]{16}$/);
```

- [x] **Step 2: Run DB integration test**

Make sure Postgres is available, then run:

```powershell
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-agent-loop-transcript-integration.mjs
```

Expected: PASS and prints:

```text
agent loop transcript integration test passed
```

If Postgres is unavailable, record the blocker and run the non-DB integration test from Task 3 instead.

---

## Task 5: Regression Tests And Documentation

**Files:**

- Modify: `api/plan/agent-loop-migration-roadmap.md`
- Verify: existing tests

- [x] **Step 1: Update roadmap status**

In `api/plan/agent-loop-migration-roadmap.md`, update the Prompt Versioning section after implementation:

```md
### P0. Prompt Versioning

已完成 MVP。

完成内容：

- `PromptManager` 暴露 stable prompt/component versions。
- 每个 `model_request` transcript entry 记录 `metadata.prompt`。
- metadata 包含 prompt version、component versions、tool catalog hash、context/runtime/memory/skill section hash、raw/prepared message hash。
- 不改变 model-visible prompt，不新增 DB schema。
```

Keep Memory as the next planned stage after this is complete.

- [x] **Step 2: Run prompt/versioning tests**

Run from `api/`:

```powershell
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-prompt-manager.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-prompt-versioning.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-agent-loop-prompt-versioning.mjs
```

Expected:

```text
prompt manager test passed
prompt versioning test passed
agent loop prompt versioning test passed
```

- [x] **Step 3: Run transcript/context regressions**

Run:

```powershell
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-transcript-store.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-transcript-read-model.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-context-provider-transcript-context.mjs
```

Expected:

```text
transcript store test passed
transcript read model test passed
context provider transcript context test passed
```

- [x] **Step 4: Run backend typecheck**

Run:

```powershell
..\node_modules\.bin\tsc.CMD -p tsconfig.json --noEmit --pretty false
```

Expected: no TypeScript errors.

- [x] **Step 5: Optional GIS smoke**

When Postgres is running and you want a runtime verification:

```powershell
..\node_modules\.bin\tsx.CMD scripts\agent-loop\agent-loop-smoke.ts --scenario gis-toolchain
```

Expected:

```text
[gis-smoke] validation passed
[gis-smoke] raw tools: RegionResolve -> RegionMark -> WeatherFetch
```

After smoke, a separate DB check can confirm `agent_transcript_entries.metadata` contains `prompt.promptVersion` for recent `model_request` rows.

---

## Acceptance Checklist

- [x] `PromptManager` exposes stable prompt/component version metadata.
- [x] Default prompt rendering is unchanged except for exported metadata.
- [x] `promptVersioning.ts` produces deterministic hashes for the same prompt inputs.
- [x] Prompt metadata hashes are documented as bounded audit fingerprints, not full-content fingerprints.
- [x] Tool catalog hash covers every model-visible metadata line rendered by `PromptManager`.
- [x] `model_request` transcript entries include `metadata.prompt`.
- [x] Metadata includes prompt version, component versions, tool catalog summary/hash, section summaries/hashes, and raw/prepared message hashes.
- [x] DB transcript store persists and reloads prompt metadata without schema changes.
- [x] Custom prompt managers without `getVersionMetadata()` are tested and use `custom-prompt-manager/unknown`.
- [x] Existing transcript and context-provider tests still pass.
- [x] Backend typecheck passes.

## Why This Comes Before Memory

Memory changes model behavior. Without prompt version metadata, future debugging cannot reliably answer whether a changed response came from:

- a different base system prompt,
- a changed GIS/disaster routing rule,
- a changed tool catalog,
- a changed context section set,
- or an injected memory.

This MVP gives every model request an audit fingerprint before memory starts affecting the prompt.
