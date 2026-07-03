import assert from "node:assert";
import { buildChartRenderDataTool } from "../../src/modules/agent-loop/tools/domain/chartRenderData/chartRenderData.js";

const tool = buildChartRenderDataTool();

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

async function main() {
  await runTest("tool metadata", () => {
    assert.strictEqual(tool.name, "ChartRenderData");
    assert.strictEqual(tool.kind, "domain");
    assert.strictEqual(tool.isReadOnly(), true);
    assert.strictEqual(tool.isDestructive(), false);
  });

  await runTest("auto recommends pie for few categories", async () => {
    const result = await tool.execute(
      {
        chart_type: "auto",
        data: [
          { level: "一级预警", count: 12 },
          { level: "二级预警", count: 34 },
          { level: "三级预警", count: 56 },
        ],
        title: "预警等级分布",
      },
      { taskId: "test-task", query: "test", observations: [] },
    );

    assert.strictEqual(result.chart_type, "pie");
    assert.strictEqual(result.title, "预警等级分布");
    assert.ok(result.chart_id.startsWith("chart_"));
    assert.strictEqual(result.config.label_key, "level");
    assert.strictEqual(result.config.value_key, "count");
  });

  await runTest("auto recommends bar for many categories", async () => {
    const result = await tool.execute(
      {
        chart_type: "auto",
        data: [
          { name: "A", value: 1 },
          { name: "B", value: 2 },
          { name: "C", value: 3 },
          { name: "D", value: 4 },
          { name: "E", value: 5 },
          { name: "F", value: 6 },
        ],
        title: "分布",
      },
      { taskId: "test-task", query: "test", observations: [] },
    );

    assert.strictEqual(result.chart_type, "bar");
    assert.strictEqual(result.config.x_axis, "name");
    assert.strictEqual(result.config.y_axis, "value");
  });

  await runTest("auto recommends line for time axis", async () => {
    const result = await tool.execute(
      {
        chart_type: "auto",
        data: [
          { date: "2026-01-01", count: 12 },
          { date: "2026-01-02", count: 34 },
        ],
        title: "趋势",
        x_key: "date",
        y_key: "count",
      },
      { taskId: "test-task", query: "test", observations: [] },
    );

    assert.strictEqual(result.chart_type, "line");
    assert.strictEqual(result.config.x_axis, "date");
    assert.strictEqual(result.config.y_axis, "count");
  });

  await runTest("explicit bar type overrides auto", async () => {
    const result = await tool.execute(
      {
        chart_type: "bar",
        data: [
          { level: "一级", count: 1 },
          { level: "二级", count: 2 },
        ],
        title: "手动柱状图",
      },
      { taskId: "test-task", query: "test", observations: [] },
    );

    assert.strictEqual(result.chart_type, "bar");
  });

  await runTest("line chart supports series_keys", async () => {
    const result = await tool.execute(
      {
        chart_type: "line",
        data: [
          { date: "2026-01-01", a: 10, b: 20 },
          { date: "2026-01-02", a: 15, b: 25 },
        ],
        title: "多系列趋势",
        x_key: "date",
        series_keys: ["a", "b"],
      },
      { taskId: "test-task", query: "test", observations: [] },
    );

    assert.strictEqual(result.chart_type, "line");
    assert.deepStrictEqual(result.config.series_keys, ["a", "b"]);
  });

  await runTest("empty data is rejected by schema", async () => {
    let rejected = false;
    try {
      await tool.execute(
        { chart_type: "bar", data: [], title: "空数据" },
        { taskId: "test-task", query: "test", observations: [] },
      );
    } catch {
      rejected = true;
    }
    assert.strictEqual(rejected, true, "Expected empty data to be rejected");
  });

  console.log("chart render data tool tests passed");
}

main().catch((error) => {
  console.error("chart render data tool tests failed");
  console.error(error);
  process.exit(1);
});
