import cron from "node-cron";
import { eq, and, lte } from "drizzle-orm";
import { db } from "../../config/database.js";
import { redisPublisher } from "../../config/redis.js";
import { subscriptions, events } from "../../db/schema.js";
import { actionsService } from "../actions/service.js";
import { SSE_CHANNEL } from "../../queue/taskQueue.js";
import type { Action, CreateTaskRequest } from "@datasourceintelligence/shared";
import * as taskService from "../tasks/service.js";
import { runAgentPipeline } from "../tasks/pipeline.js";

let schedulerStarted = false;

// 防止同一订阅并发执行的内存锁
const executingSubscriptions = new Set<string>();

export function startScheduler(): void {
  if (schedulerStarted) {
    console.log("[Scheduler] Already started, skipping");
    return;
  }
  schedulerStarted = true;

  // 每分钟扫描一次到期的订阅（已临时关闭）
  // cron.schedule("* * * * *", async () => {
  //   await scanAndExecuteSubscriptions();
  // });

  console.log("[Scheduler] Subscription scheduler DISABLED (scanning paused)");
}

async function scanAndExecuteSubscriptions() {
  const now = new Date();

  try {
    const dueSubs = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.status, "running"),
          lte(subscriptions.nextExecuteTime, now)
        )
      );

    if (dueSubs.length > 0) {
      console.log(`[Scheduler] Found ${dueSubs.length} due subscription(s)`);
    }

    for (const sub of dueSubs) {
      if (executingSubscriptions.has(sub.id)) {
        console.log(`[Scheduler] Subscription ${sub.id} already in flight, skipping`);
        continue;
      }
      await executeSubscription(sub);
    }
  } catch (err) {
    console.error("[Scheduler] Error scanning subscriptions:", err);
  }
}

