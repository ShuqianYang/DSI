import assert from "node:assert/strict";

const { buildDailyReportTool } = await import(
  "../../src/modules/agent-loop/tools/domain/dailyReport/dailyReport.ts"
);
const { buildDailyReportSql } = await import(
  "../../src/modules/agent-loop/tools/domain/dailyReport/dailyReportSql.ts"
);
const { getDailyReportFieldLabels, getDailyReportSystemPrompt, resolveDailyReportSkillDir } = await import(
  "../../src/modules/agent-loop/tools/domain/dailyReport/dailyReportResources.ts"
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
  assert.equal(tool.isReadOnly?.({ date: "2026-06-16", report_type: "all" }), false);
  assert.equal(tool.isDestructive?.({ date: "2026-06-16", report_type: "all" }), true);
  assert.equal(tool.isConcurrencySafe?.({ date: "2026-06-16", report_type: "all" }), false);

  const allowed = await tool.checkPermissions?.(
    { date: "2026-06-16", report_type: "all" },
    {
      ...createContext(),
      toolUseContext: { skillAllowedToolNames: new Set(["DailyReport"]) },
    },
  );
  assert.equal(allowed?.behavior, "allow", "the loaded daily-report skill should authorize its artifact write");

  const outsideSkill = await tool.checkPermissions?.(
    { date: "2026-06-16", report_type: "all" },
    createContext(),
  );
  assert.equal(outsideSkill?.behavior, "ask", "DailyReport should still require permission outside its skill");
}

// Input schema validation
{
  const tool = buildDailyReportTool();

  const valid = tool.inputSchema.safeParse({ date: "2026-06-16", report_type: "all" });
  assert.equal(valid.success, true, "DailyReport should accept valid input");

  const defaulted = tool.inputSchema.safeParse({ date: "2026-06-16" });
  assert.equal(defaulted.success, true);
  assert.equal(defaulted.data.report_type, "all");

  const missingDate = tool.inputSchema.safeParse({ report_type: "all" });
  assert.equal(missingDate.success, false, "DailyReport requires date");

  const invalidType = tool.inputSchema.safeParse({ date: "2026-06-16", report_type: "invalid" });
  assert.equal(invalidType.success, false, "DailyReport should reject unknown report_type");

  assert.equal(tool.inputSchema.safeParse({ date: "2026-02-30", report_type: "all" }).success, false);
  assert.equal(tool.inputSchema.safeParse({ date: "2999-01-01", report_type: "all" }).success, false);
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
  const fieldLabels = getDailyReportFieldLabels();
  assert.ok(fieldLabels.all, "all labels should exist");
  assert.ok(fieldLabels.buckle, "buckle labels should exist");
  assert.ok(fieldLabels.event, "event labels should exist");
  assert.ok(fieldLabels.all.total_alarms, "all report should have total_alarms label");
  assert.ok(fieldLabels.buckle.total_access, "buckle report should have total_access label");
  assert.ok(fieldLabels.event.total_alarms, "event report should have total_alarms label");
  assert.match(getDailyReportSystemPrompt("all"), /# 总体日报/);
  assert.match(resolveDailyReportSkillDir(), /border-defense-daily-report$/);
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
      () => tool.execute({ date: "2026-06-16", report_type: "all" }, createContext()),
      /missing required configuration/i,
      "DailyReport should fail fast when DB config is missing"
    );
  } finally {
    process.env.BORDER_DEFENSE_DB_USER = originalUser;
  }
}

console.log("daily report v2 tool tests passed");
