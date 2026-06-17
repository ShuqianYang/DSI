import assert from "node:assert/strict";

const {
  buildDailyReportTool,
} = await import("../../src/modules/agent-loop/tools/domain/dailyReport/dailyReport.ts");
const {
  createDailyReportSmokeModelClient,
  installMockDailyReportFetch,
  getDailyReportTool,
  validateDailyReportSmoke,
} = await import("../../scripts/agent-loop/agent-loop-smoke-daily-report.ts");

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
  assert.equal(tool.isReadOnly?.({ query: "昨天", report_type: "all" }), true);
}

// Input schema validation
{
  const tool = buildDailyReportTool();

  const valid = tool.inputSchema.safeParse({ query: "今天", report_type: "设备监控" });
  assert.equal(valid.success, true, "DailyReport should accept valid input");

  const defaulted = tool.inputSchema.safeParse({ query: "今天" });
  assert.equal(defaulted.success, true);
  assert.equal(defaulted.data.report_type, "all");

  const missingQuery = tool.inputSchema.safeParse({ report_type: "all" });
  assert.equal(missingQuery.success, false, "DailyReport requires query");

  const invalidType = tool.inputSchema.safeParse({ query: "今天", report_type: "invalid" });
  assert.equal(invalidType.success, false, "DailyReport should reject unknown report_type");
}

// Successful tool execution with mocked SSE API
{
  const tool = buildDailyReportTool();
  const restoreFetch = installMockDailyReportFetch({
    reportContent: "昨日边境总体平稳，设备运行正常。",
  });

  try {
    const output = await tool.execute({ query: "昨天", report_type: "all" }, createContext());

    assert.match(output.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(output.report_type, "all");
    assert.ok(output.report_content.includes("昨日边境总体平稳"));
    assert.equal(output.source, "daily-report-api");
    assert.ok(output.executionTime >= 0);
  } finally {
    restoreFetch();
  }
}

// Report type mapping preserved
{
  const tool = buildDailyReportTool();
  const restoreFetch = installMockDailyReportFetch({ reportContent: "设备监控报告" });

  try {
    const output = await tool.execute(
      { query: "2025-06-01", report_type: "设备监控" },
      createContext()
    );
    assert.equal(output.report_type, "设备监控");
    assert.equal(output.date, "2025-06-01");
  } finally {
    restoreFetch();
  }
}

// Network failure handling
{
  const tool = buildDailyReportTool();
  const restoreFetch = installMockDailyReportFetch({ networkError: true });

  try {
    await assert.rejects(
      () => tool.execute({ query: "今天", report_type: "all" }, createContext()),
      /日报生成服务调用失败/,
      "DailyReport should surface API failures in Chinese"
    );
  } finally {
    restoreFetch();
  }
}

// HTTP error handling
{
  const tool = buildDailyReportTool();
  const restoreFetch = installMockDailyReportFetch({ httpStatus: 500 });

  try {
    await assert.rejects(
      () => tool.execute({ query: "今天", report_type: "all" }, createContext()),
      /Daily report API error: 500/,
      "DailyReport should fail on HTTP errors"
    );
  } finally {
    restoreFetch();
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
  assert.equal(firstDecision.toolCalls[0].input.query, "昨天");
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
