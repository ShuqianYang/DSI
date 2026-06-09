import "dotenv/config";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), "dsi-agent-loop-skills-"));
  process.env.AGENT_WORKSPACE_ROOT = root;

  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    [
      "---",
      "description: Demo skill",
      "argument-hint: [topic]",
      "allowed-tools: Read, Bash",
      "---",
      "# Demo",
      "Topic: $ARGUMENTS",
      "Dir: ${SKILL_DIR}",
      "Inline: !`echo embedded-ok`",
      "",
    ].join("\n"),
    "utf8",
  );

  await mkdir(path.join(root, "skills", "cond"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "cond", "SKILL.md"),
    [
      "---",
      "description: Conditional skill",
      "paths: src/**/*.ts",
      "---",
      "# Conditional",
      "",
    ].join("\n"),
    "utf8",
  );

  await mkdir(path.join(root, "skills", "named-cond"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "named-cond", "SKILL.md"),
    [
      "---",
      "description: Named conditional skill",
      "paths: docs/**/*.md",
      "---",
      "# Named Conditional",
      "Loaded by explicit Skill call.",
      "",
    ].join("\n"),
    "utf8",
  );

  await mkdir(path.join(root, "skills", "blocked"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "blocked", "SKILL.md"),
    [
      "---",
      "description: Blocked skill",
      "disable-model-invocation: yes",
      "---",
      "# Blocked",
      "",
    ].join("\n"),
    "utf8",
  );

  await mkdir(path.join(root, "skills", "private"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "private", "SKILL.md"),
    [
      "---",
      "description: Private skill",
      "user-invocable: false",
      "---",
      "# Private",
      "",
    ].join("\n"),
    "utf8",
  );

  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "a.ts"), "export const a = 1;\n", "utf8");

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
    taskId: "skill-test",
    query: "test skills",
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
  assert(listing[0]?.content.includes("demo"), "demo skill should be listed");
  assert(
    listing[0]?.content.includes('"skill":"demo","args":"topic"'),
    "listing should show concrete Skill args invocation for argument-hint skills",
  );
  assert(!listing[0]?.content.includes("cond"), "conditional skill should not list before path activation");
  assert(!listing[0]?.content.includes("named-cond"), "named conditional skill should not list before path activation");
  assert(!listing[0]?.content.includes("private"), "user-invocable false skill should not be listed");

  const missingArgsObservation = await callTool(
    registry,
    {
      id: "skill-demo-missing-args",
      toolName: "Skill",
      input: { skill: "demo" },
    },
    {
      taskId: "skill-test",
      query: "test skills",
      observations: [],
      toolUseContext,
    },
  );
  assert(!missingArgsObservation.ok, "argument-hint skill should reject missing args");

  const skillObservation = await callTool(
    registry,
    {
      id: "skill-demo",
      toolName: "Skill",
      input: { skill: "demo", args: "ocean" },
    },
    {
      taskId: "skill-test",
      query: "test skills",
      observations: [],
      toolUseContext,
    },
  );
  assert(skillObservation.ok, `Skill tool failed: ${skillObservation.error?.message}`);
  const skillOutput = skillObservation.output as { inlineInjected?: boolean; contentPreview?: string };
  assert(skillOutput.inlineInjected === true, "Skill content should be injected as runtime context");
  assert(skillOutput.contentPreview?.includes("Argument hint: topic"), "Skill content should include argument hint");
  assert(skillOutput.contentPreview?.includes("Provided args: ocean"), "Skill content should include provided args");
  assert(skillOutput.contentPreview?.includes("Topic: ocean"), "Skill args should be substituted");
  assert(skillOutput.contentPreview?.includes(root), "Skill dir should be substituted");
  assert(skillOutput.contentPreview?.includes("embedded-ok"), "Embedded shell should execute through Bash");
  assert(
    toolUseContext.invokedSkillSections.some((section) => section.content.includes("Topic: ocean")),
    "Injected skill section should contain rendered skill content",
  );
  assert(toolUseContext.skillAllowedToolNames?.has("Read"), "Skill allowed-tools should include Read");
  assert(toolUseContext.skillAllowedToolNames?.has("Bash"), "Skill allowed-tools should include Bash");
  assert(toolUseContext.skillAllowedToolNames?.has("Skill"), "Skill should remain available after restriction");
  assert(!toolUseContext.skillAllowedToolNames?.has("Write"), "Skill allowed-tools should exclude Write");
  assert(
    typeof toolUseContext.skillAllowedToolsExpiresOnTurn === "number",
    "Skill allowed-tools should have an expiry turn",
  );

  const namedConditionalObservation = await callTool(
    registry,
    {
      id: "skill-named-cond",
      toolName: "Skill",
      input: { skill: "named-cond" },
    },
    {
      taskId: "skill-test",
      query: "test skills",
      observations: [],
      toolUseContext,
    },
  );
  assert(
    namedConditionalObservation.ok,
    `Explicit conditional Skill call should work before path activation: ${namedConditionalObservation.error?.message}`,
  );

  const blockedObservation = await callTool(
    registry,
    {
      id: "skill-blocked",
      toolName: "Skill",
      input: { skill: "blocked" },
    },
    {
      taskId: "skill-test",
      query: "test skills",
      observations: [],
      toolUseContext,
    },
  );
  assert(!blockedObservation.ok, "disable-model-invocation: yes should block model calls");

  const privateObservation = await callTool(
    registry,
    {
      id: "skill-private",
      toolName: "Skill",
      input: { skill: "private" },
    },
    {
      taskId: "skill-test",
      query: "test skills",
      observations: [],
      toolUseContext,
    },
  );
  assert(!privateObservation.ok, "user-invocable: false should block model calls");

  const readObservation = await callTool(
    registry,
    {
      id: "read-source",
      toolName: "Read",
      input: { file_path: "src/a.ts" },
    },
    {
      taskId: "skill-test",
      query: "test skills",
      observations: [],
      toolUseContext,
    },
  );
  assert(readObservation.ok, `Read failed: ${readObservation.error?.message}`);

  const prefetch = defaultSkillManager.startSkillDiscoveryPrefetch(null, [], toolUseContext);
  const discoverySections = prefetch
    ? await defaultSkillManager.collectSkillDiscoveryPrefetch(prefetch)
    : [];
  assert(
    discoverySections.some((section) => section.content.includes("cond")),
    "Conditional skill should be surfaced after matching file read",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        root,
        listed: listing[0].content.split("\n").slice(0, 3),
        discoverySections: discoverySections.map((section) => section.id),
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
