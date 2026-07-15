import assert from "node:assert/strict";

const {
  buildDailyReportTool,
} = await import("../../src/modules/agent-loop/tools/domain/dailyReport/dailyReport.ts");
const {
  createDailyReportSmokeModelClient,
  getDailyReportTool,
  validateDailyReportSmoke,
} = await import("../../scripts/agent-loop/agent-loop-smoke-daily-report.ts");
const { buildDailyReportSql } = await import(
  "../../src/modules/agent-loop/tools/domain/dailyReport/dailyReportSql.ts"
);

function createContext() {
  return {
    taskId: "daily-report-test-task",
    query: "生成昨天的边防日报",
    observations: [],
  };
}

// Tool registration
{
  const tool = getDailyReportTool();
  assert.equal(tool.name, "DailyReport");
  assert.ok(tool.aliases?.includes("daily-report"));
  assert.ok(tool.aliases?.includes("daily_report"));
  assert.equal(tool.kind, "domain");
  assert.equal(tool.isReadOnly?.({ date: "2026-06-16", report_type: "all" }), false);
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
}

// SQL template variable substitution
{
  const sql = buildDailyReportSql("all", "2025-11-10 00:00:00", "2025-11-10 23:59:59");
  assert.match(sql, /'2025-11-10 00:00:00'/);
  assert.match(sql, /'2025-11-10 23:59:59'/);
  assert.doesNotMatch(sql, /\{start_time\}/);
  assert.doesNotMatch(sql, /\{end_time\}/);
}

// Tool execution fails fast when DB is not configured
{
  const tool = buildDailyReportTool();
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

// Fake model client: first decision calls DailyReport
{
  const client = createDailyReportSmokeModelClient();
  const firstDecision = await client.decide({
    messages: [],
    tools: [],
    query: "生成昨天的边防日报",
    observations: [],
    callId: "call-1",
  });

  assert.equal(firstDecision.type, "tool_calls");
  assert.equal(firstDecision.toolCalls.length, 1);
  assert.equal(firstDecision.toolCalls[0].toolName, "DailyReport");
  assert.equal(firstDecision.toolCalls[0].input.date, "2026-06-16");
  assert.equal(firstDecision.toolCalls[0].input.report_type, "all");
}

// Fake model client: second decision produces final answer after tool observation
{
  const client = createDailyReportSmokeModelClient();
  const finalDecision = await client.decide({
    messages: [],
    tools: [],
    query: "生成昨天的边防日报",
    observations: [
      {
        toolCallId: "daily-report-call-1",
        toolName: "DailyReport",
        ok: true,
        output: {
          date: "2026-06-16",
          report_type: "all",
          report_content: "昨日无异常。",
          charts: [],
        },
      },
    ],
    callId: "call-2",
  });

  assert.equal(finalDecision.type, "final_answer");
  assert.match(finalDecision.content, /2026-06-16/);
  assert.match(finalDecision.content, /昨日无异常/);
}

// Smoke validation: accepts a valid DailyReport observation sequence
{
  const report = validateDailyReportSmoke({
    rawEvents: [
      {
        type: "tool_observation",
        taskId: "task",
        turn: 1,
        toolCallId: "daily-report-call-1",
        toolName: "DailyReport",
        ok: true,
        observation: {
          toolCallId: "daily-report-call-1",
          toolName: "DailyReport",
          ok: true,
          output: {
            date: "2026-06-16",
            report_type: "all",
            report_content: "昨日无异常。",
            charts: [],
          },
        },
      },
    ],
    projectedResult: {
      message: "ok",
      mode: "agent_loop",
      turns: 2,
      stoppedBy: "final_answer",
      observations: [],
    },
  });

  assert.equal(report.date, "2026-06-16");
  assert.equal(report.reportType, "all");
  assert.equal(report.contentLength, 6);
  assert.equal(report.chartCount, 0);
  assert.deepEqual(report.toolOrder, ["DailyReport"]);
}

// Smoke validation: rejects failed observation
{
  assert.throws(
    () =>
      validateDailyReportSmoke({
        rawEvents: [
          {
            type: "tool_observation",
            taskId: "task",
            turn: 1,
            toolCallId: "daily-report-call-1",
            toolName: "DailyReport",
            ok: false,
            observation: {
              toolCallId: "daily-report-call-1",
              toolName: "DailyReport",
              ok: false,
              error: { code: "tool_execution_error", message: "failed" },
            },
          },
        ],
        projectedResult: {
          message: "ok",
          mode: "agent_loop",
          turns: 2,
          stoppedBy: "final_answer",
          observations: [],
        },
      }),
    /DailyReport observation failed/
  );
}

console.log("daily report tool and smoke model client tests passed");
