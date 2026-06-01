import type { HarnessRuntimeState, Observation, UsedToolSignature } from "../actions/contracts/types.js";

export function createRuntimeState(
  taskId: string,
  userQuery: string,
  options?: { maxSteps?: number; runId?: string }
): HarnessRuntimeState {
  return {
    taskId,
    runId: options?.runId ?? `run_${Date.now()}`,
    userQuery,
    observations: [],
    missingData: [],
    usedTools: [],
    stepCount: 0,
    maxSteps: options?.maxSteps ?? 3,
    status: "running",
    currentPhase: "init",
    blockedReasons: [],
    artifacts: {},
  };
}

export function saveArtifact(
  state: HarnessRuntimeState,
  key: string,
  value: unknown
): void {
  state.artifacts[key] = value;
}

export function getArtifact(
  state: HarnessRuntimeState,
  key: string
): unknown {
  return state.artifacts[key];
}

export function pushObservation(
  state: HarnessRuntimeState,
  observation: Observation
): void {
  state.observations.push(observation);
  state.stepCount += 1;
}

export function markToolUsed(
  state: HarnessRuntimeState,
  toolName: string,
  params: Record<string, unknown>
): void {
  state.usedTools.push({
    toolName,
    paramHash: hashParams(params),
  });
}

export function hasUsedTool(
  state: HarnessRuntimeState,
  toolName: string,
  params: Record<string, unknown>
): boolean {
  const hash = hashParams(params);
  return state.usedTools.some(
    (t) => t.toolName === toolName && t.paramHash === hash
  );
}

export function isMaxStepsReached(state: HarnessRuntimeState): boolean {
  return state.stepCount >= state.maxSteps;
}

export function completeState(
  state: HarnessRuntimeState,
  phase: string
): void {
  state.status = "completed";
  state.currentPhase = phase;
}

export function failState(
  state: HarnessRuntimeState,
  reason: string
): void {
  state.status = "failed";
  state.blockedReasons.push(reason);
}

// 简单的参数哈希，用于防重复调用
function hashParams(params: Record<string, unknown>): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${JSON.stringify(params[k])}`)
    .join("&");
  // 简单 djb2 哈希
  let hash = 5381;
  for (let i = 0; i < sorted.length; i++) {
    hash = ((hash << 5) + hash + sorted.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}
