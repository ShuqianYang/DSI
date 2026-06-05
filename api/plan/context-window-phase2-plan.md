# Context Window Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve `ContextWindowManager` with deterministic token-ish budgeting, priority-based message retention, tool-result metadata, richer diagnostics, and future compact extension points without calling an LLM.

**Architecture:** Keep `ContextWindowManager` as the final pre-model message governor. Phase 2 keeps deterministic behavior only: estimate, classify, truncate, group, remove, and report. It introduces typed diagnostics and candidate metadata so a future Claude Code-style compactor can be added after durable transcript/resume exists.

**Tech Stack:** TypeScript 5, Node built-ins, existing `AgentMessage` / `PreparedModelMessages` types, script tests via local `tsx`, backend typecheck via local `tsc`.

---

## Scope

This phase improves window governance only. It must not fetch project context, call models, read transcript history, or implement summary compact.

In scope:

- Add estimate metadata for both `json-chars` and approximate tokens.
- Add priority-aware message grouping.
- Preserve system message, latest user request, and assistant/tool adjacency.
- Trim tool messages with metadata-bearing previews.
- Return structured `context_window.diagnostics`.
- Add a future compaction candidate section.

Out of scope:

- LLM summary compaction.
- Durable transcript-based resume.
- Database storage for oversized tool results.
- PromptManager section ordering changes.

## File Structure

- Modify: `api/src/modules/agent-loop/contextWindowManager.ts`
  - Add exported diagnostic/candidate types.
  - Replace ad hoc trimming helpers with priority-aware groups.
  - Add approximate token estimate and per-tool budgets.
  - Add richer diagnostics.

- Modify: `api/tests/test-context-window-manager.mjs`
  - Keep existing Phase 1 tests.
  - Add tests for token-ish estimates, priority preservation, tool metadata, orphan tool removal, compaction candidates, and configurable budgets.

- Modify: `api/src/todo.md`
  - Mark Context Window Phase 2 deterministic improvements as implemented.
  - Keep compact/reinjection explicitly deferred.

- Optional modify: `docs/agents/tool-registration.md`
  - Add one short note that tool results may be preview-truncated but must keep enough metadata for later retrieval/persistence work.

## Design Notes

Budgeting remains approximate. Diagnostics must be explicit:

```json
{
  "estimateMethods": ["json-chars", "approx-tokens"],
  "approxTokenMethod": "latin chars/4, Han/Hiragana/Katakana/Hangul chars*1.8, other non-latin chars*1, json overhead included"
}
```

`effectiveBudgetChars` is the actual deterministic budget. Approximate token budget fields are diagnostics only and must be named honestly: use `effectiveBudgetApproxTokensLatinBaseline`, not `effectiveBudgetApproxTokens`, because the conversion uses Latin `x` characters and is not an upper bound for CJK-heavy messages.

Retention priority:

1. `system` group.
2. Latest `user` group.
3. Assistant/tool groups required for adjacency if retained.
4. Recent user/assistant conversation groups.
5. Older tool-heavy groups.
6. Older plain prose groups.

Tool result budgets:

```ts
const DEFAULT_TOOL_BUDGETS = {
  Bash: 12_000,
  Read: 18_000,
  Grep: 14_000,
  Glob: 10_000,
  WebSearch: 16_000,
  WebFetch: 18_000,
  default: 16_000,
};
```

Tool truncation metadata should be model-visible inside the tool message content. Keep it simple and parseable:

```text
[ContextWindowManager truncated tool result]
toolName=Read
originalChars=50000
keptChars=18000
omittedChars=32000
```

---

## Task 1: Add Phase 2 Regression Tests

**Files:**
- Modify: `api/tests/test-context-window-manager.mjs`

- [x] **Step 1: Add imports and a helper to create tool context**

At the top of `api/tests/test-context-window-manager.mjs`, keep existing imports and add this helper below them:

```js
function makeToolUseContext(taskId, query, messages) {
  return {
    taskId,
    query,
    messages,
    observations: [],
    options: { tools: [] },
    readFileState: new Map(),
    nestedMemoryAttachmentTriggers: new Set(),
    dynamicSkillDirTriggers: new Set(),
    discoveredSkillNames: new Set(),
  };
}
```

Then replace each inline `toolUseContext` object in the existing tests with:

```js
toolUseContext: makeToolUseContext("task-window", "latest user question", messages)
```

