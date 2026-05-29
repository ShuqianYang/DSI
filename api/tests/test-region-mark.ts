import "dotenv/config";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { db } from "../src/config/database.js";
import { tasks, taskSteps, jobTasks, events as eventsTable } from "../src/db/schema.js";
import { executorService } from "../src/modules/executor/service.js";

/**
 * 直接测试 region-mark capability（绕过 Planner/Router，不依赖 Dify）
 *
 * 运行方式：
 *   cd api && npx tsx scripts/test-region-mark.ts
 *
 * 实时回显方式：
 *   1. 运行脚本，创建 task（不立即执行）
 *   2. 脚本打印前端调试 URL，复制到浏览器打开
 *   3. 浏览器自动建立 SSE 连接
 *   4. 回到终端按 Enter 执行 executor
 *   5. 前端实时收到 step_update + operations，自动 flyTo + 渲染
 */

function waitForEnter(): Promise<void> {
  console.log("\n[Test] === 按 Enter 开始执行 executor ===\n");
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return new Promise((resolve) => {
    stdin.on("data", function onData(key: string) {
      if (key === "\r" || key === "\n") {
        stdin.removeListener("data", onData);
        stdin.setRawMode(false);
        stdin.pause();
        resolve();
      }
      if (key === "") {
        process.exit(0);
      }
    });
  });
}

async function main() {
  const query = "标记中国东海区域";
  const userId = "test-user";

  console.log("[Test] Creating task for:", query);

  // 1. 创建主任务
  const [task] = await db
    .insert(tasks)
    .values({
      id: uuidv4(),
      userId,
      query,
      status: "pending",
      plan: null,
      actions: null,
      result: null,
      error: null,
    })
    .returning();

  console.log("[Test] Task created:", task.id);

  // 2. 创建单个 taskStep（region-mark action）
  const actionConfig = {
    id: "action-1",
    type: "region-mark",
    name: "标记中国东海区域",
    description: "在GIS地图上框选并标记中国东海区域范围",
    params: { region: "中国东海", query },
    dependsOn: [],
  };

  const [step] = await db
    .insert(taskSteps)
    .values({
      taskId: task.id,
      actionType: "region-mark",
      actionConfig: actionConfig as unknown as Record<string, unknown>,
      status: "pending",
      result: null,
      error: null,
    })
    .returning();

  console.log("[Test] Step created:", step.id);

  // 3. 创建 jobTask（带 subTasks）
  const [jobTask] = await db
    .insert(jobTasks)
    .values({
      userId,
      name: query,
      type: "realtime",
      status: "running",
      dataCount: 0,
      agentTaskId: task.id,
      subTasks: [
        {
          id: "sub-1",
          name: actionConfig.name,
          status: "pending",
          order: 1,
        },
        {
          id: "insight",
          name: "综合洞察生成",
          status: "pending",
          order: 2,
        },
      ],
    })
    .returning();

  console.log("[Test] JobTask created:", jobTask.id);

  // 4. 打印前端调试 URL
  const debugUrl = `http://localhost:5000/?sseTaskId=${task.id}`;
  console.log("\n========================================");
  console.log("[Test] 前端实时回显调试 URL:");
  console.log(debugUrl);
  console.log("========================================\n");
  console.log("[Test] 操作步骤:");
  console.log("  1. 复制上面的 URL 到浏览器打开");
  console.log("  2. 浏览器会自动建立 SSE 连接");
  console.log("  3. 回到终端按 Enter 执行 executor");
  console.log("  4. 前端会自动 flyTo 东海区域并渲染多边形\n");

  // 5. 等待用户按 Enter
  await waitForEnter();

  // 6. 执行 Executor（会推送 SSE）
  console.log("[Test] Starting executor...\n");
  try {
    await executorService.run(task.id, jobTask.id);
    console.log("\n[Test] Executor completed successfully");
  } catch (err) {
    console.error("\n[Test] Executor failed:", err);
  }

  // 7. 等待 SSE 消息送达
  await new Promise((r) => setTimeout(r, 3000));

  // 8. 打印结果
  const jt = await db.select().from(jobTasks).where(eq(jobTasks.id, jobTask.id));
  console.log("\n[Test] JobTask final state:", JSON.stringify(jt[0]?.subTasks, null, 2));

  const evs = await db.select().from(eventsTable).where(eq(eventsTable.agentTaskId, task.id));
  console.log("\n[Test] Events created:", evs.length);
  evs.forEach((ev: any) => {
    console.log(`  - ${ev.title} | gisData=${ev.gisData ? "YES" : "NO"}`);
  });

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
