import { eq, desc } from "drizzle-orm";
import { db } from "../../config/database.js";
import { requirements } from "../../db/schema.js";
import type { Requirement, NewRequirement } from "../../db/schema.js";

export async function createRequirement(data: NewRequirement): Promise<Requirement> {
  const [req] = await db.insert(requirements).values(data).returning();
  return req;
}

export async function getRequirements(userId?: string): Promise<Requirement[]> {
  if (userId) {
    return db.select().from(requirements).where(eq(requirements.userId, userId)).orderBy(desc(requirements.timestamp));
  }
  return db.select().from(requirements).orderBy(desc(requirements.timestamp));
}

export async function getRequirementById(id: string): Promise<Requirement | null> {
  const [req] = await db.select().from(requirements).where(eq(requirements.id, id)).limit(1);
  return req || null;
}

export async function updateRequirement(id: string, data: Partial<NewRequirement>): Promise<void> {
  await db.update(requirements).set(data).where(eq(requirements.id, id));
}

export async function deleteRequirement(id: string): Promise<void> {
  await db.delete(requirements).where(eq(requirements.id, id));
}