async function executeSubscription(sub: typeof subscriptions.$inferSelect) {
  if (executingSubscriptions.has(sub.id)) {
    console.log(`[Scheduler] Subscription ${sub.id} already in flight (double check), skipping`);
    return;
  }
  executingSubscriptions.add(sub.id);

  console.log(`[Scheduler] Executing subscription ${sub.id} (${sub.name}), toolType=${sub.toolType}`);

  const toolType = sub.toolType || "daily_report";
  const queryParams = (sub.queryParams as Record<string, unknown>) || {};

  // ========== 火情研判 scenario：创建新 Task，走完整 Agent Pipeline ==========
  if (toolType === "fire-investigation-scenario") {
    const regionName = (queryParams.regionName as string) || "未知区域";
    const inputs = queryParams as Record<string, unknown>;
    const query = `[订阅触发] 火情研判·${regionName}`;

    console.log(
      `[Scheduler] Fire investigation scenario triggered for subscription ${sub.id}, region=${regionName}`
    );

    const task = await taskService.createTask({
      query,
      context: inputs,
      userId: sub.userId,
    } as CreateTaskRequest);

    // [已禁用] 通知前端：新任务已触发
    // redisPublisher.publish(
    //   SSE_CHANNEL,
    //   JSON.stringify({
    //     type: "subscription_triggered_task",
    //     subscriptionId: sub.id,
    //     taskId: task.id,
    //     name: sub.name,
    //     query,
    //   })
    // );

    // 异步跑完整 Pipeline（Planner → Router → Executor → SSE）
    runAgentPipeline(task.id, { query, context: inputs }).catch((err) => {
      console.error(
        `[Scheduler] Pipeline error for fire scenario task ${task.id}:`
        ,err
      );
    });

    // 更新订阅执行时间，不写入 events（研判过程自带 SSE + events）
    const nextTime = computeNextExecuteTime(sub.schedule, sub.type);
    await db
      .update(subscriptions)
      .set({
        lastExecuteTime: new Date(),
        nextExecuteTime: nextTime,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, sub.id));

    console.log(
      `[Scheduler] Fire scenario subscription ${sub.id} triggered task ${task.id}, next at ${nextTime.toISOString()}`
    );

    executingSubscriptions.delete(sub.id);
    return;
  }
  // ================================================================

  // 构造 Action
  const action: Action = {
    id: `sub-${sub.id}`,
    type: toolType as Action["type"],
    name: sub.name,
    description: `定时订阅执行: ${sub.name}`,
    params: {
      ...queryParams,
      query: sub.name,
    },
  };
  console.log(`[Scheduler] Action constructed: type=${action.type}, params=`, JSON.stringify(action.params));

  try {
    const execStart = Date.now();
    const result = await actionsService.execute(action);
    console.log(`[Scheduler] Action executed in ${Date.now() - execStart}ms, success=${result.success}`);

    if (result.success) {
      // [已禁用] 写入 events 表通知用户
      // await db.insert(events).values({
      //   userId: sub.userId,
      //   taskName: sub.name,
      //   title: `订阅任务「${sub.name}」执行完成`,
      //   content: extractContentFromResult(result.data, toolType),
      //   status: "success",
      //   agentTaskId: null,
      // });

      // 更新订阅状态
      const nextTime = computeNextExecuteTime(sub.schedule, sub.type);
      await db
        .update(subscriptions)
        .set({
          lastExecuteTime: new Date(),
          lastResult: result.data || {},
          nextExecuteTime: nextTime,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, sub.id));

      // SSE 推送
      redisPublisher.publish(
        SSE_CHANNEL,
        JSON.stringify({
          type: "subscription_completed",
          subscriptionId: sub.id,
          name: sub.name,
          toolType,
        })
      );

      console.log(`[Scheduler] Subscription ${sub.id} executed successfully, next at ${nextTime.toISOString()}`);
    } else {
      // 执行失败：标记失败，不重试
      await handleSubscriptionFailure(sub, result.error || "执行返回失败");
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await handleSubscriptionFailure(sub, error);
  } finally {
    executingSubscriptions.delete(sub.id);
  }
}

async function handleSubscriptionFailure(
  sub: typeof subscriptions.$inferSelect,
  error: string
) {
  console.error(`[Scheduler] Subscription ${sub.id} failed: ${error}`);

  // [已禁用] 写入 events 通知用户
  // await db.insert(events).values({
  //   userId: sub.userId,
  //   taskName: sub.name,
  //   title: `订阅任务「${sub.name}」执行失败`,
  //   content: `订阅任务执行失败，错误信息：${error}\n\n该订阅已暂停，如需恢复请手动重新启用。`,
  //   status: "failed",
  //   agentTaskId: null,
  // });

  // 更新订阅状态为 paused（不重试）
  await db
    .update(subscriptions)
    .set({
      status: "paused",
      lastExecuteTime: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, sub.id));

  // SSE 推送失败通知
  redisPublisher.publish(
    SSE_CHANNEL,
    JSON.stringify({
      type: "subscription_failed",
      subscriptionId: sub.id,
      name: sub.name,
      error,
    })
  );
}

// 从执行结果中提取展示内容
function extractContentFromResult(
  data: Record<string, unknown> | undefined,
  toolType: string
): string {
  if (!data) return "执行完成，无返回数据";

  switch (toolType) {
    case "daily_report":
      return (data.report_content as string) || "日报生成完成";
    case "intelligent_qa":
      return (data.report_content as string) || "查询完成";
    case "satellite": {
      const msg = data.message as string;
      const table = data.table as string;
      return msg + (table ? "\n\n" + table : "");
    }
    case "maritime":
      return (data.summary as Record<string, unknown>)?.riskAssessment as string || "海域态势分析完成";
    default:
      return JSON.stringify(data).slice(0, 500);
  }
}

// 计算下一次执行时间
function computeNextExecuteTime(schedule: string, subType: string): Date {
  const now = new Date();

  // 根据类型简单推算
  switch (subType) {
    case "daily":
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case "weekly":
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    case "realtime": {
      // 从 cron 表达式推断间隔（MVP 简化）
      if (schedule.includes("*/30")) return new Date(now.getTime() + 30 * 60 * 1000);
      if (schedule.includes("*/15")) return new Date(now.getTime() + 15 * 60 * 1000);
      if (schedule.includes("*/5")) return new Date(now.getTime() + 5 * 60 * 1000);
      return new Date(now.getTime() + 30 * 60 * 1000); // 默认30分钟
    }
    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
}
