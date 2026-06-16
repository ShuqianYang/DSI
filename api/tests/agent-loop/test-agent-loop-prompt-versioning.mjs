import assert from "node:assert/strict";
import { z } from "zod";

const { runAgentLoopEvents } = await import("../../src/modules/agent-loop/runAgentLoop.ts");
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
    return { currentDate: "2026-06-16" };
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

const skillManager = {
  async getSkillListingSections() {
    return [];
  },
  startSkillDiscoveryPrefetch() {
    return undefined;
  },
  async collectSkillDiscoveryPrefetch() {
    return [];
  },
};

let result;
for await (const event of runAgentLoopEvents({
  taskId,
  query,
  registry,
  modelClient,
  contextProvider,
  skillManager,
  transcriptStore,
  fileLogger: false,
  maxTurns: 2,
})) {
  if (event.type === "loop_stop") {
    result = event.result;
  }
}

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
assert.equal(modelRequest.metadata.prompt.runtimeSections.count, 0);
assert.equal(modelRequest.metadata.prompt.memorySections.count, 0);
assert.equal(modelRequest.metadata.prompt.skillSections.count, 0);
assert.equal(modelRequest.metadata.prompt.messages.rawCount, 2);
assert.equal(modelRequest.metadata.prompt.messages.preparedCount, 2);
assert.match(modelRequest.metadata.prompt.messages.rawHash, /^sha256:[a-f0-9]{16}$/);
assert.match(modelRequest.metadata.prompt.messages.preparedHash, /^sha256:[a-f0-9]{16}$/);

console.log("agent loop prompt versioning test passed");
