import { Router, type Request, type Response, type Router as ExpressRouter } from "express";
import { eq } from "drizzle-orm";
import path from "node:path";
import fs from "node:fs/promises";
import { asyncHandler } from "../../middleware/errorHandler.js";
import { validateBody, validateParams } from "../../middleware/validate.js";
import { createTaskSchema, getTaskArtifactParamsSchema, getTaskParamsSchema } from "./schema.js";
import { createTask, getTask, listTasks, abortTask } from "./controller.js";
import { addSseClient, removeSseClient } from "../../sse/sseManager.js";
import { db } from "../../config/database.js";
import { tasks } from "../../db/schema.js";
import { buildLoopStopEventFromTaskResult } from "./agentLoopSseMode.js";
import { generateDailyReportDocx } from "../agent-loop/tools/domain/dailyReport/dailyReportDownloader.js";
import { generateChartPng } from "../agent-loop/tools/domain/chartRenderData/chartPngGenerator.js";
import type { ChartRenderDataOutput, DailyReportOutput } from "../agent-loop/tools/domain/dailyReport/dailyReportTypes.js";
import { resolveDailyReportOutputDir } from "../agent-loop/tools/domain/dailyReport/reportOutputDir.js";

const REPORT_OUTPUT_DIR = resolveDailyReportOutputDir();

const router: ExpressRouter = Router();

router.post("/", validateBody(createTaskSchema), asyncHandler(createTask));
router.get("/", asyncHandler(listTasks));
router.post("/:taskId/abort", validateParams(getTaskParamsSchema), asyncHandler(abortTask));

router.get("/:taskId", validateParams(getTaskParamsSchema), asyncHandler(getTask));

router.get("/:taskId/stream", async (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  res.write(`data: ${JSON.stringify({ type: "connected", taskId })}\n\n`);
  addSseClient(taskId, res);

  try {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task) return;

    const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

    if (task.status === "completed" || task.status === "failed") {
      const loopStopEvent = buildLoopStopEventFromTaskResult({
        taskId,
        status: task.status,
        result: task.result,
        error: task.error,
      });

      if (loopStopEvent) {
        res.write(`data: ${JSON.stringify(loopStopEvent)}\n\n`);
        await flush();
      }
    }
  } catch {
    // Best-effort replay only. Live task updates still flow through addSseClient.
  }

  req.on("close", () => {
    removeSseClient(taskId, res);
    res.end();
  });
});

router.get("/:taskId/artifacts/:artifactId", validateParams(getTaskArtifactParamsSchema), asyncHandler(async (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const artifactId = req.params.artifactId as string;

  const task = await loadCompletedTask(taskId, res);
  if (!task) return;

  const report = findDailyReportOutput(task.result);
  if (!report) {
    res.status(400).json({ error: "No daily report artifact found for task" });
    return;
  }

  const outputDir = path.resolve(REPORT_OUTPUT_DIR);
  await fs.mkdir(outputDir, { recursive: true });

  if (artifactId === "daily-report.docx" || artifactId === "report.docx") {
    const { buffer, filename } = await generateDailyReportDocx({ report, taskId, outputDir });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
    return;
  }

  if (artifactId === "daily-report.md" || artifactId === "report.md" || artifactId === reportRecord(report).markdown_filename) {
    const filename = typeof reportRecord(report).markdown_filename === "string"
      ? reportRecord(report).markdown_filename
      : `${report.date}_${report.report_type}_${taskId}.md`;
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(report.report_content);
    return;
  }

  if (artifactId.endsWith(".png")) {
    const chartId = artifactId.slice(0, -".png".length);
    const chart = report.charts.find((item) => item.chart_id === chartId);
    if (!chart) {
      res.status(404).json({ error: "Chart artifact not found" });
      return;
    }

    const filename = `${report.date}_${report.report_type}_${taskId}_${chart.chart_id}.png`;
    const filePath = path.join(outputDir, filename);
    // Always regenerate from the task's chart data. Older cached files may be
    // the invalid 160-byte fallback produced when native canvas was missing.
    const buffer = await generateChartPng(chart as ChartRenderDataOutput);
    await fs.writeFile(filePath, buffer);

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.send(buffer);
    return;
  }

  res.status(404).json({ error: "Unsupported artifact id" });
}));

router.get("/:taskId/daily-report/download", validateParams(getTaskParamsSchema), asyncHandler(async (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;

  const task = await loadCompletedTask(taskId, res);
  if (!task) return;

  const outputDir = path.resolve(REPORT_OUTPUT_DIR);

  // Find DailyReport observation in task result
  const report = findDailyReportOutput(task.result);
  if (!report) {
    res.status(400).json({ error: "No daily report found in task result" });
    return;
  }

  if (!report.report_content || !report.date || !report.report_type) {
    res.status(400).json({ error: "Invalid daily report data" });
    return;
  }

  const { buffer, filename } = await generateDailyReportDocx({ report, taskId, outputDir });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}));

async function loadCompletedTask(taskId: string, res: Response) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return undefined;
  }

  if (task.status !== "completed") {
    res.status(400).json({ error: "Task is not completed yet" });
    return undefined;
  }

  return task;
}

function findDailyReportOutput(result: unknown): DailyReportOutput | undefined {
  const record = isRecord(result) ? result : {};
  const observations = Array.isArray(record.observations)
    ? record.observations
    : Object.values(record);

  for (const value of observations) {
    const observation = isRecord(value) ? value : {};
    const metadata = isRecord(observation.metadata) ? observation.metadata : {};
    const output = isRecord(observation.output)
      ? observation.output
      : isRecord(observation.data)
        ? observation.data
        : observation;

    if (
      (observation.toolName === "DailyReport" || metadata.toolName === "DailyReport") &&
      output.report_content &&
      output.date &&
      output.report_type
    ) {
      return {
        ...output,
        charts: Array.isArray(output.charts) ? output.charts : [],
      } as unknown as DailyReportOutput;
    }
  }

  return undefined;
}

function reportRecord(report: DailyReportOutput): Record<string, unknown> {
  return report as unknown as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export default router;
