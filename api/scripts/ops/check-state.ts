import "dotenv/config";
import { db } from "../../src/config/database.js";
import { tasks, taskSteps, jobTasks, events, subscriptions } from "../../src/db/schema.js";

async function main() {
  const t = await db.select().from(tasks);
  const s = await db.select().from(taskSteps);
  const j = await db.select().from(jobTasks);
  const e = await db.select().from(events);
  const subs = await db.select().from(subscriptions);

  console.log("=== Tasks (" + t.length + ") ===");
  t.forEach((x: any) => console.log("  [" + x.id.slice(0,8) + "] status=" + x.status + " | query=" + x.query?.slice(0,50)));

  console.log("\n=== TaskSteps (" + s.length + ") ===");
  s.forEach((x: any) => console.log("  [" + x.id.slice(0,8) + "] task=" + x.taskId?.slice(0,8) + " | type=" + x.actionType + " | status=" + x.status));

  console.log("\n=== JobTasks (" + j.length + ") ===");
  j.forEach((x: any) => console.log("  [" + x.id.slice(0,8) + "] status=" + x.status + " | name=" + x.name + " | agentTaskId=" + x.agentTaskId?.slice(0,8)));

  console.log("\n=== Events (" + e.length + ") ===");
  e.forEach((x: any) => console.log("  [" + x.id.slice(0,8) + "] " + x.title + " | status=" + x.status + " | taskName=" + x.taskName));

  console.log("\n=== Subscriptions (" + subs.length + ") ===");
  subs.forEach((x: any) => console.log("  [" + x.id.slice(0,8) + "] " + x.name + " | status=" + x.status));

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