and:

```js
toolUseContext: makeToolUseContext("task-window-adjacency", "new question", adjacencyMessages)
```

- [x] **Step 2: Add a priority preservation test**

Append this test case before the final `console.log`:

```js
process.env.AGENT_CONTEXT_WINDOW_CHARS = "24000";
process.env.AGENT_CONTEXT_SUMMARY_RESERVE_CHARS = "1000";
try {
  const priorityMessages = [
    { role: "system", content: "system rules ".repeat(500) },
    { role: "user", content: "old user ".repeat(2000) },
    { role: "assistant", content: "old assistant ".repeat(2000) },
    {
      role: "assistant",
      content: "old tool call",
      toolCalls: [{ id: "old-tool", toolName: "WebFetch", input: { url: "https://example.com" } }],
    },
    { role: "tool", toolCallId: "old-tool", toolName: "WebFetch", content: "old web ".repeat(10000) },
    { role: "user", content: "latest important request" },
  ];

  const priorityResult = await defaultContextWindowManager.prepareMessages({
    messages: priorityMessages,
    toolUseContext: makeToolUseContext("task-window-priority", "latest important request", priorityMessages),
  });

  assert.equal(priorityResult.messages[0].role, "system");
  assert.equal(priorityResult.messages.at(-1).role, "user");
  assert.equal(priorityResult.messages.at(-1).content, "latest important request");
  assert.equal(priorityResult.messages.some((message) => message.toolCallId === "old-tool" && message.role === "tool"), false);
} finally {
  delete process.env.AGENT_CONTEXT_WINDOW_CHARS;
  delete process.env.AGENT_CONTEXT_SUMMARY_RESERVE_CHARS;
}
```

- [x] **Step 3: Add a tool truncation metadata test**

Append this test case:

```js
const metadataMessages = [
  { role: "system", content: "system" },
  {
    role: "assistant",
    content: "read file",
    toolCalls: [{ id: "read-large", toolName: "Read", input: { file_path: "large.txt" } }],
  },
  { role: "tool", toolCallId: "read-large", toolName: "Read", content: "R".repeat(50_000) },
  { role: "user", content: "what matters?" },
];

const metadataResult = await defaultContextWindowManager.prepareMessages({
  messages: metadataMessages,
  toolUseContext: makeToolUseContext("task-window-metadata", "what matters?", metadataMessages),
});

const metadataTool = metadataResult.messages.find((message) => message.toolCallId === "read-large");
assert.ok(metadataTool.content.includes("[ContextWindowManager truncated tool result]"));
assert.ok(metadataTool.content.includes("toolName=Read"));
assert.ok(metadataTool.content.includes("originalChars=50000"));
assert.ok(metadataTool.content.includes("omittedChars="));
```

- [x] **Step 4: Add an orphan tool removal test**

Append this test case:

```js
const orphanMessages = [
  { role: "system", content: "system" },
  { role: "tool", toolCallId: "orphan", toolName: "Read", content: "orphan result" },
  { role: "user", content: "latest" },
];

const orphanResult = await defaultContextWindowManager.prepareMessages({
  messages: orphanMessages,
  toolUseContext: makeToolUseContext("task-window-orphan", "latest", orphanMessages),
});

assert.equal(orphanResult.messages.some((message) => message.role === "tool" && message.toolCallId === "orphan"), false);
assert.equal(orphanResult.messages.at(-1).content, "latest");
```

- [x] **Step 5: Add diagnostics and compaction candidate assertions**

Append this test case:

```js
const diagnosticMessages = [
  { role: "system", content: "system" },
  { role: "user", content: "old ".repeat(2000) },
  { role: "assistant", content: "answer ".repeat(2000) },
  { role: "user", content: "latest" },
];

const diagnosticResult = await defaultContextWindowManager.prepareMessages({
  messages: diagnosticMessages,
  toolUseContext: makeToolUseContext("task-window-diagnostics", "latest", diagnosticMessages),
});

const diagnosticSection = diagnosticResult.contextSections.find((section) => section.id === "context_window.diagnostics");
assert.ok(diagnosticSection);
const phase2Diagnostics = JSON.parse(diagnosticSection.content);
assert.deepEqual(phase2Diagnostics.estimateMethods, ["json-chars", "approx-tokens"]);
assert.equal(typeof phase2Diagnostics.originalApproxTokens, "number");
assert.equal(typeof phase2Diagnostics.preparedApproxTokens, "number");
assert.equal(typeof phase2Diagnostics.effectiveBudgetApproxTokensLatinBaseline, "number");
assert.equal(typeof phase2Diagnostics.overBudgetAfterTrim, "boolean");
assert.ok(Array.isArray(phase2Diagnostics.removedGroups));
assert.ok(Array.isArray(phase2Diagnostics.trimmedMessages));

const candidateSection = diagnosticResult.contextSections.find((section) => section.id === "context_window.compaction_candidates");
assert.ok(candidateSection);
const candidates = JSON.parse(candidateSection.content);
assert.ok(Array.isArray(candidates));
```

