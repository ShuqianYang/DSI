import "dotenv/config";
import { db } from "../../src/config/database.js";
import { tasks, taskSteps, jobTasks } from "../../src/db/schema.js";
import { desc, eq } from "drizzle-orm";

async function main() {
  console.log("=== 最近 5 条任务 ===\n");
  const allTasks = await db.select().from(tasks).orderBy(desc(tasks.createdAt)).limit(5);
  for (const t of allTasks) {
    console.log(`Task: ${t.id}`);
    console.log(`  query: ${t.query}`);
    console.log(`  status: ${t.status}`);
    console.log(`  plan.goal: ${t.plan ? (t.plan as any).goal : "null"}`);
    console.log(`  actions: ${t.actions ? (t.actions as any).map((a: any) => a.type).join(", ") : "null"}`);
    console.log(`  result: ${t.result ? JSON.stringify(t.result).slice(0, 200) : "null"}`);
    console.log(`  error: ${t.error || "null"}`);
    console.log(`  createdAt: ${t.createdAt}`);
    console.log();
  }

  if (allTasks.length > 0) {
    const latest = allTasks[0];
    console.log(`=== Task ${latest.id} 的 Steps ===\n`);
    const steps = await db.select().from(taskSteps).where(eq(taskSteps.taskId, latest.id));
    for (const s of steps) {
      console.log(`Step: ${s.id}`);
      console.log(`  taskId: ${s.taskId}`);
      console.log(`  actionType: ${s.actionType}`);
      console.log(`  status: ${s.status}`);
      console.log(`  result: ${s.result ? JSON.stringify(s.result).slice(0, 200) : "null"}`);
      console.log(`  error: ${s.error || "null"}`);
      console.log();
    }
  }

  console.log("=== 最近 5 条 Job Tasks ===\n");
  const jobs = await db.select().from(jobTasks).orderBy(desc(jobTasks.createdAt)).limit(5);
  for (const j of jobs) {
    console.log(`JobTask: ${j.id}`);
    console.log(`  name: ${j.name}`);
    console.log(`  status: ${j.status}`);
    console.log(`  agentTaskId: ${j.agentTaskId}`);
    console.log(`  subTasks: ${JSON.stringify(j.subTasks)}`);
    console.log();
  }
}

main();
