import "dotenv/config";
import { db } from "../src/config/database.js";
import { tasks, taskSteps, jobTasks, events } from "../src/db/schema.js";
import { eq } from "drizzle-orm";

const taskId = process.argv[2];
if (!taskId) { console.log("Usage: npx tsx check-single-task.ts <taskId>"); process.exit(1); }

const t = await db.select().from(tasks).where(eq(tasks.id, taskId));
const s = await db.select().from(taskSteps).where(eq(taskSteps.taskId, taskId));
const j = await db.select().from(jobTasks).where(eq(jobTasks.agentTaskId, taskId));
const e = await db.select().from(events).where(eq(events.agentTaskId, taskId));

console.log("=== Task ===");
console.log(JSON.stringify(t[0] || null, null, 2));
console.log("\n=== Steps ===");
console.log(JSON.stringify(s, null, 2));
console.log("\n=== JobTasks ===");
console.log(JSON.stringify(j, null, 2));
console.log("\n=== Events ===");
console.log(JSON.stringify(e, null, 2));
