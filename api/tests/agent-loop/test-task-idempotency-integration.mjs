import assert from "node:assert/strict";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";

const { db, client } = await import("../../src/config/database.ts");
const { tasks } = await import("../../src/db/schema.ts");
const { createTaskOnce } = await import("../../src/modules/tasks/service.ts");

const clientRequestId = crypto.randomUUID();
let taskId;

try {
  const first = await createTaskOnce({
    query: "idempotency integration test",
    userId: "test-user",
    clientRequestId,
  });
  taskId = first.task.id;
  const second = await createTaskOnce({
    query: "idempotency integration test",
    userId: "test-user",
    clientRequestId,
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.task.id, first.task.id);
  console.log("task idempotency integration tests passed");
} finally {
  if (taskId) await db.delete(tasks).where(eq(tasks.id, taskId));
  await client.end();
}
