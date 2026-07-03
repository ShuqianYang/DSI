import assert from "node:assert/strict";

const { buildDailyReportTool } = await import(
  "../../src/modules/agent-loop/tools/domain/dailyReport/dailyReport.ts"
);
const { buildDailyReportSql } = await import(
  "../../src/modules/agent-loop/tools/domain/dailyReport/dailyReportSql.ts"
);
const { FIELD_LABELS } = await import(
  "../../src/modules/agent-loop/tools/domain/dailyReport/dailyReportTypes.ts"
);

function createContext() {
  return {
    taskId: "daily-report-v2-test-task",
    query: "生成昨天的边防日报",
    observations: [],
  };
}

// Tool registration and metadata
{
  const tool = buildDailyReportTool();
  assert.equal(tool.name, "DailyReport");
  assert.ok(tool.aliases?.includes("daily-report"));
  assert.ok(tool.aliases?.includes("daily_report"));
  assert.equal(tool.kind, "domain");
  assert.equal(tool.isReadOnly?.({ query: "昨天", report_type: "all" }), true);
  assert.equal(tool.isDestructive?.({ query: "昨天", report_type: "all" }), false);
  assert.equal(tool.isConcurrencySafe?.({ query: "昨天", report_type: "all" }), true);
}

// Input schema validation
{
  const tool = buildDailyReportTool();

  const valid = tool.inputSchema.safeParse({ query: "今天", report_type: "all" });
  assert.equal(valid.success, true, "DailyReport should accept valid input");

  const defaulted = tool.inputSchema.safeParse({ query: "今天" });
  assert.equal(defaulted.success, true);
  assert.equal(defaulted.data.report_type, "all");

  const missingQuery = tool.inputSchema.safeParse({ report_type: "all" });
  assert.equal(missingQuery.success, false, "DailyReport requires query");

  const invalidType = tool.inputSchema.safeParse({ query: "今天", report_type: "invalid" });
  assert.equal(invalidType.success, false, "DailyReport should reject unknown report_type");
}

// SQL template variable substitution
{
  const sql = buildDailyReportSql("all", "2025-11-10 00:00:00", "2025-11-10 23:59:59");
  assert.match(sql, /'2025-11-10 00:00:00'/);
  assert.match(sql, /'2025-11-10 23:59:59'/);
  assert.doesNotMatch(sql, /\{start_time\}/);
  assert.doesNotMatch(sql, /\{end_time\}/);
}

// SQL templates for each report type
{
  const allSql = buildDailyReportSql("all", "2025-01-01 00:00:00", "2025-01-01 23:59:59");
  const buckleSql = buildDailyReportSql("buckle", "2025-01-01 00:00:00", "2025-01-01 23:59:59");
  const eventSql = buildDailyReportSql("event", "2025-01-01 00:00:00", "2025-01-01 23:59:59");

  assert.ok(allSql.includes("buckle_traffic"), "all report should include buckle traffic");
  assert.ok(buckleSql.includes("buckle_access_record"), "buckle report should query buckle records");
  assert.ok(!buckleSql.includes("core_stats"), "buckle report should not include core_stats");
  assert.ok(eventSql.includes("core_stats"), "event report should include core_stats");
  assert.ok(!eventSql.includes("buckle_traffic"), "event report should not include buckle_traffic");
}

// Field labels cover all report types
{
  assert.ok(FIELD_LABELS.all, "all labels should exist");
  assert.ok(FIELD_LABELS.buckle, "buckle labels should exist");
  assert.ok(FIELD_LABELS.event, "event labels should exist");
  assert.ok(FIELD_LABELS.all.total_alarms, "all report should have total_alarms label");
  assert.ok(FIELD_LABELS.buckle.total_access, "buckle report should have total_access label");
  assert.ok(FIELD_LABELS.event.total_alarms, "event report should have total_alarms label");
}

// Tool execution fallback when DB is unavailable
{
  const tool = buildDailyReportTool();
  // Without BORDER_DEFENSE_DB_USER set, the tool should throw a clear error
  // instead of hanging or returning invalid data.
  const originalUser = process.env.BORDER_DEFENSE_DB_USER;
  process.env.BORDER_DEFENSE_DB_USER = "";

  try {
    await assert.rejects(
      () => tool.execute({ query: "今天", report_type: "all" }, createContext()),
      /missing required configuration/i,
      "DailyReport should fail fast when DB config is missing"
    );
  } finally {
    process.env.BORDER_DEFENSE_DB_USER = originalUser;
  }
}

console.log("daily report v2 tool tests passed");
