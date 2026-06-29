import assert from "node:assert/strict";

const {
  DEFAULT_PROMPT_COMPONENT_VERSIONS,
  defaultPromptManager,
} = await import("../../src/modules/agent-loop/promptManager.ts");

const [systemMessage] = defaultPromptManager.buildMessages({
  query: "/演示:地震灾后评估",
  tools: [],
  userContext: {},
  systemContext: {},
  contextSections: [],
  runtimeSections: [],
  memorySections: [],
  skillSections: [],
  observations: [],
});

assert.equal(systemMessage.role, "system");
assert.match(systemMessage.content, /# Earthquake Assessment Mock Routing Rules/);
assert.match(systemMessage.content, /\/演示:地震灾后评估/);
assert.match(systemMessage.content, /Skill.*earthquake-assessment/);
assert.match(systemMessage.content, /RegionResolve/);
assert.match(systemMessage.content, /RegionMark/);
assert.match(systemMessage.content, /EarthquakePreImageMock/);
assert.match(systemMessage.content, /EarthquakePostImageMock/);
assert.match(systemMessage.content, /EarthquakeAssessmentMock/);
assert.match(systemMessage.content, /without the '\/演示:地震灾后评估' prefix, do not use this skill or its mock tools/);
assert.equal(DEFAULT_PROMPT_COMPONENT_VERSIONS.earthquakeAssessmentRules, "earthquake-assessment-rules-v3");

console.log("prompt manager earthquake assessment routing assertions passed");
