import "dotenv/config";
import { db } from "../../src/config/database.js";
import { jobTasks, taskSteps, tasks } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";

async function check() {
  const allTasks = await db.select().from(tasks);
  const allJobTasks = await db.select().from(jobTasks);
  const allSteps = await db.select().from(taskSteps);

  console.log("=== tasks ===");
  console.log(JSON.stringify(allTasks.map(t => ({ id: t.id, status: t.status, query: t.query })), null, 2));

  console.log("\n=== job_tasks ===");
  console.log(JSON.stringify(allJobTasks.map(j => ({ id: j.id, status: j.status, subTasks: j.subTasks })), null, 2));

  console.log("\n=== task_steps ===");
  console.log(JSON.stringify(allSteps.map(s => ({ id: s.id, status: s.status, actionType: s.actionType })), null, 2));

  process.exit(0);
}

check().catch(e => { console.error(e); process.exit(1); });
