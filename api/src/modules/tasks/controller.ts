import type { Request, Response } from "express";
import * as taskService from "./service.js";
import { runAgentPipeline } from "./pipeline.js";
import type { CreateTaskRequest } from "@datasourceintelligence/shared";

export async function createTask(req: Request, res: Response) {
  const body = req.body as CreateTaskRequest;

  // 1. 创建任务记录并立即返回
  const task = await taskService.createTask(body);

  res.status(201).json({
    taskId: task.id,
    status: "pending",
  });

  // 2. 异步执行 Agent Pipeline（不阻塞 HTTP 响应）
  runAgentPipeline(task.id, body).catch((err) => {
    console.error(`[createTask] Pipeline error for task ${task.id}:`, err);
  });
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
