import { config as loadEnv } from "dotenv";
import assert from "node:assert/strict";

loadEnv({ path: new URL("../../.env", import.meta.url) });

import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..", "..", "..");
process.env.AGENT_WORKSPACE_ROOT = workspaceRoot;

const { buildDefaultToolRegistry } = await import(
  "../../src/modules/agent-loop/tools/_shared/toolRegistry.js"
);
const { defaultSkillManager, registerSkillTool } = await import(
  "../../src/modules/agent-loop/skillManager.js"
);

const registry = buildDefaultToolRegistry();
registerSkillTool(registry, defaultSkillManager);

const toolUseContext = {
  taskId: "border-defense-qa-skill-load-test",
  query: "border defense qa skill load test",
  messages: [],
  observations: [],
  options: { tools: registry.list() },
  readFileState: new Map(),
  todoState: [],
  nestedMemoryAttachmentTriggers: new Set(),
  dynamicSkillDirTriggers: new Set(),
  discoveredSkillNames: new Set(),
  invokedSkillSections: [],
};

// 1. Skill listing includes border-defense-qa
const listing = await defaultSkillManager.getSkillListingSections(toolUseContext);
const listingContent = listing.map((section) => section.content).join("\n");
assert(listingContent.includes("border-defense-qa"), "border-defense-qa should be listed");
assert(
  listingContent.includes('"skill":"border-defense-qa"'),
  "listing should show concrete Skill invocation"
);

// 2. Skill metadata
const skill = await defaultSkillManager.getSkill("border-defense-qa", toolUseContext);
assert(skill, "Skill should be loaded from skillManager");
assert.equal(skill.name, "border-defense-qa", "Skill name should match");
assert.ok(
  skill.allowedTools.includes("Read") && skill.allowedTools.includes("MysqlQuerySchema"),
  "allowed-tools should include Read and MysqlQuerySchema"
);
assert(
  skill.allowedTools.includes("ChartRenderData"),
  "allowed-tools should include ChartRenderData"
);
assert.ok(
  !skill.allowedTools.includes("Bash"),
  "allowed-tools should exclude Bash"
);
assert.ok(
  !skill.allowedTools.includes("Write"),
  "allowed-tools should exclude Write"
);

// 3. Skill content includes key schema and rules
const content = skill.content;
assert(content.includes("## `alarm_event`"), "Skill content should describe alarm_event");
assert(content.includes("## `buckle_access_record`"), "Skill content should describe buckle_access_record");
assert(
  content.includes("你是谁") && content.includes("边防智能问答助手"),
  "Skill content should include self-introduction"
);
assert(
  content.includes("抱歉，这个问题超出了我的能力范围"),
  "Skill content should include irrelevant-question response"
);

assert(
  content.includes("## Chart rules"),
  "Skill content should include chart rules"
);
assert(
  content.includes("## Detail query rules"),
  "Skill content should include detail query rules"
);
assert(
  content.includes("longitude") && content.includes("latitude"),
  "Skill content should mention longitude/latitude for map detail"
);

console.log(
  JSON.stringify(
    {
      ok: true,
      skillName: skill.name,
      allowedTools: skill.allowedTools,
      listed: listingContent.includes("border-defense-qa"),
      hasSchema: content.includes("## `alarm_event`"),
      hasSelfIntro: content.includes("你是谁") && content.includes("边防智能问答助手"),
      hasIrrelevantResponse: content.includes("抱歉，这个问题超出了我的能力范围"),
      hasChartRules: content.includes("## Chart rules"),
      hasDetailQueryRules: content.includes("## Detail query rules"),
      hasMapCoordinates: content.includes("longitude") && content.includes("latitude"),
    },
    null,
    2
  )
);