- [x] **Step 6: Run the test and verify it fails**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-context-window-manager.mjs
```

Expected: FAIL because current diagnostics do not include `estimateMethods`, `originalApproxTokens`, tool truncation metadata, orphan tool removal, or compaction candidates.

## Task 2: Add Typed Diagnostics And Estimates

**Files:**
- Modify: `api/src/modules/agent-loop/contextWindowManager.ts`

- [x] **Step 1: Add exported Phase 2 types**

Add these types after the `ContextWindowManager` interface:

```ts
type MessageRole = AgentMessage["role"];

type ContextWindowGroupKind =
  | "system"
  | "latest_user"
  | "user_turn"
  | "assistant_tool_group"
  | "assistant"
  | "tool_orphan";

interface ContextWindowMessageGroup {
  id: string;
  kind: ContextWindowGroupKind;
  messages: AgentMessage[];
  startIndex: number;
  priority: number;
  removable: boolean;
  reason: string;
  chars: number;
  approxTokens: number;
}

export interface ContextWindowTrimmedMessage {
  role: MessageRole;
  toolName?: string;
  toolCallId?: string;
  originalChars: number;
  keptChars: number;
  omittedChars: number;
}

export interface ContextWindowRemovedGroup {
  id: string;
  kind: ContextWindowGroupKind;
  reason: string;
  messageCount: number;
  chars: number;
  approxTokens: number;
}

export interface ContextCompactionCandidate {
  id: string;
  kind: ContextWindowGroupKind;
  reason: string;
  messageCount: number;
  chars: number;
  approxTokens: number;
}

export interface ContextWindowDiagnostics {
  estimateMethods: ["json-chars", "approx-tokens"];
  approxTokenMethod: string;
  originalChars: number;
  preparedChars: number;
  originalApproxTokens: number;
  preparedApproxTokens: number;
  effectiveBudgetChars: number;
  effectiveBudgetApproxTokensLatinBaseline: number;
  overBudgetAfterTrim: boolean;
  removedMessages: number;
  removedTurns: number;
  removedGroups: ContextWindowRemovedGroup[];
  trimmedMessages: ContextWindowTrimmedMessage[];
  preservedGroups: Array<{
    id: string;
    kind: ContextWindowGroupKind;
    messageCount: number;
    chars: number;
    approxTokens: number;
  }>;
}
```

- [x] **Step 2: Add approximate token estimation helpers**

Replace the existing `estimateMessagesChars` helper with these helpers:

```ts
function estimateMessagesChars(messages: AgentMessage[]): number {
  return JSON.stringify(messages).length;
}

function estimateTextApproxTokens(text: string): number {
  let latinChars = 0;
  let denseUnicodeChars = 0;
  let otherChars = 0;
  for (const char of text) {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char)) {
      denseUnicodeChars += 1;
    } else if (/[\x00-\x7f]/u.test(char)) {
      latinChars += 1;
    } else {
      otherChars += 1;
    }
  }
  return Math.ceil(latinChars / 4 + denseUnicodeChars * 1.8 + otherChars);
}

function estimateMessagesApproxTokens(messages: AgentMessage[]): number {
  return estimateTextApproxTokens(JSON.stringify(messages));
}
```

- [x] **Step 3: Add dynamic budget readers**

Replace the existing top-level environment-parsed constants with fallback constants:

```ts
const FALLBACK_CONTEXT_WINDOW_CHARS = 120_000;
const FALLBACK_SUMMARY_RESERVE_CHARS = 12_000;
const FALLBACK_TOOL_MESSAGE_MAX_CHARS = 16_000;
const MIN_MESSAGES_TO_KEEP = 2;
```

Add these helpers:

```ts
function getContextWindowChars(): number {
  return parsePositiveIntegerEnv(process.env.AGENT_CONTEXT_WINDOW_CHARS, FALLBACK_CONTEXT_WINDOW_CHARS);
}

