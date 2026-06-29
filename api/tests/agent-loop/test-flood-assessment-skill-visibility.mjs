import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const MOCK_TOOL_NAMES = [
  "RegionResolve",
  "RegionMark",
  "FloodPreImageMock",
  "FloodPostImageMock",
  "FloodAssessmentMock",
];

const root = await mkdtemp(path.join(tmpdir(), "dsi-flood-skill-"));
process.env.AGENT_WORKSPACE_ROOT = root;

await mkdir(path.join(root, "skills", "flood-assessment"), { recursive: true });
await writeFile(
  path.join(root, "skills", "flood-assessment", "SKILL.md"),
  [
    "---",
    "name: flood-assessment",
    "description: Deterministic flood assessment replay.",
    "argument-hint: [/演示:洪水灾后评估]",
    `allowed-tools: ${MOCK_TOOL_NAMES.join(", ")}`,
    "---",
    "# Flood Assessment",
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
for (const toolName of ["FloodPreImageMock", "FloodPostImageMock", "FloodAssessmentMock"]) {
  assert.equal(registry.get(toolName), undefined, `${toolName} should not be registered before skill load`);
}

const toolUseContext = {
  taskId: "flood-skill-visibility",
  query: "/演示:洪水灾后评估",
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
    id: "skill-flood",
    toolName: "Skill",
    input: { skill: "flood-assessment", args: "/演示:洪水灾后评估" },
  },
  {
    taskId: "flood-skill-visibility",
    query: "/演示:洪水灾后评估",
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

console.log("flood assessment skill visibility assertions passed");
