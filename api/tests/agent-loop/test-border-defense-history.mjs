import assert from "node:assert/strict";

const { chartsFromResult, outcomeFromTaskResult, reportContentFromTaskResult, stepsFromTaskResult } = await import(
  "../../../src/lib/borderDefenseRun.ts"
);

const result = {
  message: "done",
  turns: 2,
  stoppedBy: "final_answer",
  observations: [
    { toolCallId: "skill-1", toolName: "Skill", ok: true, output: { loaded: true } },
    {
      toolCallId: "report-1",
      toolName: "DailyReport",
      ok: true,
      output: {
        report_content: "fallback",
        charts: [{
          chart_type: "pie",
          title: "设备在线状态",
          chart_id: "devices-1",
          data: [{ status: "在线", count: 5 }],
          config: { label_key: "status", value_key: "count" },
        }],
        generation: { status: "degraded", modelUsed: false, error: "timeout" },
      },
    },
  ],
};

const steps = stepsFromTaskResult(result);
assert.deepEqual(steps.map((step) => step.name), ["Skill", "Agent Turn 1", "DailyReport", "Agent Turn 2"]);
assert.ok(steps.every((step) => step.status === "completed"));
assert.equal(reportContentFromTaskResult(result), "fallback");
assert.deepEqual(chartsFromResult(result).map((chart) => chart.chart_id), ["devices-1"]);

const outcome = outcomeFromTaskResult(result);
assert.equal(outcome?.outcome, "warning");
assert.match(outcome?.reason || "", /降级报告/);

console.log("border-defense history replay tests passed");

const mysqlSql = "SELECT event_level, COUNT(*) AS cnt FROM alarm_event GROUP BY event_level;";
const mysqlSteps = stepsFromTaskResult({
  turns: 1,
  observations: [{
    toolCallId: "mysql-1",
    toolName: "MysqlQuery",
    ok: true,
    output: {
      database: "border-defense",
      sql: mysqlSql,
      rowCount: 1,
      columns: ["event_level", "cnt"],
      rows: [{ event_level: "1", cnt: 3 }],
      durationMs: 5,
    },
  }],
});
const mysqlStep = mysqlSteps.find((step) => step.toolName === "MysqlQuery");
assert.equal(mysqlStep?.input?.sql, mysqlSql, "history replay should restore MysqlQuery SQL");
assert.equal(mysqlStep?.input?.database, "border-defense");

console.log("border-defense MysqlQuery SQL history replay test passed");

const orderedSteps = stepsFromTaskResult({
  turns: 3,
  observations: [
    { toolCallId: "skill-ordered", toolName: "Skill", turn: 0, ok: true, output: { loaded: true } },
    { toolCallId: "schema-ordered", toolName: "MysqlQuerySchema", turn: 1, ok: true, output: { tables: [] } },
    { toolCallId: "query-ordered", toolName: "MysqlQuery", turn: 2, ok: true, output: { rows: [] } },
  ],
});
assert.deepEqual(
  orderedSteps.map((step) => step.name),
  ["Skill", "Agent Turn 1", "MysqlQuerySchema", "Agent Turn 2", "MysqlQuery", "Agent Turn 3"],
  "history replay should interleave tools with their agent turns"
);

const legacyOrderedSteps = stepsFromTaskResult({
  turns: 3,
  observations: [
    { toolCallId: "skill-legacy", toolName: "Skill", ok: true, output: { loaded: true } },
    { toolCallId: "schema-legacy", toolName: "MysqlQuerySchema", ok: true, output: { tables: [] } },
    { toolCallId: "query-legacy", toolName: "MysqlQuery", ok: true, output: { rows: [] } },
  ],
});
assert.deepEqual(
  legacyOrderedSteps.map((step) => step.name),
  ["Skill", "Agent Turn 1", "MysqlQuerySchema", "Agent Turn 2", "MysqlQuery", "Agent Turn 3"],
  "legacy history without turn metadata should use sequential interleaving"
);

console.log("border-defense history turn ordering tests passed");
