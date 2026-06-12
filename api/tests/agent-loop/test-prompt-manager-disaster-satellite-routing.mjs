import assert from "node:assert/strict";

const { defaultPromptManager } = await import("../../src/modules/agent-loop/promptManager.ts");

const messages = defaultPromptManager.buildMessages({
  query: "查询台湾海峡最近一周地震情况，并找一下灾后的卫星图。",
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

assert.match(systemMessage.content, /# Disaster Satellite Query Rules/);
assert.match(systemMessage.content, /Call RegionResolve first/);
assert.match(systemMessage.content, /reuse selected\.bbox exactly/);
assert.match(systemMessage.content, /Call DisasterQuery/);
assert.match(systemMessage.content, /Call SatelliteImageSearch/);
assert.match(systemMessage.content, /call RegionMark with selected\.geometryRef/);
assert.match(systemMessage.content, /ImageAnalysis[\s\S]*available/);
assert.match(systemMessage.content, /do not fabricate/i);
assert.match(systemMessage.content, /If RegionResolve resolved=false, do not guess/);

console.log("prompt manager disaster satellite routing test passed");
