import type { Request, Response } from "express";
import * as service from "./service.js";

export async function createSubscription(req: Request, res: Response) {
  const sub = await service.createSubscription(req.body);
  res.status(201).json(sub);
}

export async function listSubscriptions(_req: Request, res: Response) {
  const items = await service.getSubscriptions();
  res.json({ subscriptions: items });
}

export async function getSubscription(req: Request, res: Response) {
  const sub = await service.getSubscriptionById(req.params.id);
  if (!sub) {
    res.status(404).json({ error: "Subscription not found" });
    return;
  }
  res.json(sub);
}

export async function updateSubscription(req: Request, res: Response) {
  await service.updateSubscription(req.params.id, req.body);
  res.json({ success: true });
}

export async function deleteSubscription(req: Request, res: Response) {
  await service.deleteSubscription(req.params.id);
  res.json({ success: true });
}
