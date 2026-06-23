import assert from "node:assert/strict";
import { z } from "zod";
import {
  DEFAULT_PROMPT_COMPONENT_VERSIONS,
  DEFAULT_PROMPT_VERSION,
  defaultPromptManager,
  metadataValue,
} from "../../src/modules/agent-loop/promptManager.ts";

function makeTool(name, description, extra = {}) {
  return {
    name,
    description,
    inputSchema: z.object({}),
    async execute() {
      return {};
    },
    ...extra,
  };
}

function buildInput(overrides = {}) {
  return {
    query: "请查看项目状态并给出下一步建议",
    tools: [
      makeTool("Read", "Read a file from the workspace.", {
        kind: "system",
        aliases: ["View"],
        isReadOnly: () => true,
        isConcurrencySafe: () => true,
        riskLevel: "low",
        maxResultSizeChars: 18000,
      }),
      makeTool("Edit", "Edit a file in the workspace.", {
        kind: "system",
        isDestructive: () => true,
        riskLevel: () => "high",
      }),
    ],
    userContext: {
      currentDate: "Today's date is 2026-06-05. Time zone: Asia/Shanghai.",
      projectInstructions: "Follow AGENTS.md.",
    },
    systemContext: {
      workspaceRoot: "S:/Projects/projects_new",
      gitStatus: " M api/src/modules/agent-loop/promptManager.ts",
    },
    contextSections: [
      { id: "project.domain", content: "Domain context." },
    ],
    runtimeSections: [
      { id: "runtime.todo", content: "Todo state." },
    ],
    memorySections: [
      { id: "memory.session", content: "Remembered project preference." },
    ],
    skillSections: [
      { id: "skill.listing", content: "Available skills index." },
    ],
    observations: [],
    ...overrides,
  };
}

assert.equal(DEFAULT_PROMPT_VERSION, "agent-loop-prompt-v1");
assert.deepEqual(DEFAULT_PROMPT_COMPONENT_VERSIONS, {
  baseSystem: "base-system-v1",
  toolUseRules: "tool-use-rules-v1",
  gisRoutingRules: "gis-routing-rules-v2",
  disasterSatelliteRules: "disaster-satellite-rules-v2",
  oilSpillMockRules: "oil-spill-mock-rules-v4",
  fireInvestigationRules: "fire-investigation-rules-v3",
  earthquakeAssessmentRules: "earthquake-assessment-rules-v3",
  floodAssessmentRules: "flood-assessment-rules-v2",
  memoryRecallRules: "memory-recall-rules-v1",
  contextPriorityRules: "context-priority-rules-v1",
  toolCatalogRenderer: "tool-catalog-renderer-v1",
  promptSectionRenderer: "prompt-section-renderer-v1",
});

const versionMetadata = defaultPromptManager.getVersionMetadata();
assert.equal(versionMetadata.promptVersion, DEFAULT_PROMPT_VERSION);
assert.deepEqual(versionMetadata.componentVersions, DEFAULT_PROMPT_COMPONENT_VERSIONS);
assert.notEqual(versionMetadata.componentVersions, DEFAULT_PROMPT_COMPONENT_VERSIONS);

assert.equal(metadataValue(() => true), "dynamic");
assert.equal(metadataValue("low"), "low");
assert.equal(metadataValue(18000), 18000);
assert.equal(metadataValue(false), false);
assert.equal(metadataValue(""), undefined);

const result = defaultPromptManager.buildMessages(buildInput());

assert.equal(result.length, 2);
assert.equal(result[0].role, "system");
assert.equal(result[1].role, "user");
assert.equal(result[1].content, "请查看项目状态并给出下一步建议");

const system = result[0].content;
assert.match(system, /# Agent Role/);
assert.match(system, /# Memory Recall Decision Rules/);
assert.match(system, /decision=answer_from_memory/);
assert.match(system, /# Operating Rules/);
assert.match(system, /# Tool Use Rules/);
assert.match(system, /complete answer in a single final_answer/);
assert.match(system, /Do not put the complete final answer in the same assistant message as tool calls/);
assert.match(system, /Do not send a closing-only final answer/);
assert.match(system, /# Context Priority/);
assert.match(system, /# Available Tools/);
assert.match(system, /# Additional Context/);
assert.doesNotMatch(system, /minimal tool-using agent/);

assert.match(system, /## Read/);
assert.match(system, /description: Read a file from the workspace\./);
assert.match(system, /kind: system/);
assert.match(system, /aliases: View/);
assert.match(system, /readOnly: dynamic/);
assert.match(system, /concurrencySafe: dynamic/);
assert.match(system, /riskLevel: low/);
assert.match(system, /maxResultSizeChars: 18000/);

assert.match(system, /## Edit/);
assert.match(system, /destructive: dynamic/);
assert.match(system, /riskLevel: dynamic/);

const orderedMarkers = [
  "## user_context.currentDate",
  "## user_context.projectInstructions",
  "## system_context.gitStatus",
  "## system_context.workspaceRoot",
  "## project.domain",
  "## runtime.todo",
  "## memory.session",
  "## skill.listing",
];

let previousIndex = -1;
for (const marker of orderedMarkers) {
  const index = system.indexOf(marker);
  assert.notEqual(index, -1, `${marker} should be rendered`);
  assert.ok(index > previousIndex, `${marker} should appear after the previous section`);
  previousIndex = index;
}

const emptyResult = defaultPromptManager.buildMessages(buildInput({
  tools: [],
  userContext: {},
  systemContext: {},
  contextSections: [],
  runtimeSections: [],
  memorySections: [],
  skillSections: [],
}));

const emptySystem = emptyResult[0].content;
assert.match(emptySystem, /\(none\)/);
assert.doesNotMatch(emptySystem, /# Additional Context\s+\S/s);
assert.equal(emptyResult[1].content, "请查看项目状态并给出下一步建议");

const beforeInput = buildInput();
const beforeSnapshot = JSON.stringify({
  query: beforeInput.query,
  userContext: beforeInput.userContext,
  systemContext: beforeInput.systemContext,
  contextSections: beforeInput.contextSections,
  runtimeSections: beforeInput.runtimeSections,
  memorySections: beforeInput.memorySections,
  skillSections: beforeInput.skillSections,
});

defaultPromptManager.buildMessages(beforeInput);

const afterSnapshot = JSON.stringify({
  query: beforeInput.query,
  userContext: beforeInput.userContext,
  systemContext: beforeInput.systemContext,
  contextSections: beforeInput.contextSections,
  runtimeSections: beforeInput.runtimeSections,
  memorySections: beforeInput.memorySections,
  skillSections: beforeInput.skillSections,
});

assert.equal(afterSnapshot, beforeSnapshot);

const observationResult = defaultPromptManager.buildMessages(buildInput({
  observations: [
    {
      toolCallId: "call-1",
      toolName: "Read",
      ok: true,
      output: { content: "already present in conversation" },
    },
  ],
}));

assert.doesNotMatch(observationResult[0].content, /already present in conversation/);

console.log("prompt manager test passed");