function getSummaryReserveChars(): number {
  return parsePositiveIntegerEnv(process.env.AGENT_CONTEXT_SUMMARY_RESERVE_CHARS, FALLBACK_SUMMARY_RESERVE_CHARS);
}

function getDefaultToolMessageMaxChars(): number {
  return parsePositiveIntegerEnv(process.env.AGENT_TOOL_MESSAGE_MAX_CHARS, FALLBACK_TOOL_MESSAGE_MAX_CHARS);
}
```

This allows tests to set env vars after importing the module.

- [x] **Step 4: Run typecheck and fix local type issues only**

Run from `api/`:

```powershell
.\node_modules\.bin\tsc.CMD
```

Expected: PASS. If TypeScript reports unused types, keep the types and wire them in Task 3 instead of deleting them.

## Task 3: Implement Tool Budgets And Metadata Truncation

**Files:**
- Modify: `api/src/modules/agent-loop/contextWindowManager.ts`

- [x] **Step 1: Add per-tool budget helpers**

Add below the fallback constants:

```ts
const DEFAULT_TOOL_BUDGETS: Record<string, number> = {
  Bash: 12_000,
  Read: 18_000,
  Grep: 14_000,
  Glob: 10_000,
  WebSearch: 16_000,
  WebFetch: 18_000,
  default: 16_000,
};

