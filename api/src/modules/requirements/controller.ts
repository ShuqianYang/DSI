import type { Request, Response } from "express";
import * as service from "./service.js";

export async function createRequirement(req: Request, res: Response) {
  const req_ = await service.createRequirement(req.body);
  res.status(201).json(req_);
}

export async function listRequirements(_req: Request, res: Response) {
  const items = await service.getRequirements();
  res.json({ requirements: items });
}

export async function getRequirement(req: Request, res: Response) {
  const item = await service.getRequirementById(req.params.id);
  if (!item) {
    res.status(404).json({ error: "Requirement not found" });
    return;
  }
  res.json(item);
}

export async function updateRequirement(req: Request, res: Response) {
  await service.updateRequirement(req.params.id, req.body);
  res.json({ success: true });
}

export async function deleteRequirement(req: Request, res: Response) {
  await service.deleteRequirement(req.params.id);
  res.json({ success: true });
}
