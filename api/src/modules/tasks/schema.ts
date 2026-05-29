import { z } from "zod";
import { CreateTaskRequest } from "@datasourceintelligence/shared";

export const createTaskSchema = CreateTaskRequest;

export const getTaskParamsSchema = z.object({
  taskId: z.string().uuid(),
});
