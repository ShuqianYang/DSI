import { config as loadEnv } from "dotenv";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

loadEnv({ path: new URL("../../.env", import.meta.url) });

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
const { callTool } = await import(
  "../../src/modules/agent-loop/tools/_shared/toolGateway.js"
);
const { installMockBorderDefenseQaFetch } = await import(
  "../../scripts/agent-loop/agent-loop-smoke-border-defense-qa.ts"
);

const registry = buildDefaultToolRegistry();
registerSkillTool(registry, defaultSkillManager);

const toolUseContext = {
  taskId: "border-defense-qa-integration-test",
  query: "统计本月各级预警数量",
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

// 1. Invoke Skill tool to load border-defense-qa
const skillObservation = await callTool(
  registry,
  {
    id: "skill-border-defense-qa",
    toolName: "Skill",
    input: { skill: "border-defense-qa", args: "统计本月各级预警数量" },
  },
  {
    taskId: "border-defense-qa-integration-test",
    query: "统计本月各级预警数量",
    observations: [],
    toolUseContext,
  }
);

assert.equal(skillObservation.ok, true, "Skill invocation should succeed");
assert.equal(skillObservation.toolName, "Skill");
assert.ok(
  skillObservation.output?.contentPreview?.includes("alarm_event"),
  "Skill content preview should include alarm_event schema"
);
assert.deepEqual(
  skillObservation.output?.allowedTools?.sort(),
  ["Read", "MysqlQuerySchema", "MysqlQuery", "ChartRenderData"].sort(),
  "Skill should restrict allowed tools"
);

// Verify skillAllowedToolNames was applied
assert.ok(
  toolUseContext.skillAllowedToolNames?.has("MysqlQuerySchema"),
  "MysqlQuerySchema should be allowed after skill load"
);
assert.ok(
  toolUseContext.skillAllowedToolNames?.has("MysqlQuery"),
  "MysqlQuery should be allowed after skill load"
);
assert.ok(
  !toolUseContext.skillAllowedToolNames?.has("Bash"),
  "Bash should not be allowed after skill load"
);

// 2. Use mock MySQL to execute the expected tool sequence
const restoreMock = installMockBorderDefenseQaFetch();

try {
  const schemaObservation = await callTool(
    registry,
    {
      id: "bdqa-schema-1",
      toolName: "MysqlQuerySchema",
      input: { database: "border-defense", table: "alarm_event" },
    },
    {
      taskId: "border-defense-qa-integration-test",
      query: "统计本月各级预警数量",
      observations: [],
      toolUseContext,
    }
  );

  assert.equal(schemaObservation.ok, true, "MysqlQuerySchema should succeed");
  assert.equal(schemaObservation.output?.table, "alarm_event");
  assert.equal(schemaObservation.output?.columnCount, 4);

  const queryObservation = await callTool(
    registry,
    {
      id: "bdqa-query-1",
      toolName: "MysqlQuery",
      input: {
        database: "border-defense",
        sql: "SELECT event_level_name, COUNT(*) AS cnt FROM alarm_event WHERE event_time >= '2026-06-01' AND is_deleted = 0 GROUP BY event_level_name",
        limit: 100,
      },
    },
    {
      taskId: "border-defense-qa-integration-test",
      query: "统计本月各级预警数量",
      observations: [],
      toolUseContext,
    }
  );

  assert.equal(queryObservation.ok, true, "MysqlQuery should succeed");
  assert.equal(queryObservation.output?.rowCount, 3);
  assert.equal(queryObservation.output?.rows[0].event_level_name, "一级预警");
  assert.equal(queryObservation.output?.rows[0].cnt, 12);
} finally {
  restoreMock();
}

console.log(
  JSON.stringify(
    {
      ok: true,
      skillLoaded: skillObservation.ok,
      allowedTools: skillObservation.output?.allowedTools,
      schemaOk: true,
      queryOk: true,
      firstRow: { event_level_name: "一级预警", cnt: 12 },
    },
    null,
    2
  )
);
