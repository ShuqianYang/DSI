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

  console.log("\n=== 2. 创建测试订阅 ===");
  const [sub] = await db.insert(subscriptions).values({
    name: "东海海域态势日报",
    type: "daily",
    schedule: "0 9 * * *",
    nextExecuteTime: new Date(Date.now() - 60000), // 1分钟前，已到期
    status: "running",
    toolType: "daily_report",
    queryParams: { report_type: "all" },
  }).returning();
  console.log(`创建订阅: [${sub.id}] ${sub.name} | next=${sub.nextExecuteTime.toISOString()}`);

  console.log("\n=== 3. 模拟 Scheduler 执行订阅 ===");
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
  if (!result.success) {
    console.error("错误:", result.error);
  }
  if (result.data) {
    console.log("返回数据:", JSON.stringify(result.data, null, 2).slice(0, 500));
  }

  console.log("\n=== 4. 模拟写入 events 表（Scheduler 逻辑）===");
  if (result.success) {
    const content = (result.data?.report_content as string) || "日报生成完成";
    await db.insert(events).values({
      taskName: sub.name,
      title: `订阅任务「${sub.name}」执行完成`,
      content,
      status: "success",
      agentTaskId: null,
    });
    console.log("已写入 events 表");
  }

  console.log("\n=== 5. 验证结果 ===");
  const evts = await db.select().from(events);
  console.log(`Events 表记录数: ${evts.length}`);
  evts.forEach((e) => {
    console.log(`  [${e.id}] ${e.title} | status=${e.status}`);
    console.log(`    content: ${e.content?.slice(0, 100)}...`);
  });

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