function getToolMessageMaxChars(message: AgentMessage): number {
  if (message.role !== "tool") return Number.POSITIVE_INFINITY;
  const envKey = message.toolName
    ? `AGENT_TOOL_${message.toolName.toUpperCase()}_MAX_CHARS`
    : undefined;
  if (envKey) {
    return parsePositiveIntegerEnv(process.env[envKey], DEFAULT_TOOL_BUDGETS[message.toolName ?? "default"] ?? getDefaultToolMessageMaxChars());
  }
  return DEFAULT_TOOL_BUDGETS[message.toolName ?? "default"] ?? getDefaultToolMessageMaxChars();
}
```

- [x] **Step 2: Replace `truncateMessageContent` with metadata-aware truncation**

Replace the existing `truncateMessageContent` function with:

```ts
function truncateMessageContent(
  message: AgentMessage,
  maxChars: number,
): { message: AgentMessage; trimmed?: ContextWindowTrimmedMessage } {
  if (message.content.length <= maxChars) return { message };

  const headerLines =
    message.role === "tool"
      ? [
          "[ContextWindowManager truncated tool result]",
          `toolName=${message.toolName ?? "unknown"}`,
          `toolCallId=${message.toolCallId ?? "unknown"}`,
          `originalChars=${message.content.length}`,
          `keptChars=${maxChars}`,
          `omittedChars=${message.content.length - maxChars}`,
          "",
        ]
      : [
          "[ContextWindowManager truncated message]",
          `role=${message.role}`,
          `originalChars=${message.content.length}`,
          `keptChars=${maxChars}`,
          `omittedChars=${message.content.length - maxChars}`,
          "",
        ];

  const nextMessage = {
    ...message,
    content: `${message.content.slice(0, maxChars)}\n\n${headerLines.join("\n")}`,
  };

  return {
    message: nextMessage,
    trimmed: {
      role: message.role,
      toolName: message.toolName,
      toolCallId: message.toolCallId,
      originalChars: message.content.length,
      keptChars: maxChars,
      omittedChars: message.content.length - maxChars,
    },
  };
}
```

- [x] **Step 3: Add `truncateToolMessages`**

Add:

```ts
function truncateToolMessages(messages: AgentMessage[]): {
  messages: AgentMessage[];
  trimmedMessages: ContextWindowTrimmedMessage[];
} {
  const trimmedMessages: ContextWindowTrimmedMessage[] = [];
  const nextMessages = messages.map((message) => {
    if (message.role !== "tool") return message;
    const result = truncateMessageContent(message, getToolMessageMaxChars(message));
    if (result.trimmed) trimmedMessages.push(result.trimmed);
    return result.message;
  });
  return { messages: nextMessages, trimmedMessages };
}
```

- [x] **Step 4: Update `defaultContextWindowManager.prepareMessages` to use `truncateToolMessages`**

Replace the body with:

```ts
async prepareMessages(input) {
  const effectiveBudget = Math.max(
    20_000,
    getContextWindowChars() - getSummaryReserveChars(),
  );
  const toolTrim = truncateToolMessages(input.messages);
  const trimResult = trimToBudgetPreservingToolGroups(toolTrim.messages, effectiveBudget);
  const diagnostics = buildContextWindowDiagnostics({
    originalMessages: input.messages,
    preparedMessages: trimResult.messages,
    effectiveBudget,
    removedGroups: trimResult.removedGroups,
    trimmedMessages: [...toolTrim.trimmedMessages, ...trimResult.trimmedMessages],
  });
  return {
    messages: trimResult.messages,
    contextSections: [
      {
        id: "context_window.diagnostics",
        content: JSON.stringify(diagnostics),
      },
      {
        id: "context_window.compaction_candidates",
        content: JSON.stringify(buildCompactionCandidates(trimResult.preservedGroups)),
      },
    ],
  };
}
```

This step will not compile until Task 4 adds the new `trimToBudgetPreservingToolGroups` return shape and `buildCompactionCandidates`.

## Task 4: Implement Priority-Aware Grouping

**Files:**
- Modify: `api/src/modules/agent-loop/contextWindowManager.ts`

- [x] **Step 1: Replace `trimToBudgetPreservingToolGroups` return shape**

Replace the function with:

```ts
function trimToBudgetPreservingToolGroups(messages: AgentMessage[], budgetChars: number): {
  messages: AgentMessage[];
  removedGroups: ContextWindowRemovedGroup[];
  trimmedMessages: ContextWindowTrimmedMessage[];
  preservedGroups: ContextWindowMessageGroup[];
} {
  const groups = groupMessages(messages);
  const removedGroups: ContextWindowRemovedGroup[] = [];
  const trimmedMessages: ContextWindowTrimmedMessage[] = [];

  for (let index = groups.length - 1; index >= 0; index -= 1) {
    if (groups[index]?.kind === "tool_orphan") {
      const [removed] = groups.splice(index, 1);
      removedGroups.push(toRemovedGroup(removed, "orphan tool result removed"));
    }
  }

  while (groups.length > MIN_MESSAGES_TO_KEEP && estimateMessagesChars(groups.flatMap((group) => group.messages)) > budgetChars) {
    const removableIndex = chooseGroupToRemove(groups);
    if (removableIndex === -1) break;
    const [removed] = groups.splice(removableIndex, 1);
    removedGroups.push(toRemovedGroup(removed, removed.reason));
  }

  let preparedMessages = groups.flatMap((group) => group.messages);
  if (estimateMessagesChars(preparedMessages) > budgetChars) {
    const singleTrim = trimSingleLargeMessages(preparedMessages, budgetChars);
    preparedMessages = singleTrim.messages;
    trimmedMessages.push(...singleTrim.trimmedMessages);
  }

  return {
    messages: preparedMessages,
    removedGroups,
    trimmedMessages,
    preservedGroups: groupMessages(preparedMessages),
  };
}
```

- [x] **Step 2: Replace `groupMessages` with priority-aware grouping**

Replace `groupMessages` with:

```ts
function groupMessages(messages: AgentMessage[]): ContextWindowMessageGroup[] {
  const latestUserIndex = findLatestUserIndex(messages);
  const groups: ContextWindowMessageGroup[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "assistant" && message.toolCalls?.length) {
      const toolCallIds = new Set(message.toolCalls.map((toolCall) => toolCall.id));
      const groupMessagesForCall = [message];
      let cursor = index + 1;
      while (cursor < messages.length && messages[cursor].role === "tool") {
        const toolMessage = messages[cursor];
        if (!toolMessage.toolCallId || !toolCallIds.has(toolMessage.toolCallId)) break;
        groupMessagesForCall.push(toolMessage);
        cursor += 1;
      }
      groups.push(buildGroup({
        messages: groupMessagesForCall,
        startIndex: index,
        kind: "assistant_tool_group",
        priority: 60 + Math.min(index, 20),
        removable: index !== 0 && index < messages.length - 1,
        reason: "older assistant/tool group",
      }));
      index = cursor - 1;
      continue;
    }

    if (message.role === "tool") {
      groups.push(buildGroup({
        messages: [message],
        startIndex: index,
        kind: "tool_orphan",
        priority: 5,
        removable: true,
        reason: "orphan tool result",
      }));
      continue;
    }

    if (message.role === "system") {
      groups.push(buildGroup({
        messages: [message],
        startIndex: index,
        kind: "system",
        priority: 1000,
        removable: false,
        reason: "system message must be preserved",
      }));
      continue;
    }

    if (message.role === "user" && index === latestUserIndex) {
      groups.push(buildGroup({
        messages: [message],
        startIndex: index,
        kind: "latest_user",
        priority: 1000,
        removable: false,
        reason: "latest user request must be preserved",
      }));
      continue;
    }

    groups.push(buildGroup({
      messages: [message],
      startIndex: index,
      kind: message.role === "user" ? "user_turn" : "assistant",
      priority: 50 + Math.min(index, 20),
      removable: index > 0 && index < messages.length - 1,
      reason: "older conversation group",
    }));
  }

  return groups;
}
```

- [x] **Step 3: Add group helper functions**

Add:

```ts
function buildGroup(input: {
  messages: AgentMessage[];
  startIndex: number;
  kind: ContextWindowGroupKind;
  priority: number;
  removable: boolean;
  reason: string;
}): ContextWindowMessageGroup {
  return {
    id: `${input.kind}:${input.startIndex}`,
    kind: input.kind,
    messages: input.messages,
    startIndex: input.startIndex,
    priority: input.priority,
    removable: input.removable,
    reason: input.reason,
    chars: estimateMessagesChars(input.messages),
    approxTokens: estimateMessagesApproxTokens(input.messages),
  };
}

