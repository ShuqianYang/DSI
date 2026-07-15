import assert from "node:assert/strict";
import { defaultContextWindowManager } from "../../src/modules/agent-loop/contextWindowManager.ts";

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
  toolUseContext: makeToolUseContext("task-window", "latest user question", messages),
});

assert.equal(result.messages.at(0).role, "system");
assert.equal(result.messages.at(-1).content, "latest user question");
const assistantIndex = result.messages.findIndex((message) => message.role === "assistant" && message.toolCalls?.length);
if (assistantIndex !== -1) {
  assert.equal(result.messages[assistantIndex + 1]?.role, "tool");
  assert.equal(result.messages[assistantIndex + 1]?.toolCallId, "call-1");
  assert.ok(result.messages[assistantIndex + 1].content.length < 18_700);
  assert.ok(result.messages[assistantIndex + 1].content.includes("[ContextWindowManager truncated tool result]"));
  assert.ok(result.messages[assistantIndex + 1].content.includes("toolName=Read"));
  assert.ok(result.messages[assistantIndex + 1].content.includes("omittedChars="));
}
assert.ok(JSON.stringify(result.messages).length < JSON.stringify(messages).length);
assert.equal(result.contextSections?.some((section) => section.id === "context_window.diagnostics"), true);
const diagnostics = JSON.parse(result.contextSections.find((section) => section.id === "context_window.diagnostics").content);
assert.deepEqual(diagnostics.estimateMethods, ["json-chars", "approx-tokens"]);
assert.equal(typeof diagnostics.removedTurns, "number");

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
  toolUseContext: makeToolUseContext("task-window-adjacency", "new question", adjacencyMessages),
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

console.log("context window manager test passed");
