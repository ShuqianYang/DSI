import { eq } from "drizzle-orm";
import { db } from "../../config/database.js";
import { tasks, taskSteps } from "../../db/schema.js";
import type { Task, NewTask, TaskStep, NewTaskStep } from "../../db/schema.js";
import type { CreateTaskRequest, Plan, Action } from "@datasourceintelligence/shared";

export async function createTask(data: CreateTaskRequest): Promise<Task> {
  return (await createTaskOnce(data)).task;
}

export async function createTaskOnce(data: CreateTaskRequest): Promise<{ task: Task; created: boolean }> {
  const clientRequestId = data.clientRequestId?.trim();
  const [task] = await db
    .insert(tasks)
    .values({
      userId: (data as Record<string, unknown>).userId as string | undefined,
      clientRequestId: clientRequestId || undefined,
      query: data.query,
      status: "pending",
      plan: null,
      actions: null,
      result: null,
      error: null,
    })
    .onConflictDoNothing({ target: tasks.clientRequestId })
    .returning();
  if (task) return { task, created: true };
  if (!clientRequestId) {
    throw new Error("Task creation failed without an idempotency key conflict.");
  }
  const [existing] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.clientRequestId, clientRequestId))
    .limit(1);
  if (!existing) throw new Error("Idempotent task could not be reloaded.");
  return { task: existing, created: false };
}

export async function getTaskById(taskId: string): Promise<Task | null> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return task || null;
}

export async function getTaskWithSteps(taskId: string): Promise<(Task & { steps: TaskStep[] }) | null> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return null;

  const steps = await db.select().from(taskSteps).where(eq(taskSteps.taskId, taskId));
  return { ...task, steps };
}

export async function updateTaskPlan(taskId: string, plan: Plan): Promise<void> {
  await db.update(tasks).set({ plan }).where(eq(tasks.id, taskId));
}

export async function updateTaskActions(taskId: string, actions: Action[]): Promise<void> {
  await db.update(tasks).set({ actions }).where(eq(tasks.id, taskId));
}

export async function updateTaskStatus(
  taskId: string,
  status: "pending" | "running" | "completed" | "failed",
  error?: string
): Promise<void> {
  const updates: Partial<typeof tasks.$inferInsert> = { status, updatedAt: new Date() };
  if (status === "completed" || status === "failed") {
    updates.completedAt = new Date();
  }
  if (error) {
    updates.error = error;
  }
  await db.update(tasks).set(updates).where(eq(tasks.id, taskId));
}

export async function updateTaskResult(
  taskId: string,
  result: Record<string, unknown>,
  status: "completed" | "failed"
): Promise<void> {
  await db
    .update(tasks)
    .set({
      status,
      result,
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));
}

export async function createTaskSteps(taskId: string, actions: Action[]): Promise<void> {
  const steps: NewTaskStep[] = actions.map((action, index) => ({
    taskId,
    actionType: action.type,
    actionConfig: {
      ...(action as unknown as Record<string, unknown>),
      _order: index + 1,
    },
    status: "pending",
    result: null,
    error: null,
    startedAt: null,
    completedAt: null,
  }));
  await db.insert(taskSteps).values(steps);
}

export async function updateStepStatus(
  stepId: string,
  status: "running" | "completed" | "failed",
  result?: Record<string, unknown>,
  error?: string
): Promise<void> {
  const updates: Partial<typeof taskSteps.$inferInsert> = { status };
  if (status === "running") {
    updates.startedAt = new Date();
  }
  if (status === "completed" || status === "failed") {
    updates.completedAt = new Date();
  }
  if (result) {
    updates.result = result;
  }
  if (error) {
    updates.error = error;
  }
  await db.update(taskSteps).set(updates).where(eq(taskSteps.id, stepId));
}

export async function getStepsByTaskId(taskId: string): Promise<TaskStep[]> {
  return db.select().from(taskSteps).where(eq(taskSteps.taskId, taskId));
}
