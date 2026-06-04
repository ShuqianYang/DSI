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

console.log("context window manager test passed");
