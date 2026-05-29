import type { Response } from "express";

const clients = new Map<string, Set<Response>>();
const globalClients = new Set<Response>();

export function addSseClient(taskId: string, res: Response) {
  if (!clients.has(taskId)) {
    clients.set(taskId, new Set());
  }
  clients.get(taskId)!.add(res);
}

export function removeSseClient(taskId: string, res: Response) {
  const set = clients.get(taskId);
  if (set) {
    set.delete(res);
    if (set.size === 0) clients.delete(taskId);
  }
}

export function addGlobalSseClient(res: Response) {
  globalClients.add(res);
}

export function removeGlobalSseClient(res: Response) {
  globalClients.delete(res);
}

export function notifyTaskUpdate(taskId: string, data: unknown) {
  const set = clients.get(taskId);
  if (!set || set.size === 0) return;

  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of Array.from(set)) {
    try {
      res.write(message);
    } catch {
      set.delete(res);
    }
  }
  if (set.size === 0) clients.delete(taskId);
}

/** 通知全局 SSE 客户端（用于 subscription_triggered_task 等跨任务事件） */
export function notifyGlobalClients(data: unknown) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of Array.from(globalClients)) {
    try {
      res.write(message);
    } catch {
      globalClients.delete(res);
    }
  }
}

/** 广播给所有 task-scoped SSE 客户端（用于无 taskId 的全局事件，如 subscription_completed） */
export function broadcastToAll(data: unknown) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const [taskId, set] of clients.entries()) {
    for (const res of Array.from(set)) {
      try {
        res.write(message);
      } catch {
        set.delete(res);
      }
    }
    if (set.size === 0) clients.delete(taskId);
  }
}
