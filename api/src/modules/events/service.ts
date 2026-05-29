import { eq, desc } from "drizzle-orm";
import { db } from "../../config/database.js";
import { events } from "../../db/schema.js";
import type { Event, NewEvent } from "../../db/schema.js";

export async function createEvent(data: NewEvent): Promise<Event> {
  const [event] = await db.insert(events).values(data).returning();
  return event;
}

export async function getEvents(userId?: string): Promise<Event[]> {
  const result = userId
    ? await db.select().from(events).where(eq(events.userId, userId)).orderBy(desc(events.timestamp))
    : await db.select().from(events).orderBy(desc(events.timestamp));
  for (const e of result) {
    if (e.gisData) {
      console.log(`[Events API] event ${e.id.slice(0,8)} gisData:`, `type=${(e.gisData as any)?.type} cameraView=${!!(e.gisData as any)?.cameraView} regions=${(e.gisData as any)?.regions?.length}`);
    }
  }
  return result;
}

export async function getEventById(id: string): Promise<Event | null> {
  const [event] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  return event || null;
}

export async function updateEvent(id: string, data: Partial<NewEvent>): Promise<void> {
  await db.update(events).set(data).where(eq(events.id, id));
}

export async function deleteEvent(id: string): Promise<void> {
  await db.delete(events).where(eq(events.id, id));
}
