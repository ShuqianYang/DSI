import type { Action } from "@datasourceintelligence/shared";

/**
 * 兼容层：解析 taskSteps.actionConfig，支持新旧两种格式。
 *
 * 旧格式（直接是 Action 对象）:
 *   { id: "action-1", type: "weather-fetch", name: "...", params: {...} }
 *
 * 新格式（harness snapshot，action 嵌套在内部）:
 *   {
 *     source: "agent",
 *     kind: "tool_call",
 *     runId: "run_001",
 *     sequence: 1,
 *     attempt: 1,
 *     action: {
 *       type: "weather.fetch",
 *       name: "weather.fetch",
 *       params: {...}
 *     }
 *   }
 */

interface HarnessSnapshot {
  action: Action;
}

function isHarnessSnapshot(config: unknown): config is HarnessSnapshot {
  if (typeof config !== "object" || config === null) {
    return false;
  }
  const obj = config as Record<string, unknown>;
  return (
    "action" in obj &&
    typeof obj.action === "object" &&
    obj.action !== null &&
    "type" in obj.action
  );
}

export function resolveAction(actionConfig: unknown): Action {
  if (isHarnessSnapshot(actionConfig)) {
    return actionConfig.action;
  }

  // 兜底：旧格式直接就是 Action
  return actionConfig as Action;
}

/**
 * 从 snapshot 中提取 harness metadata（如果存在）。
 * 旧格式返回 null。
 */
export function extractHarnessMeta(
  actionConfig: unknown
): { source?: string; runId?: string; sequence?: number } | null {
  if (typeof actionConfig !== "object" || actionConfig === null) {
    return null;
  }
  const obj = actionConfig as Record<string, unknown>;
  if (!("action" in obj) || !isHarnessSnapshot(actionConfig)) {
    return null;
  }
  return {
    source: typeof obj.source === "string" ? obj.source : undefined,
    runId: typeof obj.runId === "string" ? obj.runId : undefined,
    sequence: typeof obj.sequence === "number" ? obj.sequence : undefined,
  };
}
