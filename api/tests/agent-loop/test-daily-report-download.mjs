import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateChartPng } from "../../src/modules/agent-loop/tools/domain/chartRenderData/chartPngGenerator.js";
import { generateDailyReportDocx } from "../../src/modules/agent-loop/tools/domain/dailyReport/dailyReportDownloader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testOutputDir = path.resolve(__dirname, "../../../tmp/test-daily-report-download");

async function cleanup() {
  try {
    await fs.rm(testOutputDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

await cleanup();

// Test 1: generateChartPng for bar chart
{
  const chart = {
    chart_type: "bar",
    title: "卡口繁忙度Top5",
    chart_id: "chart_bar_test",
    data: [
      { buckle_name: "A卡口", count: 256 },
      { buckle_name: "B卡口", count: 198 },
      { buckle_name: "C卡口", count: 120 },
    ],
    config: { x_axis: "buckle_name", y_axis: "count" },
  };

  const buffer = await generateChartPng(chart);
  assert.ok(buffer.length > 0, "PNG buffer should not be empty");
  assert.equal(buffer[0], 0x89, "PNG buffer should start with PNG magic bytes");

  const pngPath = path.join(testOutputDir, "test-bar.png");
  await fs.mkdir(testOutputDir, { recursive: true });
  await fs.writeFile(pngPath, buffer);
}

// Test 2: generateChartPng for pie chart
{
  const chart = {
    chart_type: "pie",
    title: "预警等级占比",
    chart_id: "chart_pie_test",
    data: [
      { level: "一级预警", count: 5 },
      { level: "二级预警", count: 6 },
      { level: "三级预警", count: 4 },
    ],
    config: { label_key: "level", value_key: "count" },
  };

  const buffer = await generateChartPng(chart);
  assert.ok(buffer.length > 0, "PNG buffer should not be empty");
}

// Test 3: generateDailyReportDocx
{
  const report = {
    date: "2026-06-16",
    report_type: "all",
    report_content: `# 总体日报
**统计周期： 2026年06月16日 00:00 - 2026年06月16日 23:59**

## 一、核心指标概览
本周期内，系统共捕获预警事件 12 起。

![预警等级占比](chart://chart_pie_docx)

## 二、卡口往来数据分析
![卡口繁忙度Top5](chart://chart_bar_docx)
`,
    charts: [
      {
        chart_type: "pie",
        title: "预警等级占比",
        chart_id: "chart_pie_docx",
        data: [
          { level: "一级预警", count: 5 },
          { level: "二级预警", count: 4 },
          { level: "三级预警", count: 3 },
        ],
        config: { label_key: "level", value_key: "count" },
      },
      {
        chart_type: "bar",
        title: "卡口繁忙度Top5",
        chart_id: "chart_bar_docx",
        data: [
          { buckle_name: "A卡口", count: 256 },
          { buckle_name: "B卡口", count: 198 },
        ],
        config: { x_axis: "buckle_name", y_axis: "count" },
      },
    ],
    executionTime: 100,
    source: "daily-report-local",
  };

  const { buffer, filename, contentType } = await generateDailyReportDocx({
    report,
    taskId: "test-task-id",
    outputDir: testOutputDir,
  });

  assert.ok(buffer.length > 0, "DOCX buffer should not be empty");
  assert.ok(filename.endsWith(".docx"), "filename should end with .docx");
  assert.equal(
    contentType,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "contentType should be docx"
  );

  const docxPath = path.join(testOutputDir, filename);
  await fs.writeFile(docxPath, buffer);

  const files = await fs.readdir(testOutputDir);
  assert.ok(files.includes(filename), "docx file should be saved");
  assert.ok(files.some((f) => f.endsWith(".png")), "png chart files should be saved");
}

// Test 4: report cleanup
{
  const { cleanOldReports } = await import("../../src/modules/agent-loop/tools/domain/dailyReport/reportCleanupJob.js");

  // Create an old file
  const oldFile = path.join(testOutputDir, "old-report.md");
  await fs.writeFile(oldFile, "old");
  const oldStats = await fs.stat(oldFile);
  const oldTime = new Date(oldStats.mtimeMs - 31 * 24 * 60 * 60 * 1000);
  await fs.utimes(oldFile, oldTime, oldTime);

  await cleanOldReports(testOutputDir, 30);

  const filesAfterCleanup = await fs.readdir(testOutputDir);
  assert.ok(!filesAfterCleanup.includes("old-report.md"), "old report should be deleted");
}

await cleanup();

console.log("daily report download and chart PNG tests passed");
