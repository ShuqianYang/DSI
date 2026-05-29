import { eq, desc } from "drizzle-orm";
import { db } from "../../config/database.js";
import { jobTasks } from "../../db/schema.js";
import type { JobTask, NewJobTask } from "../../db/schema.js";

export async function createJobTask(data: NewJobTask): Promise<JobTask> {
  const [task] = await db.insert(jobTasks).values(data).returning();
  return task;
}

export async function getJobTasks(userId?: string): Promise<JobTask[]> {
  let result: JobTask[];
  if (userId) {
    result = await db.select().from(jobTasks).where(eq(jobTasks.userId, userId)).orderBy(desc(jobTasks.createdAt));
  } else {
    result = await db.select().from(jobTasks).orderBy(desc(jobTasks.createdAt));
  }
  for (const t of result) {
    console.log(`[JobsService] getJobTasks: id=${t.id}, status=${t.status}, subTasks=${JSON.stringify(t.subTasks)?.slice(0, 100)}`);
  }
  return result;
}

export async function getJobTaskById(id: string): Promise<JobTask | null> {
  const [task] = await db.select().from(jobTasks).where(eq(jobTasks.id, id)).limit(1);
  return task || null;
}

export async function updateJobTask(id: string, data: Partial<NewJobTask>): Promise<void> {
  await db.update(jobTasks).set({ ...data, updatedAt: new Date() }).where(eq(jobTasks.id, id));
}

export async function deleteJobTask(id: string): Promise<void> {
  await db.delete(jobTasks).where(eq(jobTasks.id, id));
}
