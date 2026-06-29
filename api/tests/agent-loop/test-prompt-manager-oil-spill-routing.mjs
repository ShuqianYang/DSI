import assert from "node:assert/strict";

const { defaultPromptManager, DEFAULT_PROMPT_COMPONENT_VERSIONS } = await import(
  "../../src/modules/agent-loop/promptManager.ts"
);

const messages = defaultPromptManager.buildMessages({
  query: "查询东海漏油并匹配疑似肇事船",
  tools: [],
  userContext: {},
  systemContext: {},
  contextSections: [],
  runtimeSections: [],
  memorySections: [],
  skillSections: [],
  observations: [],
});

const systemMessage = messages.find((message) => message.role === "system");
assert.ok(systemMessage, "expected a system message");
assert.match(systemMessage.content, /# Oil Spill Mock Routing Rules/);
assert.match(systemMessage.content, /Skill.*oil-spill-tracing/);
assert.match(systemMessage.content, /RegionResolve/);
assert.match(systemMessage.content, /RegionMark/);
assert.match(systemMessage.content, /OilSpillDetectMock/);
assert.match(systemMessage.content, /WeatherFetchMock/);
assert.match(systemMessage.content, /queryData/);
assert.match(systemMessage.content, /shouldContinue:false/);
assert.match(systemMessage.content, /do not use real WeatherFetch/i);
assert.equal(DEFAULT_PROMPT_COMPONENT_VERSIONS.oilSpillMockRules, "oil-spill-mock-rules-v4");

console.log("prompt manager oil spill routing test passed");
