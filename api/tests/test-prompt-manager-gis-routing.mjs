import assert from "node:assert/strict";

const { defaultPromptManager } = await import("../src/modules/agent-loop/promptManager.ts");

const messages = defaultPromptManager.buildMessages({
  query: "圈选台湾海峡并查询这个区域的风场。",
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

assert.match(systemMessage.content, /# GIS Tool Routing Rules/);
assert.match(systemMessage.content, /Call RegionResolve first/);
assert.match(systemMessage.content, /call RegionMark with selected\.bbox/);
assert.match(systemMessage.content, /reuse the same bbox/);
assert.match(systemMessage.content, /If resolved=false, do not guess/);
assert.match(systemMessage.content, /Ask for bbox\/polygon or say the region GeoJSON is missing/);

console.log("prompt manager GIS routing test passed");
