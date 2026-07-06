import { Router, type Request, type Response, type Router as ExpressRouter } from "express";
import { eq } from "drizzle-orm";
import path from "node:path";
import { asyncHandler } from "../../middleware/errorHandler.js";
import { validateBody, validateParams } from "../../middleware/validate.js";
import { createTaskSchema, getTaskParamsSchema } from "./schema.js";
import { createTask, getTask, listTasks } from "./controller.js";
import { addSseClient, removeSseClient } from "../../sse/sseManager.js";
import { db } from "../../config/database.js";
import { tasks } from "../../db/schema.js";
import { buildLoopStopEventFromTaskResult } from "./agentLoopSseMode.js";
import { generateDailyReportDocx, readCachedDailyReportDocx } from "../agent-loop/tools/domain/dailyReport/dailyReportDownloader.js";
import type { DailyReportOutput } from "../agent-loop/tools/domain/dailyReport/dailyReportTypes.js";

const REPORT_OUTPUT_DIR = process.env.DAILY_REPORT_OUTPUT_DIR || "api/tmp/agent-loop/reports";

const router: ExpressRouter = Router();

router.post("/", validateBody(createTaskSchema), asyncHandler(createTask));
router.get("/", asyncHandler(listTasks));
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

router.get("/:taskId/daily-report/download", validateParams(getTaskParamsSchema), asyncHandler(async (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  if (task.status !== "completed") {
    res.status(400).json({ error: "Task is not completed yet" });
    return;
  }

  const outputDir = path.resolve(REPORT_OUTPUT_DIR);

  // Try to find a cached docx for this task
  const cachedFilename = task.result
    ? Object.keys(task.result as Record<string, unknown>).find((key) => key.endsWith(".docx"))
    : undefined;

  if (cachedFilename) {
    const cached = await readCachedDailyReportDocx(outputDir, cachedFilename);
    if (cached) {
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${cachedFilename}"`);
      res.send(cached);
      return;
    }
  }

  // Find DailyReport observation in task result
  const result = task.result || {};
  const observations = Object.values(result) as Record<string, unknown>[];
  const dailyReportObservation = observations.find(
    (obs) => obs && typeof obs === "object" && (obs.metadata as Record<string, unknown>)?.toolName === "DailyReport" && obs.success === true
  );

  if (!dailyReportObservation) {
    res.status(400).json({ error: "No daily report found in task result" });
    return;
  }

  const report = (dailyReportObservation.data ?? dailyReportObservation) as DailyReportOutput;
  if (!report.report_content || !report.date || !report.report_type) {
    res.status(400).json({ error: "Invalid daily report data" });
    return;
  }

  const { buffer, filename } = await generateDailyReportDocx({ report, taskId, outputDir });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}));

export default router;
