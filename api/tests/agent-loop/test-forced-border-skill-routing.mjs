import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.AGENT_WORKSPACE_ROOT = path.resolve(__dirname, "..", "..", "..");

const {
  getCompletedForcedDailyReportContent,
  hasCompletedForcedDailyReport,
  runAgentLoopEvents,
} = await import("../../src/modules/agent-loop/runAgentLoop.ts");
const { buildDefaultToolRegistry } = await import("../../src/modules/agent-loop/tools/_shared/toolRegistry.ts");

const contextProvider = {
  async getUserContext() { return {}; },
  async getSystemContext() { return {}; },
  async getContextSections() { return []; },
};

async function captureTools(forcedSkillId, query) {
  let visibleTools = [];
  let promptText = "";
  const modelClient = {
    async decide(input) {
      visibleTools = input.tools.map((tool) => tool.name);
      promptText = input.messages.map((message) => message.content).join("\n");
      return { type: "final_answer", content: "完成" };
    },
  };

  for await (const _event of runAgentLoopEvents({
    taskId: crypto.randomUUID(),
    query,
    scenarioId: "border",
    forcedSkillId,
    registry: buildDefaultToolRegistry(),
    modelClient,
    contextProvider,
    fileLogger: false,
    maxTurns: 1,
  })) {
    // Consume the complete loop.
  }
  return { visibleTools, promptText };
}

const qa = await captureTools("border-defense-qa", "统计本月各级预警数量");
assert.ok(qa.visibleTools.includes("MysqlQuery"));
assert.ok(qa.visibleTools.includes("ChartRenderData"));
assert.ok(!qa.visibleTools.includes("DailyReport"));
assert.ok(!qa.visibleTools.includes("Skill"), "forced route must not allow switching skills");
assert.match(qa.promptText, /Loaded skill: border-defense-qa/);

const daily = await captureTools("border-defense-daily-report", "生成 2026-07-11 总体日报");
assert.ok(daily.visibleTools.includes("DailyReport"));
assert.ok(!daily.visibleTools.includes("MysqlQuery"));
assert.ok(!daily.visibleTools.includes("Skill"), "forced route must not allow switching skills");
assert.match(daily.promptText, /Loaded skill: border-defense-daily-report/);

const completedDailyReport = [{
  toolCallId: "daily-report-call",
  toolName: "DailyReport",
  ok: true,
  output: { report_content: "# Daily report" },
}];
assert.equal(
  hasCompletedForcedDailyReport("border-defense-daily-report", completedDailyReport),
  true,
  "a successful forced DailyReport must terminate the loop immediately",
);
assert.equal(
  getCompletedForcedDailyReportContent("border-defense-daily-report", completedDailyReport),
  "# Daily report",
  "the forced route final answer must be the complete report body",
);
assert.equal(
  hasCompletedForcedDailyReport("border-defense-qa", completedDailyReport),
  false,
  "QA tasks must keep their normal loop lifecycle",
);
assert.equal(
  hasCompletedForcedDailyReport("border-defense-daily-report", [{
    ...completedDailyReport[0],
    ok: false,
  }]),
  false,
  "a failed DailyReport must not be marked complete",
);
assert.equal(
  hasCompletedForcedDailyReport("border-defense-daily-report", [{
    ...completedDailyReport[0],
    output: { report_content: "" },
  }]),
  false,
  "an empty DailyReport body must not be marked complete",
);

console.log("forced border skill routing test passed");
