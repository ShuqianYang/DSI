import { Router, type Request, type Response, type Router as ExpressRouter } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/errorHandler.js";
import * as taskService from "../tasks/service.js";
import { runAgentPipeline } from "../tasks/pipeline.js";
import { extractRequestMetadata } from "../observability/requestMetadata.js";
import { DailyReportDateSchema, DailyReportTypeSchema } from "./tools/domain/dailyReport/dailyReportInput.js";

const QaRequestSchema = z.object({
  query: z.string().trim().min(1),
  userId: z.string().trim().min(1).optional(),
  clientRequestId: z.string().uuid().optional(),
});

const DailyReportRequestSchema = z.object({
  date: DailyReportDateSchema,
  report_type: DailyReportTypeSchema.default("all"),
  userId: z.string().trim().min(1).optional(),
  clientRequestId: z.string().uuid().optional(),
});

const router: ExpressRouter = Router();

router.post("/intelligent-qa", asyncHandler(async (req: Request, res: Response) => {
  const parsed = QaRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      status: "failed",
      error: "Invalid QA request.",
      details: parsed.error.flatten(),
    });
    return;
  }

  const body = {
    query: buildQaQuery(parsed.data.query),
    scenarioId: "border" as const,
    forcedSkillId: "border-defense-qa" as const,
    ...(parsed.data.userId ? { userId: parsed.data.userId } : {}),
    ...(parsed.data.clientRequestId ? { clientRequestId: parsed.data.clientRequestId } : {}),
  };

  const { task, created } = await taskService.createTaskOnce(body);
  const responseBody = {
    taskId: task.id,
    status: task.status,
    reused: !created,
  };
  res.status(202).json(responseBody);
  console.log(`[BorderDefense][QA] POST /api/agent/intelligent-qa -> 202 ${JSON.stringify(responseBody)}`);

  if (!created) return;

  void runAgentPipeline(task.id, body, extractRequestMetadata(req))
    .then(() => logDedicatedTaskResult("QA", task.id))
    .catch((error) => {
      console.error(`[BorderDefense][QA] Pipeline error for task ${task.id}:`, error);
    });
}));

router.post("/daily-report", asyncHandler(async (req: Request, res: Response) => {
  const parsed = DailyReportRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      status: "failed",
      error: "Invalid daily report request.",
      details: parsed.error.flatten(),
    });
    return;
  }

  const body = {
    query: buildDailyReportQuery(parsed.data.date, parsed.data.report_type),
    scenarioId: "border" as const,
    forcedSkillId: "border-defense-daily-report" as const,
    ...(parsed.data.userId ? { userId: parsed.data.userId } : {}),
    ...(parsed.data.clientRequestId ? { clientRequestId: parsed.data.clientRequestId } : {}),
  };

  const { task, created } = await taskService.createTaskOnce(body);
  const responseBody = {
    taskId: task.id,
    status: task.status,
    reused: !created,
  };
  res.status(202).json(responseBody);
  console.log(`[BorderDefense][DailyReport] POST /api/agent/daily-report -> 202 ${JSON.stringify(responseBody)}`);

  if (!created) return;

  void runAgentPipeline(task.id, body, extractRequestMetadata(req))
    .then(() => logDedicatedTaskResult("DailyReport", task.id))
    .catch((error) => {
      console.error(`[BorderDefense][DailyReport] Pipeline error for task ${task.id}:`, error);
    });
}));

async function logDedicatedTaskResult(channel: "QA" | "DailyReport", taskId: string): Promise<void> {
  try {
    const task = await taskService.getTaskById(taskId);
    if (!task) {
      console.warn(`[BorderDefense][${channel}] Task ${taskId} finished but could not be reloaded.`);
      return;
    }

    const result = isRecord(task.result) ? task.result : {};
    const answer = typeof result.message === "string" ? result.message : "";
    const stoppedBy = typeof result.stoppedBy === "string" ? result.stoppedBy : "unknown";
    console.log(
      `[BorderDefense][${channel}] Task ${taskId} finished status=${task.status} stoppedBy=${stoppedBy}\n` +
      `response=${previewForConsole(answer || task.error || "(empty response)")}`
    );
  } catch (error) {
    console.warn(
      `[BorderDefense][${channel}] Task ${taskId} finished, but result logging failed:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

function previewForConsole(value: string, maxLength = 4000): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n… response truncated` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildQaQuery(query: string): string {
  return `边防数据智能问答（不要生成日报）：${query}`;
}

function buildDailyReportQuery(query: string, reportType: "all" | "buckle" | "event"): string {
  const reportTypeName = reportType === "all" ? "总体" : reportType === "buckle" ? "卡口/设备监控" : "预警事态";
  return `生成边防日报。日期或时间范围：${query}。报告类型：${reportTypeName}，report_type=${reportType}。`;
}

export default router;
