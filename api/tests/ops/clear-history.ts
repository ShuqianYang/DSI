import { db } from "../../src/config/database.js";
import { events, taskSteps, jobTasks, tasks, insights } from "../../src/db/schema.js";

async function clearHistory() {
  console.log("开始清空历史数据...");

  // 按依赖顺序删除（先子表后父表）
  const eventCount = await db.delete(events);
  console.log(`- 已清空 events 表`);

  const stepCount = await db.delete(taskSteps);
  console.log(`- 已清空 task_steps 表`);

  const insightCount = await db.delete(insights);
  console.log(`- 已清空 insights 表`);

  const jobCount = await db.delete(jobTasks);
  console.log(`- 已清空 job_tasks 表`);

  const taskCount = await db.delete(tasks);
  console.log(`- 已清空 tasks 表`);

  console.log("\n全部历史数据已清空，可以开始前端测试。");
}

clearHistory().catch((err) => {
  console.error("清空失败:", err);
  process.exit(1);
});
