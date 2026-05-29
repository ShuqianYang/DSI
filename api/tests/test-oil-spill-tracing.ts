import "dotenv/config";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import * as readline from "readline";
import { db } from "../src/config/database.js";
import { tasks, taskSteps, jobTasks, events as eventsTable } from "../src/db/schema.js";
import { executorService } from "../src/modules/executor/service.js";

/**
 * 组合测试 3.1（region-mark）+ 3.2（satellite 油膜识别）
 * 日后可继续拓展测试完整 7 步流程
 *
 * 运行方式：
 *   cd api && npx tsx scripts/test-oil-spill-tracing.ts
 *
 * 实时回显方式：
 *   1. 运行脚本，创建 task（不立即执行）
 *   2. 脚本打印前端调试 URL，复制到浏览器打开
 *   3. 浏览器自动建立 SSE 连接
 *   4. 回到终端按 Enter 执行 executor
 *   5. 前端实时收到 step_update + gisData，自动渲染区域+油膜+贴图
 */

function waitForEnter(): Promise<void> {
  console.log("\n[Test] === 按 Enter 开始执行 executor ===\n");

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("", () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  const query = "东海 油膜 识别";
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

  // 2. 创建 Step 1：region-mark（3.1）
  const regionMarkAction = {
    id: "action-1",
    type: "region-mark",
    name: "标记中国东海区域",
    description: "在GIS地图上框选并标记中国东海区域范围",
    params: { region: "中国东海", query },
    dependsOn: [],
  };

  const [step1] = await db
    .insert(taskSteps)
    .values({
      taskId: task.id,
      actionType: "region-mark",
      actionConfig: regionMarkAction as unknown as Record<string, unknown>,
      status: "pending",
      result: null,
      error: null,
    })
    .returning();

  console.log("[Test] Step 1 created (region-mark):", step1.id);

  // 3. 创建 Step 2：satellite 油膜识别（3.2），依赖 region-mark
  const satelliteAction = {
    id: "action-2",
    type: "satellite",
    name: "天基遥感影像AI油膜识别",
    description: "调用天基遥感影像数据，AI识别油膜区域",
    params: { query: "东海 油膜 识别", detectOilSpill: true },
    dependsOn: ["action-1"],
  };

  const [step2] = await db
    .insert(taskSteps)
    .values({
      taskId: task.id,
      actionType: "satellite",
      actionConfig: satelliteAction as unknown as Record<string, unknown>,
      status: "pending",
      result: null,
      error: null,
    })
    .returning();

  console.log("[Test] Step 2 created (satellite):", step2.id, "| dependsOn:", satelliteAction.dependsOn);

  // 4. 创建 jobTask（带 subTasks）
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
        { id: "sub-1", name: regionMarkAction.name, status: "pending", order: 1 },
        { id: "sub-2", name: satelliteAction.name, status: "pending", order: 2 },
        { id: "insight", name: "综合洞察生成", status: "pending", order: 3 },
      ],
    })
    .returning();

  console.log("[Test] JobTask created:", jobTask.id);

  // 5. 打印前端调试 URL
  const debugUrl = `http://localhost:5000/?sseTaskId=${task.id}`;
  console.log("\n========================================");
  console.log("[Test] 前端实时回显调试 URL:");
  console.log(debugUrl);
  console.log("========================================\n");
  console.log("[Test] 操作步骤:");
  console.log("  1. 复制上面的 URL 到浏览器打开");
  console.log("  2. 浏览器会自动建立 SSE 连接");
  console.log("  3. 回到终端按 Enter 执行 executor");
  console.log("  4. 前端会自动:");
  console.log("     - Step 1: flyTo 东海区域 + 渲染蓝色区域边界");
  console.log("     - Step 2: 渲染油膜中心点 + 黄色半透明油膜区域 + SAR 影像贴图\n");

  // 6. 等待用户按 Enter
  await waitForEnter();

  // 7. 等待浏览器完成 SSE 连接
  console.log("[Test] 等待 3 秒，确保浏览器 SSE 连接就绪...\n");
  await new Promise((r) => setTimeout(r, 3000));

  // 8. 执行 Executor（会推送 SSE）
  console.log("[Test] Starting executor...\n");
  try {
    await executorService.run(task.id, jobTask.id);
    console.log("\n[Test] Executor completed successfully");
  } catch (err) {
    console.error("\n[Test] Executor failed:", err);
  }

  // 8. 等待 SSE 消息送达
  await new Promise((r) => setTimeout(r, 3000));

  // 9. 打印详细结果
  console.log("\n========================================");
  console.log("[Test] 执行结果验证");
  console.log("========================================");

  const jt = await db.select().from(jobTasks).where(eq(jobTasks.id, jobTask.id));
  console.log("\n[Test] JobTask final subTasks:");
  console.log(JSON.stringify(jt[0]?.subTasks, null, 2));

  const evs = await db.select().from(eventsTable).where(eq(eventsTable.agentTaskId, task.id));
  console.log(`\n[Test] Events created: ${evs.length}`);

  // 10. 打印 steps 结果（含 operations）
  const stepsResult = await db.select().from(taskSteps).where(eq(taskSteps.taskId, task.id));
  console.log("\n[Test] Steps result operations:");
  for (const s of stepsResult) {
    const result = s.result as Record<string, unknown> | null;
    const ops = result?.operations as Array<Record<string, unknown>> | undefined;
    console.log(`  - ${s.actionType}: operations=${ops ? ops.length : 0}`);
    if (ops) {
      ops.forEach((op: any) => console.log(`    op: ${op.type} | ${JSON.stringify(op.bounds || op.coordinates?.length + ' coords').slice(0, 80)}`));
    }
  }

  for (const ev of evs as any[]) {
    console.log(`\n  ── Event: ${ev.title} ──`);
    console.log(`     status: ${ev.status}`);
    console.log(`     gisData: ${ev.gisData ? "YES" : "NO"}`);

    if (ev.gisData) {
      const gd = ev.gisData as any;
      console.log(`     gisData.type: ${gd.type}`);
      console.log(`     entities: ${gd.entities?.length || 0}`);
      console.log(`     regions: ${gd.regions?.length || 0}`);
      console.log(`     imageOverlays: ${gd.imageOverlays?.length || 0}`);

      if (gd.imageOverlays?.length > 0) {
        for (const img of gd.imageOverlays) {
          console.log(`       - ${img.id}: ${img.url}`);
          console.log(`         rectangle: W=${img.rectangle.west}, S=${img.rectangle.south}, E=${img.rectangle.east}, N=${img.rectangle.north}`);
          console.log(`         alpha: ${img.alpha}, tile: ${img.tileWidth}x${img.tileHeight}`);
        }
      }

      if (gd.entities?.length > 0) {
        for (const ent of gd.entities) {
          console.log(`       entity: ${ent.id} | ${ent.name} | [${ent.coordinates?.join(", ")}]`);
        }
      }

      if (gd.regions?.length > 0) {
        for (const reg of gd.regions) {
          console.log(`       region: ${reg.id} | ${reg.name} | ${reg.coordinates?.length} points`);
        }
      }
    }
  }

  console.log("\n[Test] Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
