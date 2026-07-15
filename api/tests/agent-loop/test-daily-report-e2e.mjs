import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.resolve(__dirname, "../../../tmp/test-daily-report-e2e");

const originalOutputDir = process.env.DAILY_REPORT_OUTPUT_DIR;
const originalModelKey = process.env.DAILY_REPORT_MODEL_API_KEY;
const originalQwenKey = process.env.QWEN_API_KEY;

process.env.DAILY_REPORT_OUTPUT_DIR = outputDir;
process.env.DAILY_REPORT_MODEL_API_KEY = "";
process.env.QWEN_API_KEY = "";

const {
  buildDailyReportTool,
  setCreateConnectionOverride,
} = await import("../../src/modules/agent-loop/tools/domain/dailyReport/dailyReport.ts");
const {
  generateDailyReportDocx,
} = await import("../../src/modules/agent-loop/tools/domain/dailyReport/dailyReportDownloader.ts");

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });

let executedSql = "";

setCreateConnectionOverride(async () => ({
  async execute(sql) {
    executedSql = String(sql);
    return [[
      {
        total_alarms: 12,
        valid_intrusion: 5,
        handle_rate: "83.33%",
        avg_handle_seconds: 320,
        sla_rate: "91.67%",
        device_total: 8,
        online_count: 7,
        offline_count: 1,
        online_rate: "87.50%",
        top1_name: "一号点位",
        top1_count: 5,
        top2_name: "二号点位",
        top2_count: 4,
        top3_name: "三号点位",
        top3_count: 3,
        most_freq_device: "一号摄像头",
        most_freq_count: 5,
        level1_count: 5,
        level1_ratio: "41.67%",
        level1_avg_sec: 240,
        level2_count: 4,
        level2_ratio: "33.33%",
        level2_avg_sec: 360,
        level3_count: 3,
        level3_ratio: "25.00%",
        peak_start_hour: 8,
        peak_end_hour: 9,
        peak_count: 6,
        total_access: 30,
        person_times: 18,
        vehicle_times: 12,
        normal_entry: 20,
        normal_leave: 8,
        reject_entry: 2,
        black_count: 1,
        black_objects: 1,
        stranger_count: 3,
        stranger_objects: 3,
        white_count: 26,
        white_objects: 20,
        stay_cnt: 2,
        curr_stay_cnt: 1,
        top5_busy_buckle: JSON.stringify([
          { buckle_id: "buckle-1", buckle_name: "一号卡口", total_access_count: 20 },
          { buckle_id: "buckle-2", buckle_name: "二号卡口", total_access_count: 10 },
        ]),
      },
    ]];
  },
  async end() {
    return undefined;
  },
}));

try {
  const tool = buildDailyReportTool();
  const report = await tool.execute(
    { date: "2026-06-16", report_type: "all" },
    {
      taskId: "daily-report-e2e-task",
      query: "生成 2026-06-16 总体日报",
      observations: [],
      onProgress: () => undefined,
    },
  );

  assert.match(executedSql, /'2026-06-16 00:00:00'/);
  assert.match(executedSql, /'2026-06-16 23:59:59'/);
  assert.equal(report.date, "2026-06-16");
  assert.equal(report.report_type, "all");
  assert.ok(report.report_content.includes("总体日报"), "fallback markdown should include report title");
  assert.ok(report.report_content.includes("chart://"), "markdown should include chart placeholders");
  assert.ok(report.charts.length >= 2, "all report should include level and buckle charts");
  assert.ok(report.markdown_filename?.endsWith(".md"), "markdown artifact should be saved");

  const markdownPath = path.join(outputDir, report.markdown_filename);
  const markdown = await fs.readFile(markdownPath, "utf8");
  assert.equal(markdown, report.report_content);

  const { buffer, filename, contentType } = await generateDailyReportDocx({
    report,
    taskId: "daily-report-e2e-task",
    outputDir,
  });

  assert.ok(buffer.length > 0, "docx buffer should not be empty");
  assert.ok(filename.endsWith(".docx"));
  assert.equal(contentType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

  const files = await fs.readdir(outputDir);
  assert.ok(files.includes(filename), "docx should be written");
  assert.ok(files.some((file) => file.endsWith(".png")), "chart PNG files should be written");
} finally {
  setCreateConnectionOverride(undefined);
  if (originalOutputDir === undefined) {
    delete process.env.DAILY_REPORT_OUTPUT_DIR;
  } else {
    process.env.DAILY_REPORT_OUTPUT_DIR = originalOutputDir;
  }
  if (originalModelKey === undefined) {
    delete process.env.DAILY_REPORT_MODEL_API_KEY;
  } else {
    process.env.DAILY_REPORT_MODEL_API_KEY = originalModelKey;
  }
  if (originalQwenKey === undefined) {
    delete process.env.QWEN_API_KEY;
  } else {
    process.env.QWEN_API_KEY = originalQwenKey;
  }
  await fs.rm(outputDir, { recursive: true, force: true });
}

console.log("daily report e2e test passed");
