type AbortEntry = {
  controller: AbortController;
  createdAt: number;
};

const registry = new Map<string, AbortEntry>();
const MAX_IDLE_MS = 30 * 60 * 1000; // 30 minutes

export function registerTaskAbortController(taskId: string, controller: AbortController): void {
  cleanupStale();
  registry.set(taskId, { controller, createdAt: Date.now() });
}

export function getTaskAbortController(taskId: string): AbortController | undefined {
  return registry.get(taskId)?.controller;
}

export function unregisterTaskAbortController(taskId: string): void {
  registry.delete(taskId);
}

export function abortTask(taskId: string, reason?: string): boolean {
  const entry = registry.get(taskId);
  if (!entry) return false;
  if (entry.controller.signal.aborted) return true;
  entry.controller.abort(reason || "用户主动停止任务");
  return true;
}

function cleanupStale(): void {
  const now = Date.now();
  for (const [taskId, entry] of registry.entries()) {
    if (entry.controller.signal.aborted || now - entry.createdAt > MAX_IDLE_MS) {
      registry.delete(taskId);
    }
  }
}
