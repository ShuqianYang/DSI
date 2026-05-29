import "dotenv/config";
import { db } from "../src/config/database.js";
import { subscriptions, events } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import { actionsService } from "../src/modules/actions/service.js";
import type { Action } from "@datasourceintelligence/shared";

async function main() {
  console.log("=== 1. 清理旧数据 ===");
  await db.delete(events);
  await db.delete(subscriptions);
  console.log("Events 和 Subscriptions 表已清空");

  console.log("\n=== 2. 创建测试订阅（模拟用户创建）===");
  const [sub] = await db.insert(subscriptions).values({
    name: "东海海域态势日报",
    type: "daily",
    schedule: "0 9 * * *",
    nextExecuteTime: new Date(Date.now() - 60000), // 1分钟前，已到期
    status: "running",
    toolType: "daily_report",
    queryParams: { report_type: "all" },
  }).returning();
  console.log(`创建订阅: [${sub.id}] ${sub.name}`);
  console.log(`  type=${sub.type} | status=${sub.status} | next=${sub.nextExecuteTime.toISOString()}`);

  console.log("\n=== 3. Scheduler 扫描到到期订阅并执行 ===");
  const action: Action = {
    id: `sub-${sub.id}`,
    type: sub.toolType as Action["type"],
    name: sub.name,
    description: `定时订阅执行: ${sub.name}`,
    params: {
      ...(sub.queryParams as Record<string, unknown>),
      query: sub.name,
    },
  };

  console.log(`执行 Action: ${action.type} - ${action.name}`);
  const result = await actionsService.execute(action);
  console.log(`执行结果: ${result.success ? "成功" : "失败"}`);

  console.log("\n=== 4. Scheduler 写入事件 + 更新订阅状态 ===");
  if (result.success) {
    const content = (result.data?.report_content as string) || "日报生成完成";

    // 4a. 写入 events 表（这就是用户看到的"事件"）
    await db.insert(events).values({
      taskName: sub.name,
      title: `订阅任务「${sub.name}」执行完成`,
      content,
      status: "success",
      agentTaskId: null,
    });
    console.log("[OK] events 表已插入记录");

    // 4b. 更新订阅：lastExecuteTime, nextExecuteTime, lastResult
    const nextTime = new Date(Date.now() + 24 * 60 * 60 * 1000); // daily = +1天
    await db.update(subscriptions)
      .set({
        lastExecuteTime: new Date(),
        lastResult: result.data || {},
        nextExecuteTime: nextTime,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, sub.id));
    console.log(`[OK] subscriptions 表已更新: nextExecuteTime=${nextTime.toISOString()}`);

    // 4c. SSE 推送（实际会通过 Redis 发送，这里仅打印）
    console.log(`[SSE] subscription_completed | sub=${sub.id} | tool=${sub.toolType}`);
  } else {
    // 失败处理
    await db.insert(events).values({
      taskName: sub.name,
      title: `订阅任务「${sub.name}」执行失败`,
      content: `错误: ${result.error || "未知错误"}`,
      status: "failed",
      agentTaskId: null,
    });
    await db.update(subscriptions)
      .set({ status: "failed", lastExecuteTime: new Date(), updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id));
    console.log("[FAIL] events 表已插入失败记录");
  }

  console.log("\n=== 5. 最终验证 ===");
  const finalSubs = await db.select().from(subscriptions);
  console.log(`Subscriptions 表: ${finalSubs.length} 条`);
  finalSubs.forEach((s) => {
    console.log(`  [${s.id}] ${s.name}`);
    console.log(`    status=${s.status} | last=${s.lastExecuteTime?.toISOString()} | next=${s.nextExecuteTime?.toISOString()}`);
  });

  const finalEvents = await db.select().from(events);
  console.log(`\nEvents 表: ${finalEvents.length} 条`);
  finalEvents.forEach((e) => {
    console.log(`  [${e.id}] ${e.title}`);
    console.log(`    status=${e.status} | createdAt=${e.createdAt?.toISOString()}`);
    console.log(`    content: ${e.content?.slice(0, 80)}...`);
  });

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
