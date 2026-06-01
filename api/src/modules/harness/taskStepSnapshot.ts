import { db } from "../../config/database.js";
import { taskSteps } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import type { TaskStepSnapshot } from "../actions/contracts/types.js";

/**
 * 将 harness step snapshot 写入 taskSteps 表。
 *
 * 兼容策略：
 * - actionType 存 action.type（如 "weather.fetch"）
 * - actionConfig 存完整 snapshot JSON（含 harness metadata + action）
 * - 现有 resolveActionConfig 可以从 actionConfig 中提取 Action
 */

export interface SnapshotInsertResult {
  stepId: string;
}

export async function writeStepSnapshot(
  taskId: string,
  snapshot: TaskStepSnapshot,
  status: "pending" | "running" | "completed" | "failed" = "pending"
): Promise<SnapshotInsertResult> {
  const [inserted] = await db
    .insert(taskSteps)
    .values({
      taskId,
      actionType: snapshot.action.type,
      actionConfig: snapshot as unknown as Record<string, unknown>,
      status,
      result: null,
      error: null,
      startedAt: status === "running" ? new Date() : null,
      completedAt: null,
    })
    .returning({ stepId: taskSteps.id });

  return { stepId: inserted.stepId };
}

export async function updateStepRunning(
  stepId: string
): Promise<void> {
  await db
    .update(taskSteps)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(taskSteps.id, stepId));
}

export async function updateStepCompleted(
  stepId: string,
  result: Record<string, unknown>
): Promise<void> {
  await db
    .update(taskSteps)
    .set({
      status: "completed",
      result,
      completedAt: new Date(),
    })
    .where(eq(taskSteps.id, stepId));
}

export async function updateStepFailed(
  stepId: string,
  error: string
): Promise<void> {
  await db
    .update(taskSteps)
    .set({
      status: "failed",
      error,
      completedAt: new Date(),
    })
    .where(eq(taskSteps.id, stepId));
}

/**
 * 从 snapshot 构建 TaskStepSnapshot 对象。
 */
export function buildSnapshot(
  source: TaskStepSnapshot["source"],
  kind: TaskStepSnapshot["kind"],
  runId: string,
  sequence: number,
  stepKey: string,
  action: TaskStepSnapshot["action"],
  options?: {
    attempt?: number;
    agentDecision?: TaskStepSnapshot["agentDecision"];
  }
): TaskStepSnapshot {
  return {
    source,
    kind,
    runId,
    sequence,
    stepKey,
    attempt: options?.attempt ?? 1,
    agentDecision: options?.agentDecision,
    action,
  };
}
