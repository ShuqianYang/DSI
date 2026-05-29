import { eq, desc } from "drizzle-orm";
import { db } from "../../config/database.js";
import { insights } from "../../db/schema.js";
import type { Insight, NewInsight } from "../../db/schema.js";

export async function createInsight(data: NewInsight): Promise<Insight> {
  const [insight] = await db.insert(insights).values(data).returning();
  return insight;
}

export async function getInsights(userId?: string): Promise<Insight[]> {
  if (userId) {
    return db.select().from(insights).where(eq(insights.userId, userId)).orderBy(desc(insights.createdAt));
  }
  return db.select().from(insights).orderBy(desc(insights.createdAt));
}

export async function getInsightById(id: string): Promise<Insight | null> {
  const [insight] = await db.select().from(insights).where(eq(insights.id, id)).limit(1);
  return insight || null;
}

export async function updateInsight(id: string, data: Partial<NewInsight>): Promise<void> {
  await db.update(insights).set(data).where(eq(insights.id, id));
}

export async function deleteInsight(id: string): Promise<void> {
  await db.delete(insights).where(eq(insights.id, id));
}
