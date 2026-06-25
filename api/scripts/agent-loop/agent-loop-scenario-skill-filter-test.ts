import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { noopContextProvider } from "../../src/modules/agent-loop/contextProvider.js";
import { runAgentLoopEvents } from "../../src/modules/agent-loop/runAgentLoop.js";
import { LocalSkillManager, registerSkillTool } from "../../src/modules/agent-loop/skillManager.js";
import type { ModelClient } from "../../src/modules/agent-loop/modelClient.js";
import { callTool } from "../../src/modules/agent-loop/tools/_shared/toolGateway.js";
import { ToolRegistry } from "../../src/modules/agent-loop/tools/_shared/toolRegistry.js";
import type {
  AgentLoopEvent,
  AgentLoopToolUseContext,
} from "../../src/modules/agent-loop/tools/_shared/types.js";

const runAgentLoopSource = await readFile("api/src/modules/agent-loop/runAgentLoop.ts", "utf8");
const sharedTypesSource = await readFile("api/src/modules/agent-loop/tools/_shared/types.ts", "utf8");
const pipelineSource = await readFile("api/src/modules/tasks/pipeline.ts", "utf8");
const skillManagerSource = await readFile("api/src/modules/agent-loop/skillManager.ts", "utf8");

assert.ok(
  sharedTypesSource.includes("scenarioId?: ScenarioId"),
  "AgentLoopToolUseContext should carry scenarioId",
);
assert.ok(
  runAgentLoopSource.includes("scenarioId?: ScenarioId"),
  "RunAgentLoopOptions should accept scenarioId",
);
assert.ok(
  runAgentLoopSource.includes("scenarioId: options.scenarioId"),
  "runAgentLoop should pass scenarioId into tool-use context",
);
assert.ok(
  pipelineSource.includes("scenarioId: body.scenarioId"),
  "task pipeline should pass request scenarioId into Agent Loop",
);
assert.ok(
  skillManagerSource.includes("getScenarioProfile"),
  "SkillManager should read shared scenario profiles",
);
assert.ok(
  skillManagerSource.includes("filterSkillsForScenario"),
  "SkillManager should filter skill listings by scenario",
);
assert.ok(
  skillManagerSource.includes("assertSkillEnabledForScenario"),
  "Skill tool validation should reject disallowed scenario skills",
);
assert.ok(
  skillManagerSource.includes("Skill ${skill.name} is not enabled for scenario"),
  "Skill rejection should explain the active scenario boundary",
);

const listingClient: ModelClient = {
  async decide({ messages }) {
    const systemText = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");

    assert.ok(systemText.includes("oil-spill-tracing"), "marine listing should include oil-spill-tracing");
    assert.ok(systemText.includes("ais-region-query"), "marine listing should include ais-region-query");
    assert.ok(!systemText.includes("daily-report"), "marine listing should not include daily-report");
    assert.ok(!systemText.includes("aircraft-region-query"), "marine listing should not include aircraft-region-query");

    return {
      type: "final_answer",
      content: "listing checked",
    };
  },
};

const listingEvents: AgentLoopEvent[] = [];
for await (const event of runAgentLoopEvents({
  taskId: "00000000-0000-4000-8000-000000000101",
  query: "check marine scenario skill listing",
  scenarioId: "marine",
  modelClient: listingClient,
  contextProvider: noopContextProvider,
  maxTurns: 1,
  fileLogger: false,
})) {
  listingEvents.push(event);
}

assert.ok(listingEvents.some((event) => event.type === "loop_stop"));

const directSkillManager = new LocalSkillManager();
const registry = new ToolRegistry();
registerSkillTool(registry, directSkillManager);

const toolUseContext: AgentLoopToolUseContext = {
  taskId: "00000000-0000-4000-8000-000000000102",
  query: "marine scenario should reject daily-report skill",
  scenarioId: "marine",
  messages: [],
  observations: [],
  options: {
    tools: registry.list(),
  },
  readFileState: new Map(),
  todoState: [],
  nestedMemoryAttachmentTriggers: new Set(),
  dynamicSkillDirTriggers: new Set(),
  discoveredSkillNames: new Set(),
  invokedSkillSections: [],
  skillManager: directSkillManager,
};

const rejectionObservation = await callTool(
  registry,
  {
    id: "call-disallowed-skill",
    toolName: "Skill",
    input: { skill: "daily-report", args: "today" },
  },
  {
    taskId: toolUseContext.taskId,
    query: toolUseContext.query,
    observations: [],
    toolUseContext,
  },
);

const rejectionText = JSON.stringify(rejectionObservation);
assert.ok(
  rejectionText.includes("Skill daily-report is not enabled for scenario marine"),
  "disallowed skill invocation should be rejected",
);

console.log("PASS agent-loop scenario skill filter source checks");
