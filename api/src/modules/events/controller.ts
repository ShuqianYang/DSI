import type { Request, Response } from "express";
import * as service from "./service.js";

export async function createEvent(req: Request, res: Response) {
  const event = await service.createEvent(req.body);
  res.status(201).json(event);
}

export async function listEvents(_req: Request, res: Response) {
  const items = await service.getEvents();
  res.json({ events: items });
}

export async function getEvent(req: Request, res: Response) {
  const event = await service.getEventById(req.params.id);
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(event);
}

export async function updateEvent(req: Request, res: Response) {
  await service.updateEvent(req.params.id, req.body);
  res.json({ success: true });
}

export async function deleteEvent(req: Request, res: Response) {
  await service.deleteEvent(req.params.id);
  res.json({ success: true });
}
