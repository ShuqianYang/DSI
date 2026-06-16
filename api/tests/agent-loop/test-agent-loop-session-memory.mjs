import assert from "node:assert/strict";

const { runAgentLoopEvents } = await import("../../src/modules/agent-loop/runAgentLoop.ts");

const taskId = crypto.randomUUID();
const query = "Continue Taiwan Strait analysis";
const modelRequests = [];
let filteredSectionCount = 0;

const memoryManager = {
  startRelevantMemoryPrefetch() {
    return {
      settledAt: Date.now(),
      consumedOnIteration: -1,
      promise: Promise.resolve([
        {
          id: "memory.session_summary.prior-task",
          content: JSON.stringify({
            source: "recent_completed_task",
            query: "Mark Taiwan Strait and fetch wind field",
            summary: { finalAnswerPreview: "Taiwan Strait wind field was fetched." },
          }),
        },
      ]),
    };
  },
  filterDuplicateMemorySections(sections) {
    filteredSectionCount = sections.length;
    return sections;
  },
};

const modelClient = {
  async decide(input) {
    modelRequests.push(input.messages);
    return { type: "final_answer", content: "Used the previous session summary." };
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
  modelClient,
  contextProvider,
  memoryManager,
  skillManager,
  fileLogger: false,
  maxTurns: 2,
})) {
  if (event.type === "loop_stop") {
    result = event.result;
  }
}

assert.equal(result.stoppedBy, "final_answer");
assert.equal(modelRequests.length, 1);
assert.equal(filteredSectionCount, 1);
assert(modelRequests[0][0].content.includes("## memory.session_summary.prior-task"));
assert(modelRequests[0][0].content.includes("Taiwan Strait wind field was fetched."));

console.log("agent loop session memory test passed");
