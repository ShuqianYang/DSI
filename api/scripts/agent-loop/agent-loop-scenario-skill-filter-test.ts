import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";

const runAgentLoopSource = await readFile("api/src/modules/agent-loop/runAgentLoop.ts", "utf8");
const sharedTypesSource = await readFile("api/src/modules/agent-loop/tools/_shared/types.ts", "utf8");
const pipelineSource = await readFile("api/src/modules/tasks/pipeline.ts", "utf8");

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

console.log("PASS agent-loop scenario skill filter source checks");
