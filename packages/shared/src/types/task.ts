import { z } from "zod";
import { ScenarioIdSchema } from "../scenarios.js";
import type { Plan } from "./plan.js";
import type { Action } from "./action.js";

export const TaskStatus = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const StepStatus = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
]);
export type StepStatus = z.infer<typeof StepStatus>;

export const CreateTaskRequest = z.object({
  query: z.string().min(1),
  userId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  clientRequestId: z.string().min(1).optional(),
  scenarioId: ScenarioIdSchema.optional(),
  context: z.record(z.string(), z.any()).optional(),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>;

export interface Task {
  id: string;
  userId?: string;
  query: string;
  status: TaskStatus;
  plan: Plan | null;
  actions: Action[] | null;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface TaskStep {
  id: string;
  taskId: string;
  actionType: string;
  actionConfig: Record<string, unknown>;
  status: StepStatus;
  result: Record<string, unknown> | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface TaskWithSteps extends Task {
  steps: TaskStep[];
}
