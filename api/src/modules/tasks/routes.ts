import { Router, type Request, type Response, type Router as ExpressRouter } from "express";
import { eq } from "drizzle-orm";
import { asyncHandler } from "../../middleware/errorHandler.js";
import { validateBody, validateParams } from "../../middleware/validate.js";
import { createTaskSchema, getTaskParamsSchema } from "./schema.js";
import { createTask, getTask, listTasks } from "./controller.js";
import { addSseClient, removeSseClient } from "../../sse/sseManager.js";
import { db } from "../../config/database.js";
import { tasks } from "../../db/schema.js";
import { buildLoopStopEventFromTaskResult } from "./agentLoopSseMode.js";

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

export default router;
