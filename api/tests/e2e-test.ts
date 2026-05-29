import { db } from "../src/config/database.js";
import { sql } from "drizzle-orm";
import { createAgentTask } from "../src/modules/tasks/service.js";
import * as taskService from "../src/modules/tasks/service.js";
import { executorService } from "../src/modules/executor/service.js";
import { eq } from "drizzle-orm";
import { tasks, taskSteps, events, subscriptions, requirements, insights, jobTasks } from "../src/db/schema.js";

async function runTest() {
  console.log("=== E2E Test: Verify all data types are generated ===\n");

  // 1. 海域态势任务 (maritime → events + insights)
  console.log("[Test 1] Maritime task: 分析东海近期态势");
  const t1 = await createAgentTask({ query: "分析东海近期态势" });
  console.log(`  Task created: ${t1.id}`);
  await executorService.run(t1.id);
  console.log("  Executor finished\n");

  // 2. 订阅任务 (subscription → subscriptions)
  console.log("[Test 2] Subscription task: 订阅每日东海海域态势日报");
  const t2 = await createAgentTask({ query: "订阅每日东海海域态势日报" });
  console.log(`  Task created: ${t2.id}`);
  await executorService.run(t2.id);
  console.log("  Executor finished\n");

  // 3. 需求任务 (requirement → requirements)
  console.log("[Test 3] Requirement task: 帮我预测未来一周南海气象变化趋势");
  const t3 = await createAgentTask({ query: "帮我预测未来一周南海气象变化趋势" });
  console.log(`  Task created: ${t3.id}`);
  await executorService.run(t3.id);
  console.log("  Executor finished\n");

  // 4. 智能问答 (intelligent_qa → events)
  console.log("[Test 4] QA task: 查询本月海域预警事件数量");
  const t4 = await createAgentTask({ query: "查询本月海域预警事件数量" });
  console.log(`  Task created: ${t4.id}`);
  await executorService.run(t4.id);
  console.log("  Executor finished\n");

  // 5. 日报 (daily_report → events)
  console.log("[Test 5] Report task: 生成昨日安防日报");
  const t5 = await createAgentTask({ query: "生成昨日安防日报" });
  console.log(`  Task created: ${t5.id}`);
  await executorService.run(t5.id);
  console.log("  Executor finished\n");

  // 6. 天基查询 (satellite → events)
  console.log("[Test 6] Satellite task: 查询东海区域高分卫星影像");
  const t6 = await createAgentTask({ query: "查询东海区域高分卫星影像" });
  console.log(`  Task created: ${t6.id}`);
  await executorService.run(t6.id);
  console.log("  Executor finished\n");

  // Wait a bit for DB writes
  await new Promise((r) => setTimeout(r, 500));

  // Check database state
  console.log("=== Database Verification ===\n");

  const allTasks = await db.select().from(tasks);
  console.log(`Tasks: ${allTasks.length}`);
  for (const t of allTasks) {
    console.log(`  - ${t.id}: ${t.query.substring(0, 30)}... [${t.status}]`);
  }

  const allSteps = await db.select().from(taskSteps);
  console.log(`\nTaskSteps: ${allSteps.length}`);

  const allJobTasks = await db.select().from(jobTasks);
  console.log(`JobTasks: ${allJobTasks.length}`);

  const allEvents = await db.select().from(events);
  console.log(`\nEvents: ${allEvents.length}`);
  for (const e of allEvents) {
    console.log(`  - ${e.title} [${e.status}]`);
  }

  const allSubs = await db.select().from(subscriptions);
  console.log(`\nSubscriptions: ${allSubs.length}`);
  for (const s of allSubs) {
    console.log(`  - ${s.name} [${s.status}] schedule=${s.schedule}`);
  }

  const allReqs = await db.select().from(requirements);
  console.log(`\nRequirements: ${allReqs.length}`);
  for (const r of allReqs) {
    console.log(`  - ${r.description?.substring(0, 40)}... [${r.status}]`);
  }

  const allInsights = await db.select().from(insights);
  console.log(`\nInsights: ${allInsights.length}`);
  for (const i of allInsights) {
    console.log(`  - ${i.title} [${i.riskLevel}]`);
  }

  // Summary
  console.log("\n=== Summary ===");
  const passed =
    allEvents.length > 0 &&
    allSubs.length > 0 &&
    allReqs.length > 0 &&
    allInsights.length > 0;

  if (passed) {
    console.log("All data types generated successfully!");
  } else {
    console.log("FAILED: Some data types are missing");
    if (allEvents.length === 0) console.log("  - Missing: events");
    if (allSubs.length === 0) console.log("  - Missing: subscriptions");
    if (allReqs.length === 0) console.log("  - Missing: requirements");
    if (allInsights.length === 0) console.log("  - Missing: insights");
  }

  process.exit(passed ? 0 : 1);
}

runTest().catch((e) => {
  console.error(e);
  process.exit(1);
});
