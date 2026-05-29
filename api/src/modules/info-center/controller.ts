import type { Request, Response } from "express";
import * as service from "./service.js";

function parseQuery(req: Request) {
  const typeRaw = (req.query.type as string) || "event,insight";
  const type = typeRaw.split(",").map((t) => t.trim()).filter(Boolean);

  const statusRaw = req.query.status as string | undefined;
  const status = statusRaw ? statusRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;

  const sourceRaw = req.query.source as string | undefined;
  const source = sourceRaw
    ? sourceRaw.split(",").map((s) => s.trim()).filter(Boolean) as ("instant" | "subscription")[]
    : undefined;

  const startTime = req.query.startTime as string | undefined;
  const endTime = req.query.endTime as string | undefined;
  const taskId = req.query.taskId as string | undefined;
  const search = req.query.search as string | undefined;

  return { type, status, source, startTime, endTime, taskId, search };
}

export async function listInfoCenter(req: Request, res: Response) {
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string, 10) || 20));

  const result = await service.getInfoCenterItems({
    page,
    pageSize,
    ...parseQuery(req),
  });

  res.json(result);
}

export async function exportInfoCenter(req: Request, res: Response) {
  const csv = await service.exportInfoCenterToCSV(parseQuery(req));

  const now = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="info-center-export-${now}.csv"`);
  res.send(csv);
}
