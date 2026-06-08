import { Router, type Request, type Response, type Router as ExpressRouter } from "express";
import { eq } from "drizzle-orm";
import { asyncHandler } from "../../middleware/errorHandler.js";
import { validateBody, validateParams } from "../../middleware/validate.js";
import { createTaskSchema, getTaskParamsSchema } from "./schema.js";
import { createTask, getTask, listTasks } from "./controller.js";
import { addSseClient, removeSseClient, notifyTaskUpdate } from "../../sse/sseManager.js";
import { db } from "../../config/database.js";
import { tasks, taskSteps } from "../../db/schema.js";
import { createLegacyStepUpdateFromTaskStep } from "./agentLoopEventAdapter.js";

const router: ExpressRouter = Router();

router.post("/", validateBody(createTaskSchema), asyncHandler(createTask));
router.get("/", asyncHandler(listTasks));
router.get("/:taskId", validateParams(getTaskParamsSchema), asyncHandler(getTask));

// SSE 端点：实时推送任务执行进度
router.get("/:taskId/stream", async (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  // 发送初始连接确认
  res.write(`data: ${JSON.stringify({ type: "connected", taskId })}\n\n`);

  addSseClient(taskId, res);

  // 补推当前状态（解决 Pipeline 执行快于 SSE 连接建立的竞态问题）
  try {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task) return;

    const flush = () => new Promise((r) => setTimeout(r, 50));

    // 已有 plan → 补推 planning + planning_done
    const plan = task.plan as Record<string, unknown> | null;
    if (plan) {
      res.write(`data: ${JSON.stringify({ type: "planning", stage: "planner", message: "正在分析用户意图并生成执行计划..." })}\n\n`);
      await flush();
      res.write(`data: ${JSON.stringify({
        type: "planning_done",
        taskId,
        plan: {
          goal: plan.goal,
          reasoning: plan.reasoning,
          steps: (plan.steps as Array<{ id: string; description: string; purpose: string }> || []).map((s) => ({
            id: s.id,
            description: s.description,
            purpose: s.purpose,
          })),
          scenario: plan.scenario,
          thinkingChain: plan.thinkingChain,
          subtasks: plan.subtasks,
          mainTask: plan.mainTask,
          finalEvent: plan.finalEvent,
        },
      })}\n\n`);
      await flush();
    }

    // 已有 actions → 补推 routing + routing_done
    const actions = task.actions as Array<{ id: string; type: string; name: string; description: string; params: Record<string, unknown>; dependsOn?: string[] }> | null;
    if (actions) {
      res.write(`data: ${JSON.stringify({ type: "routing", stage: "router", message: "正在决策执行工具..." })}\n\n`);
      await flush();
      res.write(`data: ${JSON.stringify({
        type: "routing_done",
        taskId,
        actions: actions.map((a) => ({
          id: a.id,
          type: a.type,
          name: a.name,
          description: a.description,
          params: a.params,
          dependsOn: a.dependsOn,
        })),
      })}\n\n`);
      await flush();
    }

    // 已有 steps → 补推已完成的 step_update（解决 step 执行快于 SSE 连接的竞态问题）
    const steps = await db.select().from(taskSteps).where(eq(taskSteps.taskId, taskId));
    const completedSteps = steps
      .filter((s) => s.status === "completed" || s.status === "failed")
      .sort((a, b) => {
        const orderA = (a.actionConfig as Record<string, unknown>)?._order as number ?? 0;
        const orderB = (b.actionConfig as Record<string, unknown>)?._order as number ?? 0;
        return orderA - orderB;
      });
    for (const step of completedSteps) {
      res.write(`data: ${JSON.stringify(createLegacyStepUpdateFromTaskStep(step))}\n\n`);
      await flush();
    }

    // 任务已终态 → 补推 completed/failed
    if (task.status === "completed" || task.status === "failed") {
      res.write(`data: ${JSON.stringify({ type: task.status, taskId, status: task.status, message: task.error || "" })}\n\n`);
    }
  } catch {
    // ignore
  }

  req.on("close", () => {
    removeSseClient(taskId, res);
    res.end();
  });
});

export default router;
