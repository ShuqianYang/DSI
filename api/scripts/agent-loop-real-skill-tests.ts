import "dotenv/config";
import path from "node:path";

async function main() {
  const root = path.resolve(".");
  process.env.AGENT_WORKSPACE_ROOT = root;

  const csvPath = path.join("skills", "csv-profile", "assets", "sample-incidents.csv");

  const { defaultSkillManager, registerSkillTool } = await import(
    "../src/modules/agent-loop/skillManager.js"
  );
  const { ToolRegistry } = await import("../src/modules/agent-loop/tools/_shared/toolRegistry.js");
  const { buildSystemTools } = await import(
    "../src/modules/agent-loop/tools/system/index.js"
  );
  const { callTool } = await import("../src/modules/agent-loop/tools/_shared/toolGateway.js");

  const registry = new ToolRegistry();
  for (const tool of buildSystemTools()) {
    registry.register(tool);
  }
  registerSkillTool(registry, defaultSkillManager);

  const toolUseContext = {
    taskId: "real-skill-test",
    query: "test real skills",
    messages: [],
    observations: [],
    options: { tools: registry.list() },
    readFileState: new Map(),
    todoState: [],
    nestedMemoryAttachmentTriggers: new Set<string>(),
    dynamicSkillDirTriggers: new Set<string>(),
    discoveredSkillNames: new Set<string>(),
    invokedSkillSections: [],
    skillManager: defaultSkillManager,
  };

  const listing = await defaultSkillManager.getSkillListingSections(toolUseContext);
  assert(
    listing.some((section) => section.content.includes("conventional-commit-helper")),
    "pure markdown skill should be listed",
  );
  assert(
    listing.some((section) => section.content.includes("csv-profile")),
    "script-backed skill should be listed",
  );

  const pureSkill = await callTool(
    registry,
    {
      id: "pure-md-skill",
      toolName: "Skill",
      input: { skill: "conventional-commit-helper", args: "fix skill manager allowed tools" },
    },
    {
      taskId: "real-skill-test",
      query: "test real skills",
      observations: [],
      toolUseContext,
    },
  );
  assert(pureSkill.ok, `conventional-commit-helper failed: ${pureSkill.error?.message}`);
  assert(
    JSON.stringify(pureSkill.output).includes("Conventional Commit Helper"),
    "pure markdown skill should inject instructions",
  );

  const scriptSkill = await callTool(
    registry,
    {
      id: "script-skill",
      toolName: "Skill",
      input: { skill: "csv-profile", args: csvPath },
    },
    {
      taskId: "real-skill-test",
      query: "test real skills",
      observations: [],
      toolUseContext,
    },
  );
  assert(scriptSkill.ok, `csv-profile failed: ${scriptSkill.error?.message}`);
  const scriptOutput = scriptSkill.output as { contentPreview?: string };
  assert(scriptOutput.contentPreview?.includes('"rows": 3'), "csv-profile script should report row count");
  assert(scriptOutput.contentPreview?.includes('"missing": 1'), "csv-profile script should report missing values");

  console.log(
    JSON.stringify(
      {
        ok: true,
        skills: ["conventional-commit-helper", "csv-profile"],
        csvPath,
      },
      null,
      2,
    ),
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
