import { strict as assert } from "node:assert";
import {
  CreateTaskRequest,
  DEFAULT_SCENARIO_ID,
  SCENARIOS,
  getScenarioProfile,
  getSkillScenarioUsage,
  isScenarioId,
} from "@datasourceintelligence/shared";

const scenarioIds = SCENARIOS.map((scenario) => scenario.id);

assert.deepEqual(scenarioIds, ["osint", "marine", "emergency", "border"]);
assert.equal(DEFAULT_SCENARIO_ID, "osint");
assert.equal(getScenarioProfile(undefined).id, "osint");
assert.equal(getScenarioProfile("marine").name, "海洋");
assert.equal(getScenarioProfile("not-real").id, "osint");
assert.equal(isScenarioId("border"), true);
assert.equal(isScenarioId("unknown"), false);

assert.deepEqual(
  getSkillScenarioUsage("fire-investigation").map((scenario) => scenario.id),
  ["emergency", "border"],
);
assert.deepEqual(
  getSkillScenarioUsage("oil-spill-tracing").map((scenario) => scenario.id),
  ["marine"],
);
assert.deepEqual(getSkillScenarioUsage("csv-profile"), []);

const parsed = CreateTaskRequest.parse({
  query: "查询东海船舶态势",
  userId: "agent-loop-local-user",
  scenarioId: "osint",
});
assert.equal(parsed.scenarioId, "osint");

const fallbackParsed = CreateTaskRequest.parse({
  query: "没有场景也可以创建任务",
});
assert.equal(fallbackParsed.scenarioId, undefined);

assert.throws(() => {
  CreateTaskRequest.parse({ query: "非法场景", scenarioId: "invalid" });
});

console.log("PASS shared scenario profiles");