function findLatestUserIndex(messages: AgentMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

function toRemovedGroup(group: ContextWindowMessageGroup, reason: string): ContextWindowRemovedGroup {
  return {
    id: group.id,
    kind: group.kind,
    reason,
    messageCount: group.messages.length,
    chars: group.chars,
    approxTokens: group.approxTokens,
  };
}
```

- [x] **Step 4: Replace `chooseGroupToRemove`**

Replace `chooseGroupToRemove` with:

```ts
function chooseGroupToRemove(groups: ContextWindowMessageGroup[]): number {
  const candidates = groups.filter((group) => group.removable);
  if (candidates.length === 0) return -1;

  const [selected] = candidates.sort((left, right) => {
    const priorityDelta = left.priority - right.priority;
    if (priorityDelta !== 0) return priorityDelta;
    const charsDelta = right.chars - left.chars;
    if (charsDelta !== 0) return charsDelta;
    return left.startIndex - right.startIndex;
  });

  return groups.findIndex((group) => group.id === selected.id);
}
```

- [x] **Step 5: Replace `trimSingleLargeMessages`**

Replace `trimSingleLargeMessages` with:

```ts
function trimSingleLargeMessages(messages: AgentMessage[], budgetChars: number): {
  messages: AgentMessage[];
  trimmedMessages: ContextWindowTrimmedMessage[];
} {
  const trimmedMessages: ContextWindowTrimmedMessage[] = [];
  let next = [...messages];
  if (estimateMessagesChars(next) <= budgetChars) return { messages: next, trimmedMessages };

  const nonToolBudget = Math.max(2_000, Math.floor(budgetChars / Math.max(next.length, 1)));
  next = next.map((message) => {
    if (message.role === "tool") return message;
    if (message.role === "system" || message.role === "user") return message;
    const result = truncateMessageContent(message, nonToolBudget);
    if (result.trimmed) trimmedMessages.push(result.trimmed);
    return result.message;
  });

  return { messages: next, trimmedMessages };
}
```

This function deliberately does not truncate `system` or `user` messages. If protected messages alone exceed `budgetChars`, the final payload may remain over budget; `ContextWindowDiagnostics.overBudgetAfterTrim` must report that condition instead of hiding it.

- [x] **Step 6: Run context-window test and typecheck**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-context-window-manager.mjs
.\node_modules\.bin\tsc.CMD
```

Expected after Task 4: `tsc.CMD` passes. The context-window regression script should advance past priority/orphan assertions and fail at Task 5 diagnostics/candidate assertions until Task 5 is implemented.

## Task 5: Build Rich Diagnostics And Compaction Candidates

**Files:**
- Modify: `api/src/modules/agent-loop/contextWindowManager.ts`

- [x] **Step 1: Replace `buildContextWindowDiagnostics`**

Replace the function with:

```ts
function buildContextWindowDiagnostics(input: {
  originalMessages: AgentMessage[];
  preparedMessages: AgentMessage[];
  effectiveBudget: number;
  removedGroups: ContextWindowRemovedGroup[];
  trimmedMessages: ContextWindowTrimmedMessage[];
}): ContextWindowDiagnostics {
  const preservedGroups = groupMessages(input.preparedMessages).map((group) => ({
    id: group.id,
    kind: group.kind,
    messageCount: group.messages.length,
    chars: group.chars,
    approxTokens: group.approxTokens,
  }));

  return {
    estimateMethods: ["json-chars", "approx-tokens"],
    approxTokenMethod: "latin chars/4, Han/Hiragana/Katakana/Hangul chars*1.8, other non-latin chars*1, json overhead included",
    originalChars: estimateMessagesChars(input.originalMessages),
    preparedChars: estimateMessagesChars(input.preparedMessages),
    originalApproxTokens: estimateMessagesApproxTokens(input.originalMessages),
    preparedApproxTokens: estimateMessagesApproxTokens(input.preparedMessages),
    effectiveBudgetChars: input.effectiveBudget,
    effectiveBudgetApproxTokensLatinBaseline: estimateTextApproxTokens("x".repeat(input.effectiveBudget)),
    overBudgetAfterTrim: estimateMessagesChars(input.preparedMessages) > input.effectiveBudget,
    removedMessages: input.originalMessages.length - input.preparedMessages.length,
    removedTurns: countUserMessages(input.originalMessages) - countUserMessages(input.preparedMessages),
    removedGroups: input.removedGroups,
    trimmedMessages: input.trimmedMessages,
    preservedGroups,
  };
}
```

- [x] **Step 2: Add `buildCompactionCandidates`**

Add:

```ts
function buildCompactionCandidates(groups: ContextWindowMessageGroup[]): ContextCompactionCandidate[] {
  return groups
    .filter((group) => group.removable && group.kind !== "latest_user" && group.kind !== "system")
    .sort((left, right) => right.chars - left.chars)
    .slice(0, 8)
    .map((group) => ({
      id: group.id,
      kind: group.kind,
      reason: group.reason,
      messageCount: group.messages.length,
      chars: group.chars,
      approxTokens: group.approxTokens,
    }));
}
```

- [x] **Step 3: Keep backward compatibility in diagnostics tests**

Update the existing assertion in `api/tests/test-context-window-manager.mjs` that reads:

```js
assert.equal(diagnostics.estimateMethod, "json-chars");
```

to:

```js
assert.deepEqual(diagnostics.estimateMethods, ["json-chars", "approx-tokens"]);
```

Keep:

```js
assert.equal(typeof diagnostics.removedTurns, "number");
```

- [x] **Step 4: Run tests**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-context-window-manager.mjs
```

Expected: PASS.

## Task 6: Add Budget Configuration Regression Tests

**Files:**
- Modify: `api/tests/test-context-window-manager.mjs`

- [x] **Step 1: Add env-specific tool budget test**

Append before final `console.log`:

```js
process.env.AGENT_TOOL_READ_MAX_CHARS = "4000";
try {
  const envBudgetMessages = [
    { role: "system", content: "system" },
    {
      role: "assistant",
      content: "read file",
      toolCalls: [{ id: "read-env", toolName: "Read", input: { file_path: "large.txt" } }],
    },
    { role: "tool", toolCallId: "read-env", toolName: "Read", content: "R".repeat(20_000) },
    { role: "user", content: "latest" },
  ];

  const envBudgetResult = await defaultContextWindowManager.prepareMessages({
    messages: envBudgetMessages,
    toolUseContext: makeToolUseContext("task-window-env-budget", "latest", envBudgetMessages),
  });

  const envBudgetTool = envBudgetResult.messages.find((message) => message.toolCallId === "read-env");
  assert.ok(envBudgetTool.content.length < 4_600);
  assert.ok(envBudgetTool.content.includes("keptChars=4000"));
} finally {
  delete process.env.AGENT_TOOL_READ_MAX_CHARS;
}
```

- [x] **Step 2: Run tests**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-context-window-manager.mjs
```

Expected: PASS.

## Task 7: Update Documentation

**Files:**
- Modify: `api/src/todo.md`
- Modify: `docs/agents/tool-registration.md`

- [x] **Step 1: Update Context Window section in `api/src/todo.md`**

In the `Context Window` section, extend `Implemented Phase 1` to this:

```md
Implemented:

- Phase 1: `defaultContextWindowManager.prepareMessages()` enforces a character budget, truncates large tool messages, and preserves assistant/tool adjacency.
- Phase 2: context-window diagnostics include `json-chars` and approximate token estimates.
- Phase 2: message groups are priority-aware and preserve system/latest-user invariants.
- Phase 2: truncated tool results include model-visible truncation metadata.
- Phase 2: `context_window.compaction_candidates` exposes deterministic candidates for a future LLM compactor.
```

Keep `Deferred` as:

```md
Deferred:

- LLM summary compaction.
- post-compact reinjection of file state and skill/tool declarations.
- durable transcript-based resume.
- persistent storage/reference handles for oversized tool results.
```

- [x] **Step 2: Update tool registration docs**

Append this paragraph under `## Context-window invariants` in `docs/agents/tool-registration.md`:

```md
When a tool result is too large for the active context budget, `ContextWindowManager` may replace it with a preview plus truncation metadata. The metadata must include the tool name, tool call id when available, original character count, kept character count, and omitted character count. Future persistent tool-result storage should use the same metadata shape when it adds external reference handles.
```

- [x] **Step 3: Run typecheck**

Run from `api/`:

```powershell
.\node_modules\.bin\tsc.CMD
```

Expected: PASS.

## Task 8: Final Verification

**Files:**
- Verify only.

- [x] **Step 1: Run context-window regression script**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-context-window-manager.mjs
```

Expected: PASS and prints `context window manager test passed`.

- [x] **Step 2: Run context-provider regression script**

Run from `api/`:

```powershell
.\node_modules\.bin\tsx.CMD tests\test-context-provider.mjs
```

Expected: PASS and prints `context provider test passed`.

- [x] **Step 3: Run backend typecheck**

Run from `api/`:

```powershell
.\node_modules\.bin\tsc.CMD
```

Expected: no TypeScript errors.

- [x] **Step 4: Inspect git diff**

Run from repo root:

```powershell
git diff -- api/src/modules/agent-loop/contextWindowManager.ts api/tests/test-context-window-manager.mjs api/src/todo.md docs/agents/tool-registration.md api/plan/context-window-phase2-plan.md
```

Expected:

- `contextWindowManager.ts` contains deterministic grouping, estimates, diagnostics, and candidates.
- `test-context-window-manager.mjs` contains Phase 2 regression cases.
- Docs describe Phase 2 as deterministic and keep LLM compact deferred.
- No changes to `PromptManager`, `ContextProvider`, `MemoryManager`, or `SkillManager` are required for this phase.

## Acceptance Checklist

- [x] Context window diagnostics include `estimateMethods: ["json-chars", "approx-tokens"]`.
- [x] Diagnostics include original/prepared chars and approximate tokens.
- [x] Diagnostics include removed groups, preserved groups, and trimmed messages.
- [x] Tool result truncation includes tool name, tool call id, original chars, kept chars, and omitted chars.
- [x] `system` message remains unless no system message was provided.
- [x] Latest `user` message remains.
- [x] Assistant `toolCalls` and matching `tool` messages remain adjacent when retained.
- [x] Orphan tool messages are removed.
- [x] Older tool-heavy groups are removed before protected groups.
- [x] `context_window.compaction_candidates` is returned as a JSON array.
- [x] No model calls are added to `ContextWindowManager`.
- [x] No context fetching is added to `ContextWindowManager`.
- [x] `api/tests/test-context-window-manager.mjs` passes.
- [x] `api/tests/test-context-provider.mjs` passes.
- [x] `api/node_modules/.bin/tsc.CMD` passes from `api/`.

## Deferred Phase 3

Only start this after durable transcript persistence exists:

1. Add persistent oversized tool-result storage.
2. Store preview/reference pairs in transcript entries.
3. Add `contextCompactor.ts` with an injected model client.
4. Summarize old groups into a synthetic summary message.
5. Reinject read-file state, skill listing, active tool declarations, and task state after compact.
6. Add compact failure circuit breaker and prompt-too-long retry fallback.
