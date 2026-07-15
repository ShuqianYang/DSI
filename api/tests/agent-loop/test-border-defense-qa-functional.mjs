import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { buildChartRenderDataTool } = await import(
  "../../src/modules/agent-loop/tools/domain/chartRenderData/chartRenderData.js"
);
const { projectAgentLoopEventToQaBusinessEvents } = await import(
  "../../src/modules/agent-loop/qaBusinessProjection.ts"
);

function context(query) {
  return {
    taskId: "border-defense-qa-functional-test",
    query,
    observations: [],
    onProgress: () => undefined,
  };
}

const questions = {
  chart: "统计本月各级预警数量，并展示图表",
  empty: "查询未来一年预警事件趋势，如果没有数据不要画图",
};

{
  const skill = await readFile(new URL("../../../skills/border-defense-qa/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /默认需要展示图表/, "Skill should require chart rendering by default");
  assert.match(skill, /数据为空时不要画图/, "Skill should skip charts for empty data");
  assert.doesNotMatch(skill, /GisEntityMark/, "Skill should not call GIS entity marking while disabled");
  assert.doesNotMatch(skill, /Required detail fields for auto-linking/, "Skill should not define detail auto-linking fields while disabled");
  assert.doesNotMatch(skill, /data_detail_type/, "Skill should not define detail projection fields while disabled");
}

{
  const chartTool = buildChartRenderDataTool();
  const chart = await chartTool.execute(
    {
      chart_type: "auto",
      title: "本月各级预警数量",
      data: [
        { event_level_name: "一级预警", cnt: 12 },
        { event_level_name: "二级预警", cnt: 8 },
        { event_level_name: "三级预警", cnt: 5 },
      ],
      label_key: "event_level_name",
      value_key: "cnt",
    },
    context(questions.chart),
  );

  assert.equal(chart.chart_type, "pie");
  assert.ok(chart.chart_id.startsWith("chart_"));

  const events = projectAgentLoopEventToQaBusinessEvents({
    type: "tool_observation",
    taskId: "border-defense-qa-functional-test",
    turn: 2,
    toolCallId: "chart-1",
    toolName: "ChartRenderData",
    ok: true,
    observation: {
      toolCallId: "chart-1",
      toolName: "ChartRenderData",
      ok: true,
      output: chart,
    },
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "qa_chart");
  assert.equal(events[0].chart.chart_id, chart.chart_id);
}

{
  const chartTool = buildChartRenderDataTool();
  assert.throws(
    () =>
      chartTool.execute(
        {
          chart_type: "auto",
          title: "空数据趋势",
          data: [],
        },
        context(questions.empty),
      ),
    /ChartRenderData requires non-empty data array/,
    "Empty result data should not be drawable",
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      questions,
      checks: [
        "routes-to-border-defense-qa-skill-rules",
        "non-empty-statistical-data-projects-to-qa_chart",
        "empty-data-is-not-drawable",
        "qa-skill-does-not-enable-detail-or-gis-linkage",
      ],
    },
    null,
    2,
  ),
);
