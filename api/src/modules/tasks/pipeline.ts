import { v4 as uuidv4 } from "uuid";
import { db } from "../../config/database.js";
import { jobTasks } from "../../db/schema.js";
import * as taskService from "./service.js";
import { plannerService } from "../planner/service.js";
import { routerService } from "../router/service.js";
import { taskQueue } from "../../queue/taskQueue.js";
import { executorService } from "../executor/service.js";
import { actionsService } from "../actions/service.js";
import { createSubscription } from "../subscriptions/service.js";
import { notifyTaskUpdate, notifyGlobalClients } from "../../sse/sseManager.js";
import { runHarnessPipeline } from "../harness/runAgentPipeline.js";
import type { CreateTaskRequest, Action } from "@datasourceintelligence/shared";

// ============================================================
// Agent Harness 环境变量开关
// ============================================================
// AGENT_HARNESS_ENABLED=true  ：启用新 harness 路径（template/skill + Agent Loop）
// AGENT_HARNESS_ENABLED=false ：直接走旧 Planner → Router → Executor 路径
// 默认 false（保守策略，确保生产环境不受影响）
const HARNESS_ENABLED = process.env.AGENT_HARNESS_ENABLED === "true";

export function inferJobType(
  actions: Array<{ type?: string; params?: Record<string, unknown> }>
): "daily" | "weekly" | "realtime" {
  const types = actions.map((a) => a.type).filter((t): t is string => typeof t === "string");
  if (types.includes("daily_report")) return "daily";
  if (types.includes("subscription")) {
    const sub = actions.find((a) => a.type === "subscription");
    const schedule = (sub?.params?.schedule as string) || "";
    if (schedule.includes("* * 1")) return "weekly";
    return "daily";
  }
  if (
    types.some((t) =>
      ["maritime", "intelligence", "satellite", "intelligent_qa", "news"].includes(t)
    )
  ) {
    return "realtime";
  }
  return "daily";
}

