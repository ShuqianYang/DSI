import type { Request, Response } from "express";
import * as service from "./service.js";

export async function listTaskResults(req: Request, res: Response) {
  const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt((req.query.pageSize as string) || "20", 10))
  );
  const status = (req.query.status as string) || undefined;
  const search = (req.query.search as string) || undefined;
  const startTime = req.query.startTime
    ? new Date(req.query.startTime as string)
    : undefined;
  const endTime = req.query.endTime
    ? new Date(req.query.endTime as string)
    : undefined;

  const result = await service.listTaskResults({
    page,
    pageSize,
    status,
    search,
    startTime,
    endTime,
  });

  res.json(result);
}

export async function exportTaskResults(req: Request, res: Response) {
  const status = (req.query.status as string) || undefined;
  const search = (req.query.search as string) || undefined;
  const startTime = req.query.startTime
    ? new Date(req.query.startTime as string)
    : undefined;
  const endTime = req.query.endTime
    ? new Date(req.query.endTime as string)
    : undefined;

  const result = await service.listTaskResults({
    page: 1,
    pageSize: 10000,
    status,
    search,
    startTime,
    endTime,
  });

  const rows = result.items.map((item) => {
    const resultObj = (item.result ?? {}) as Record<string, unknown>;
    return {
      id: item.id,
      query: item.query,
      status: item.status,
      finalAnswer:
        typeof resultObj.finalAnswer === 'string'
          ? resultObj.finalAnswer
          : typeof resultObj.content === 'string'
            ? resultObj.content
            : JSON.stringify(item.result),
      error: item.error || '',
      createdAt: String(item.createdAt),
      completedAt: item.completedAt ? String(item.completedAt) : '',
    };
  });

  const headers = ['id', 'query', 'status', 'finalAnswer', 'error', 'createdAt', 'completedAt'];
  const csv = [headers.join(','), ...rows.map((row) =>
    headers.map((h) => {
      const value = row[h as keyof typeof row];
      const str = String(value ?? '');
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    }).join(',')
  )].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="info-center-export.csv"');
  res.send(csv);
}
