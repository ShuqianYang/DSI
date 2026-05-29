import type { Request, Response } from "express";
import * as service from "./service.js";

export async function createInsight(req: Request, res: Response) {
  const insight = await service.createInsight(req.body);
  res.status(201).json(insight);
}

export async function listInsights(_req: Request, res: Response) {
  const items = await service.getInsights();
  res.json({ insights: items });
}

export async function getInsight(req: Request, res: Response) {
  const item = await service.getInsightById(req.params.id);
  if (!item) {
    res.status(404).json({ error: "Insight not found" });
    return;
  }
  res.json(item);
}

export async function updateInsight(req: Request, res: Response) {
  await service.updateInsight(req.params.id, req.body);
  res.json({ success: true });
}

export async function deleteInsight(req: Request, res: Response) {
  await service.deleteInsight(req.params.id);
  res.json({ success: true });
}