export function computeNextExecuteTime(schedule: string): Date {
  // 简单计算：根据 cron 表达式推算下一次执行时间（MVP 简化版）
  const now = new Date();
  const [minute, hour] = schedule.split(" ").map(Number);
  const next = new Date(now);
  next.setHours(hour ?? 9, minute ?? 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

// ==================== Intent 路由分支 ====================

/**
 * 硬编码场景缺参数路径：创建 requirement，提示用户缺数据
 */
async function runMissingParamsFlow(
  taskId: string,
  body: CreateTaskRequest,
  classification: { intent: string; missingParams: string[] }
) {
  console.log(`[Pipeline] Missing params flow for task ${taskId}: ${classification.missingParams.join(", ")}`);
  const task = await taskService.getTaskById(taskId);

  const missingText = classification.missingParams.join("、");
  const intentName =
    classification.intent === "earthquake"
      ? "地震评估"
      : classification.intent === "flood"
        ? "洪涝评估"
        : classification.intent === "fire"
          ? "火情研判"
          : classification.intent === "oil_spill"
            ? "油污溯源"
            : classification.intent;

  // [已移除] requirement 创建移至 executor 统一评估
  await taskService.updateTaskStatus(taskId, "completed");

  notifyTaskUpdate(taskId, {
    type: "completed",
    taskId,
    status: "completed",
    message: `当前系统可以处理${intentName}，但您的提问缺少以下信息：${missingText}。请补充后重新提问。`,
  });
}

// ==================== 主入口：Intent 路由 ====================

export async function runAgentPipeline(taskId: string, body: CreateTaskRequest) {
  // 开关关闭：直接走旧路径（仍需 classifyIntent 命中硬编码场景）
  if (!HARNESS_ENABLED) {
    console.log(`[Pipeline] Harness disabled, running legacy pipeline for task ${taskId}`);
    const classification = await plannerService.classifyIntent(body.query);
    console.log(
      `[Pipeline] Intent=${classification.intent}, hardcoded=${classification.hardcoded}`
    );
    if (classification.hardcoded) {
      if (classification.missingParams.length > 0) {
        return runMissingParamsFlow(taskId, body, classification);
      }
      return runLegacyAgentPipeline(taskId, body, classification);
    }
    return runLegacyAgentPipeline(taskId, body);
  }

  try {
    // Phase 0.5：新 harness 入口（Template-first + Observation-driven Agent Loop）
    // 先尝试 harness，如果返回 legacy_fallback 再回退旧 pipeline
    console.log(`[Pipeline] Phase 0.5: Trying harness for task ${taskId}`);
    const harnessResult = await runHarnessPipeline(taskId, body);

    if (harnessResult.status === "legacy_fallback") {
      console.log(`[Pipeline] Harness returned legacy_fallback, falling back to old pipeline`);
      const classification = await plannerService.classifyIntent(body.query);
      console.log(
        `[Pipeline] Intent=${classification.intent}, hardcoded=${classification.hardcoded}`
      );

      if (classification.hardcoded) {
        if (classification.missingParams.length > 0) {
          return runMissingParamsFlow(taskId, body, classification);
        }
        return runLegacyAgentPipeline(taskId, body, classification);
      }

      return runLegacyAgentPipeline(taskId, body);
    }

    // harness 处理完成，保存结果并更新 task 状态
    const resultData: Record<string, unknown> = {};
    if (harnessResult.finalText) {
      resultData.finalText = harnessResult.finalText;
    }
    if (harnessResult.observations) {
      resultData.observations = harnessResult.observations;
    }
    resultData.mode = harnessResult.status;
    await taskService.updateTaskResult(
      taskId,
      resultData,
      harnessResult.status === "failed" ? "failed" : "completed"
    );
    return;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Pipeline] Harness failed for task ${taskId}, fallback to legacy:`, errorMsg);
    await taskService.updateTaskStatus(taskId, "failed", errorMsg);

    try {
      return runLegacyAgentPipeline(taskId, body);
    } catch (legacyError) {
      const legacyErrorMsg = legacyError instanceof Error ? legacyError.message : String(legacyError);
      console.error(`[Pipeline] Legacy pipeline also failed:`, legacyErrorMsg);
      notifyTaskUpdate(taskId, {
        type: "failed",
        taskId,
        status: "failed",
        message: legacyErrorMsg,
      });
    }
  }
}

// ==================== 原有流程（保留，场景完整参数时调用）====================

export async function runLegacyAgentPipeline(
  taskId: string,
  body: CreateTaskRequest,
  classification?: { intent: string; hardcoded?: boolean; params: Record<string, unknown>; missingParams: string[]; confidence: number }
) {
  try {
    // --- Planner 阶段 ---
    notifyTaskUpdate(taskId, {
      type: "planning",
      stage: "planner",
      message: "正在分析用户意图并生成执行计划...",
    });

    const plan = await plannerService.generatePlan(body.query, {
      ...body.context,
      _classification: classification,
    });
    await taskService.updateTaskPlan(taskId, plan);

    // 检查 plan 中是否有 unsupported 步骤
    const unsupportedSteps = (plan.steps || []).filter(
      (s: Record<string, unknown>) => s.supportStatus === "unsupported"
    );
    const unsupportedSubtasks = (plan.subtasks || []).filter(
      (s: Record<string, unknown>) => s.supportStatus === "unsupported"
    );
    if (unsupportedSteps.length > 0 || unsupportedSubtasks.length > 0) {
      const allUnsupported = [...unsupportedSteps, ...unsupportedSubtasks];
      const names = allUnsupported.map((s: Record<string, unknown>) => s.name || s.description || "未知步骤").join("、");
      notifyTaskUpdate(taskId, {
        type: "planning_warning",
        taskId,
        message: `计划生成完成，但以下部分当前系统暂不支持：${names}。其余步骤将正常执行。`,
        unsupportedCount: allUnsupported.length,
      });
    }

    notifyTaskUpdate(taskId, {
      type: "planning_done",
      taskId,
      plan: {
        goal: plan.goal,
        reasoning: plan.reasoning,
        steps: (plan.steps || []).map((s) => ({
          id: s.id,
          description: s.description,
          purpose: s.purpose,
        })),
        scenario: plan.scenario,
        thinkingChain: plan.thinkingChain,
        subtasks: plan.subtasks,
        mainTask: plan.mainTask,
        finalEvent: plan.finalEvent,
      },
    });

    // --- Router 阶段 ---
    notifyTaskUpdate(taskId, {
      type: "routing",
      stage: "router",
      message: "正在决策执行工具...",
    });

    const rawActions = await routerService.decideActions(plan, body.query, classification);

    // 去重：同一 action id 只保留一个
    const seenIds = new Set<string>();
    const actions = rawActions.filter((a) => {
      if (seenIds.has(a.id)) return false;
      seenIds.add(a.id);
      return true;
    });

    await taskService.updateTaskActions(taskId, actions);

    notifyTaskUpdate(taskId, {
      type: "routing_done",
      taskId,
      actions: actions.map((a) => ({
        id: a.id,
        type: a.type,
        name: a.name,
        description: a.description,
        params: a.params,
        dependsOn: a.dependsOn,
      })),
    });

    // 分离三类 action
    const subscriptionActions = actions.filter((a) => a.type === "subscription");
    const subscribedToolTypes = new Set(
      subscriptionActions
        .map((a) => (a.params as Record<string, unknown>)?.toolType as string)
        .filter(Boolean)
    );
    const normalActions = actions.filter(
      (a) =>
        a.type !== "subscription" &&
        a.type !== "requirement" &&
        !subscribedToolTypes.has(a.type)
    );

    // [已移除] unsupported steps 不再机械转成 requirement actions
    // plan 中的 unsupported 信息会随 task.plan 保存，由 executor 执行完成后统一评估是否生成 requirement

    // 处理 subscription
    const task = await taskService.getTaskById(taskId);
    for (const subAction of subscriptionActions) {
      const params = subAction.params as Record<string, unknown>;
      const sub = await createSubscription({
        userId: task?.userId,
        name: subAction.name,
        type: (params.subscriptionType as string) || "daily",
        schedule: (params.schedule as string) || "0 9 * * *",
        nextExecuteTime: computeNextExecuteTime(
          (params.schedule as string) || "0 9 * * *"
        ),
        status: "running",
        toolType: (params.toolType as string) || undefined,
        queryParams: (params.toolParams as Record<string, unknown>) || {},
      });

      const toolType = params.toolType as string;
      const toolParams = (params.toolParams as Record<string, unknown>) || {};
      // [已禁用] fire-investigation-scenario 的延迟自动触发
      // if (toolType === "fire-investigation-scenario") {
      //   const delayMs = parseInt(process.env.DEMO_FIRE_TRIGGER_DELAY_MS || "15000", 10);
      //   const regionName = (toolParams.regionName as string) || "未知区域";
      //   setTimeout(() => {
      //     (async () => {
      //       const triggerQuery = `[订阅触发] 火情研判·${regionName}`;
      //       const triggerTask = await taskService.createTask({
      //         query: triggerQuery,
      //         context: toolParams,
      //         userId: task?.userId,
      //       });
      //       notifyGlobalClients({
      //         type: "subscription_triggered_task",
      //         subscriptionId: sub.id,
      //         taskId: triggerTask.id,
      //         name: sub.name,
      //         query: triggerQuery,
      //       });
      //       await new Promise((resolve) => setTimeout(resolve, 2000));
      //       runAgentPipeline(triggerTask.id, { query: triggerQuery, context: toolParams }).catch((err) => {
      //         console.error(`[Pipeline] Delayed fire investigation trigger error:`, err);
      //       });
      //     })();
      //   }, delayMs);
      // }
    }

    // [已移除] requirement 创建移至 executor 统一评估

    // 普通 actions → executor
    if (normalActions.length > 0) {
      await taskService.createTaskSteps(taskId, normalActions);
      const [jobTask] = await db
        .insert(jobTasks)
        .values({
          userId: task?.userId,
          name: task?.query?.substring(0, 50) || "任务",
          type: inferJobType(normalActions as Array<{ type?: string; params?: Record<string, unknown> }>),
          status: "running",
          dataCount: 0,
          agentTaskId: taskId,
          subTasks: [
            ...normalActions.map((a, i) => ({
              id: `sub-${i + 1}`,
              name: a.name,
              status: "pending" as string,
              order: i + 1,
            })),
            {
              id: "insight",
              name: "综合洞察生成",
              status: "pending" as string,
              order: normalActions.length + 1,
            },
          ],
        })
        .returning();

      if (process.env.NODE_ENV === "development") {
        console.log(`[Pipeline] Dev mode: executing task ${taskId} directly`);
        executorService.run(taskId, jobTask.id).catch((err) => {
          console.error(`[Pipeline] Direct execution error:`, err);
        });
      } else {
        await taskQueue.add(
          "execute",
          { taskId, jobTaskId: jobTask.id },
          {
            jobId: uuidv4(),
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
          }
        );
      }
    } else if (subscriptionActions.length > 0) {
      await taskService.updateTaskStatus(taskId, "completed");
      notifyTaskUpdate(taskId, { type: "completed", taskId, status: "completed", message: "" });
    } else {
      // 检查 plan 中是否有 unsupported steps，有则启动 executor 统一评估
      const planUnsupported = (plan.steps || []).filter(
        (s: Record<string, unknown>) => s.supportStatus === "unsupported"
      );

      if (planUnsupported.length > 0) {
        console.log(`[Pipeline] No actions but ${planUnsupported.length} unsupported steps, starting executor for evaluation`);
        const [jobTask] = await db.insert(jobTasks).values({
          userId: task?.userId,
          name: task?.query?.substring(0, 50) || "任务",
          type: "realtime",
          status: "running",
          dataCount: 0,
          agentTaskId: taskId,
          subTasks: [],
        }).returning();

        if (process.env.NODE_ENV === "development") {
          executorService.run(taskId, jobTask.id).catch((err) => {
            console.error(`[Pipeline] Executor error:`, err);
          });
        } else {
          await taskQueue.add(
            "execute",
            { taskId, jobTaskId: jobTask.id },
            {
              jobId: uuidv4(),
              attempts: 3,
              backoff: { type: "exponential", delay: 5000 },
            }
          );
        }
      } else {
        await taskService.updateTaskStatus(taskId, "completed");
        notifyTaskUpdate(taskId, {
          type: "completed",
          taskId,
          status: "completed",
          message: "当前系统暂不支持该请求，没有可用工具能完成此任务。",
        });
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[runAgentPipeline] Error for task ${taskId}:`, errorMsg);
    await taskService.updateTaskStatus(taskId, "failed", errorMsg);
    notifyTaskUpdate(taskId, { type: "failed", taskId, status: "failed", message: errorMsg });
  }
}
