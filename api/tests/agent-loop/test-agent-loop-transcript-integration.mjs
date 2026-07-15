import "dotenv/config";
import assert from "node:assert/strict";
import { z } from "zod";
import { eq } from "drizzle-orm";

const { runAgentLoop } = await import("../../src/modules/agent-loop/runAgentLoop.ts");
const { createDbTranscriptStore } = await import("../../src/modules/agent-loop/transcriptStore.ts");
const { ToolRegistry } = await import("../../src/modules/agent-loop/tools/_shared/toolRegistry.ts");
const { db } = await import("../../src/config/database.ts");
const { tasks } = await import("../../src/db/schema.ts");

const taskId = crypto.randomUUID();
const query = "Use the demo lookup tool, then answer.";
const transcriptStore = createDbTranscriptStore(db);

const registry = new ToolRegistry();
registry.register({
  name: "DemoLookup",
  description: "Fake read tool for transcript integration tests.",
  kind: "domain",
  inputSchema: z.object({
    topic: z.string(),
  }),
  isConcurrencySafe: () => false,
  async execute(input) {
    return {
      topic: input.topic,
      summary: "demo observation",
    };
  },
});

const decisions = [
  {
    type: "tool_calls",
    content: "I will look up the demo data.",
    toolCalls: [
      {
        id: "demo-call-1",
        toolName: "DemoLookup",
        input: { topic: "transcript" },
        reason: "Need one tool observation before answering.",
      },
    ],
  },
  {
    type: "final_answer",
    content: "Demo lookup completed.",
  },
];

const modelClient = {
  async decide() {
    const next = decisions.shift();
    if (!next) throw new Error("unexpected extra model call");
    return next;
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

await db.insert(tasks).values({ id: taskId, query, status: "running" });

try {
  const result = await runAgentLoop({
    taskId,
    query,
    registry,
    modelClient,
    contextProvider,
    transcriptStore,
    fileLogger: false,
    maxTurns: 3,
  });

  assert.equal(result.stoppedBy, "final_answer");
  assert.equal(result.finalAnswer, "Demo lookup completed.");

  const entries = await transcriptStore.load(taskId);
  assert.deepEqual(
    entries.map((entry) => entry.kind),
    [
      "model_request",
      "assistant_message",
      "tool_message",
      "model_request",
      "assistant_message",
      "loop_stop",
    ]
  );
  assert.deepEqual(
    entries.map((entry) => entry.sequence),
    [1, 2, 3, 4, 5, 6]
  );

  const firstRequest = entries[0];
  assert(Array.isArray(firstRequest.messages));
  assert(firstRequest.messages.some((message) => message.role === "user" && message.content === query));
  assert(firstRequest.metadata);
  assert(firstRequest.metadata.prompt);
  assert.equal(firstRequest.metadata.prompt.promptVersion, "agent-loop-prompt-v1");
  assert.equal(firstRequest.metadata.prompt.toolCatalog.count, 2);
  assert.deepEqual(firstRequest.metadata.prompt.toolCatalog.names, ["DemoLookup", "Skill"]);
  assert.match(firstRequest.metadata.prompt.toolCatalog.hash, /^sha256:[a-f0-9]{16}$/);
  assert.match(firstRequest.metadata.prompt.messages.preparedHash, /^sha256:[a-f0-9]{16}$/);

  const toolAssistant = entries[1].message;
  assert.equal(toolAssistant.role, "assistant");
  assert.equal(toolAssistant.toolCalls[0].toolName, "DemoLookup");

  const toolMessage = entries[2].message;
  assert.equal(toolMessage.role, "tool");
  assert.equal(toolMessage.toolCallId, "demo-call-1");
  assert.equal(toolMessage.toolName, "DemoLookup");
  assert(toolMessage.content.includes("demo observation"));

  const loopStop = entries.at(-1);
  assert.equal(loopStop.kind, "loop_stop");
  assert.equal(loopStop.stoppedBy, "final_answer");
  assert.equal(loopStop.finalAnswer, "Demo lookup completed.");
} finally {
  await db.delete(tasks).where(eq(tasks.id, taskId));
}

console.log("agent loop transcript integration test passed");
process.exit(0);
