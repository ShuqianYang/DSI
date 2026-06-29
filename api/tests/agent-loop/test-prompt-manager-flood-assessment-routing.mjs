import assert from "node:assert/strict";

const {
  DEFAULT_PROMPT_COMPONENT_VERSIONS,
  defaultPromptManager,
} = await import("../../src/modules/agent-loop/promptManager.ts");

const [systemMessage] = defaultPromptManager.buildMessages({
  query: "/演示:洪水灾后评估",
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
assert.match(systemMessage.content, /# Flood Assessment Mock Routing Rules/);
assert.match(systemMessage.content, /\/演示:洪水灾后评估/);
assert.match(systemMessage.content, /Skill.*flood-assessment/);
assert.match(systemMessage.content, /RegionResolve/);
assert.match(systemMessage.content, /RegionMark/);
assert.match(systemMessage.content, /FloodPreImageMock/);
assert.match(systemMessage.content, /FloodPostImageMock/);
assert.match(systemMessage.content, /FloodAssessmentMock/);
assert.match(systemMessage.content, /without the '\/演示:洪水灾后评估' prefix, do not use this skill or its mock tools/);
assert.equal(DEFAULT_PROMPT_COMPONENT_VERSIONS.floodAssessmentRules, "flood-assessment-rules-v2");

console.log("prompt manager flood assessment routing assertions passed");
