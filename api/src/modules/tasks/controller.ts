import type { Request, Response } from "express";
import * as taskService from "./service.js";
import { runAgentPipeline } from "./pipeline.js";
import type { CreateTaskRequest } from "@datasourceintelligence/shared";
import { extractRequestMetadata } from "../observability/requestMetadata.js";
import {
  abortTask as abortRegisteredTask,
  getTaskAbortController,
  registerTaskAbortController,
  unregisterTaskAbortController,
} from "./abortRegistry.js";
import { notifyTaskUpdate } from "../../sse/sseManager.js";
import { buildLoopStopEventFromTaskResult } from "./agentLoopSseMode.js";

export async function createTask(req: Request, res: Response) {
  const body = req.body as CreateTaskRequest;
  const requestMetadata = extractRequestMetadata(req);

  // 1. 创建任务记录并立即返回
  const { task, created } = await taskService.createTaskOnce(body);
  const abortController = created ? new AbortController() : undefined;
  if (abortController) {
    registerTaskAbortController(task.id, abortController);
  }

  res.status(201).json({
    taskId: task.id,
    status: task.status,
    reused: !created,
  });

  // 2. 异步执行 Agent Pipeline（不阻塞 HTTP 响应）
  if (!created) return;

  runAgentPipeline(task.id, body, requestMetadata, abortController).catch(async (err) => {
    console.error(`[createTask] Pipeline error for task ${task.id}:`, err);
    unregisterTaskAbortController(task.id);
    const error = err instanceof Error ? err.message : String(err);
    await taskService.updateTaskStatus(task.id, "failed", error).catch(() => undefined);
    notifyTaskUpdate(task.id, buildLoopStopEventFromTaskResult({
      taskId: task.id,
      status: "failed",
      result: null,
      error,
    }));
  });
}

export async function abortTask(req: Request, res: Response) {
  const taskId = String(req.params.taskId);
  const controller = getTaskAbortController(taskId);
  if (!controller || controller.signal.aborted) {
    // Task may have finished or not started yet; update DB if still running.
    const task = await taskService.getTaskById(taskId);
    if (task && (task.status === "pending" || task.status === "running")) {
      await taskService.updateTaskStatus(taskId, "failed", "用户主动停止任务");
      notifyTaskUpdate(taskId, buildLoopStopEventFromTaskResult({
        taskId,
        status: "failed",
        result: null,
        error: "用户主动停止任务",
      }));
      res.json({ aborted: true, taskId, message: "任务已标记为停止" });
      return;
    }
    res.status(409).json({ aborted: false, taskId, message: "任务不在可停止状态" });
    return;
  }
  abortRegisteredTask(taskId, "用户主动停止任务");
  res.json({ aborted: true, taskId, message: "已发送停止信号" });
}

export async function getTask(req: Request, res: Response) {
  const taskId = String(req.params.taskId);
  const task = await taskService.getTaskWithSteps(taskId);

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.json({
    taskId: task.id,
    status: task.status,
    query: task.query,
    plan: task.plan,
    actions: task.actions,
    result: task.result,
    error: task.error,
    steps: task.steps,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  });
}

export async function listTasks(_req: Request, res: Response) {
  // TODO: 分页
  res.json({ tasks: [] });
}
