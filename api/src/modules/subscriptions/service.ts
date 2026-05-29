import { eq, desc } from "drizzle-orm";
import { db } from "../../config/database.js";
import { subscriptions } from "../../db/schema.js";
import type { Subscription, NewSubscription } from "../../db/schema.js";

export async function createSubscription(data: NewSubscription): Promise<Subscription> {
  const [sub] = await db.insert(subscriptions).values(data).returning();
  return sub;
}

export async function getSubscriptions(userId?: string): Promise<Subscription[]> {
  if (userId) {
    return db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.createdAt));
  }
  return db.select().from(subscriptions).orderBy(desc(subscriptions.createdAt));
}

export async function getSubscriptionById(id: string): Promise<Subscription | null> {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
  return sub || null;
}

export async function updateSubscription(id: string, data: Partial<NewSubscription>): Promise<void> {
  await db.update(subscriptions).set({ ...data, updatedAt: new Date() }).where(eq(subscriptions.id, id));
}

export async function deleteSubscription(id: string): Promise<void> {
  await db.delete(subscriptions).where(eq(subscriptions.id, id));
}
