import { eq, and, gte, lte, ilike, desc, sql } from "drizzle-orm";
import { db } from "../../config/database.js";
import { tasks } from "../../db/schema.js";

export interface ListTaskResultsOptions {
  page?: number;
  pageSize?: number;
  status?: string;
  search?: string;
  startTime?: Date;
  endTime?: Date;
}

export async function listTaskResults(options: ListTaskResultsOptions = {}) {
  const {
    page = 1,
    pageSize = 20,
    status,
    search,
    startTime,
    endTime,
  } = options;

  const conditions = [sql`${tasks.status} IN ('completed', 'failed')`];

  if (status) {
    conditions.push(eq(tasks.status, status as "pending" | "running" | "completed" | "failed"));
  }
  if (search) {
    conditions.push(ilike(tasks.query, `%${search}%`));
  }
  if (startTime) {
    conditions.push(gte(tasks.createdAt, startTime));
  }
  if (endTime) {
    conditions.push(lte(tasks.createdAt, endTime));
  }

  const where = conditions.length > 1 ? and(...conditions) : conditions[0];

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(where);

  const items = await db
    .select({
      id: tasks.id,
      query: tasks.query,
      status: tasks.status,
      result: tasks.result,
      error: tasks.error,
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .where(where)
    .orderBy(desc(tasks.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    items,
    total: count,
    page,
    pageSize,
  };
}
