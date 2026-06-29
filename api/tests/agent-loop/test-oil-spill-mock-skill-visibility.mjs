import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const MOCK_TOOL_NAMES = [
  "RegionResolve",
  "RegionMark",
  "OilSpillDetectMock",
  "WeatherFetchMock",
  "OilDriftTraceMock",
  "AisFetchMock",
  "AisMatchSuspectsMock",
  "AisSuspectRankingMock",
];

const root = await mkdtemp(path.join(tmpdir(), "dsi-oil-spill-skill-"));
process.env.AGENT_WORKSPACE_ROOT = root;

await mkdir(path.join(root, "skills", "oil-spill-tracing"), { recursive: true });
await writeFile(
  path.join(root, "skills", "oil-spill-tracing", "SKILL.md"),
  [
    "---",
    "name: oil-spill-tracing",
    "description: Deterministic oil-spill tracing replay.",
    "argument-hint: [user oil-spill query]",
    `allowed-tools: ${MOCK_TOOL_NAMES.join(", ")}`,
    "---",
    "# Oil Spill Tracing",
    "Use only the deterministic mock tools for this replay.",
    "",
  ].join("\n"),
  "utf8",
);

const { buildDefaultToolRegistry } = await import("../../src/modules/agent-loop/tools/_shared/toolRegistry.js");
const { defaultSkillManager, registerSkillTool } = await import("../../src/modules/agent-loop/skillManager.js");
const { callTool } = await import("../../src/modules/agent-loop/tools/_shared/toolGateway.js");

const registry = buildDefaultToolRegistry();
registerSkillTool(registry, defaultSkillManager);

const initialVisibleNames = new Set(registry.list().map((tool) => tool.name));
for (const toolName of MOCK_TOOL_NAMES) {
  const expectedVisible = toolName === "RegionResolve" || toolName === "RegionMark";
  assert.equal(initialVisibleNames.has(toolName), expectedVisible, `${toolName} initial visibility mismatch`);
}

const toolUseContext = {
  taskId: "oil-spill-skill-visibility",
  query: "查询东海漏油",
  messages: [],
  observations: [],
  options: { tools: registry.list() },
  readFileState: new Map(),
  todoState: [],
  nestedMemoryAttachmentTriggers: new Set(),
  dynamicSkillDirTriggers: new Set(),
  discoveredSkillNames: new Set(),
  invokedSkillSections: [],
  skillManager: defaultSkillManager,
};

await defaultSkillManager.getSkillListingSections(toolUseContext);

const skillObservation = await callTool(
  registry,
  {
    id: "skill-oil-spill",
    toolName: "Skill",
    input: { skill: "oil-spill-tracing", args: "查询东海漏油" },
  },
  {
    taskId: "oil-spill-skill-visibility",
    query: "查询东海漏油",
    observations: [],
    toolUseContext,
  },
);

assert.equal(skillObservation.ok, true, skillObservation.error?.message);
assert.equal(toolUseContext.skillAllowedToolsExpiresOnTurn, undefined);

const allowed = toolUseContext.skillAllowedToolNames;
assert.ok(allowed, "skill load should set an allowed tool set");

const refreshedTools = toolUseContext.options.refreshTools?.() ?? registry.list();
const activeTools = refreshedTools.filter(
  (tool) => allowed.has(tool.name) || tool.aliases?.some((alias) => allowed.has(alias)),
);
const activeNames = activeTools.map((tool) => tool.name).sort();

assert.deepEqual(activeNames, [...MOCK_TOOL_NAMES, "Skill", "TodoWrite"].sort());
assert.equal(activeNames.includes("Glob"), false);
assert.equal(activeNames.includes("Read"), false);
for (const toolName of MOCK_TOOL_NAMES) {
  assert.equal(registry.get(toolName)?.name, toolName, `${toolName} should be executable after skill load`);
}

console.log("oil spill mock skill visibility assertions passed");
