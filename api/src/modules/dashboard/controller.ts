import type { Request, Response } from "express";
import * as dashboardService from "./service.js";

export async function listJobs(_req: Request, res: Response) {
  res.json(await dashboardService.listJobs());
}

export async function listEvents(_req: Request, res: Response) {
  res.json(await dashboardService.listEvents());
}

export async function getEventById(req: Request, res: Response) {
  const event = await dashboardService.getEventById(String(req.params.id));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(event);
}

export async function updateEventRead(req: Request, res: Response) {
  await dashboardService.updateEventRead(String(req.params.id), Boolean(req.body?.read));
  res.status(204).send();
}

export async function listSubscriptions(_req: Request, res: Response) {
  res.json(await dashboardService.listSubscriptions());
}

export async function updateSubscriptionStatus(req: Request, res: Response) {
  const status = req.body?.status;
  if (status !== "running" && status !== "paused") {
    res.status(400).json({ error: "status must be running or paused" });
    return;
  }
  await dashboardService.updateSubscriptionStatus(String(req.params.id), status);
  res.status(204).send();
}

export async function listRequirements(_req: Request, res: Response) {
  res.json(await dashboardService.listRequirements());
}

export async function listInsights(_req: Request, res: Response) {
  res.json(await dashboardService.listInsights());
}

export async function getInsightById(req: Request, res: Response) {
  const insight = await dashboardService.getInsightById(String(req.params.id));
  if (!insight) {
    res.status(404).json({ error: "Insight not found" });
    return;
  }
  res.json(insight);
}

export async function getAdsData(_req: Request, res: Response) {
  res.json(await dashboardService.getAdsData());
}

export async function getAisData(_req: Request, res: Response) {
  res.json(await dashboardService.getAisData());
}
