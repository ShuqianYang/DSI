import type { Request, Response } from "express";
import * as service from "./service.js";

export async function createJobTask(req: Request, res: Response) {
  const task = await service.createJobTask(req.body);
  res.status(201).json(task);
}

export async function listJobTasks(_req: Request, res: Response) {
  const tasks = await service.getJobTasks();
  res.json({ tasks });
}

export async function getJobTask(req: Request, res: Response) {
  const task = await service.getJobTaskById(req.params.id);
  if (!task) {
    res.status(404).json({ error: "Job task not found" });
    return;
  }
  res.json(task);
}

export async function updateJobTask(req: Request, res: Response) {
  await service.updateJobTask(req.params.id, req.body);
  res.json({ success: true });
}

export async function deleteJobTask(req: Request, res: Response) {
  await service.deleteJobTask(req.params.id);
  res.json({ success: true });
}
