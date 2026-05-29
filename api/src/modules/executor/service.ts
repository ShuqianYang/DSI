import { eq } from "drizzle-orm";
import { db } from "../../config/database.js";
import { redisPublisher } from "../../config/redis.js";
import { tasks, taskSteps, jobTasks, events, insights, subscriptions, requirements } from "../../db/schema.js";
import * as taskService from "../tasks/service.js";
import { actionsService } from "../actions/service.js";
import { generateInsights } from "../insights/generator.js";
import { notifyTaskUpdate } from "../../sse/sseManager.js";
import {
  toSharedEntity,
  toSharedTrajectory,
  vesselsToSharedEntities,
  aircraftsToSharedEntities,
} from "@datasourceintelligence/shared";
import type { Action, MaritimeVessel, MaritimeAircraft } from "@datasourceintelligence/shared";
import type { ExecutorService } from "./types.js";
import { SSE_CHANNEL } from "../../queue/taskQueue.js";

import { analyzeBlockReason } from "../blockage-analyzer/service.js";
import { createRequirement } from "../requirements/service.js";
import { submitToExternalSystem } from "../requirements/externalSubmit.js";
import { evaluateRequirementNeed, type BlockedItem } from "../../lib/requirementEvaluator.js";

// ========== 运行时阻断异常 ==========
class CaseValidationError extends Error {
  constructor(
    public readonly action: Action,
    public readonly reason: string,
    public readonly blockedReason: string
  ) {
    super(`CaseValidationError: ${action.type} - ${reason}`);
    this.name = "CaseValidationError";
  }
}

// 区域别名归一化
const REGION_ALIASES: Record<string, string> = {
  "东海": "中国东海",
  "柳南区": "广西柳州市柳南区",
  "石门": "湖南石门县",
  "湖南石门": "湖南石门县",
  "石门县": "湖南石门县",
};

// 已知海域列表
const KNOWN_SEAS = [
  "渤海", "黄海", "东海", "台湾海峡", "南海", "北部湾",
  "日本海", "菲律宾海", "鄂霍次克海", "西太平洋",
  "马六甲海峡", "印度洋北部", "印度洋中部", "孟加拉湾", "阿拉伯海",
  "波斯湾", "红海", "亚丁湾", "地中海东部", "地中海西部", "苏伊士运河",
  "中国东海",
];

// weather-fetch 已知区域
const WEATHER_REGIONS = [
  "东海油膜片区", "石门县", "柳州", "广西柳州市柳南区", "湖南石门县",
];

// region-mark 预设区域
const REGION_MARK_PRESETS = [
  "中国东海", "东海", "柳州", "柳州市", "柳南区",
  "广西柳州市柳南区", "石门", "石门县", "湖南石门", "湖南石门县",
];

function normalizeRegion(region: string): string {
  return REGION_ALIASES[region] || region;
}

// Executor 层校验：参数合法性 + 运行时 context 依赖
function validateActionCase(action: Action, context: Record<string, unknown>): void {
  const params = action.params || {};

  // ========== 参数合法性校验（原 Router 层逻辑迁移至此）==========
  switch (action.type) {
    case "region-mark": {
      const region = params.region as string | undefined;
      if (region && !REGION_MARK_PRESETS.includes(region)) {
        const normalized = normalizeRegion(region);
        if (REGION_MARK_PRESETS.includes(normalized)) {
          action.params = { ...params, region: normalized };
          break;
        }
        throw new CaseValidationError(
          action,
          `region "${region}" 不在预设列表中`,
          "PARAM_OUT_OF_ENUM"
        );
      }
      break;
    }

    case "satellite": {
      const hasFlag =
        params.fireScenario === true ||
        params.earthquakeScenario === true ||
        params.floodScenario === true ||
        params.detectOilSpill === true;
      if (!hasFlag) {
        throw new CaseValidationError(
          action,
          "satellite 必须指定 fireScenario/earthquakeScenario/floodScenario/detectOilSpill 之一",
          "PARAM_NOT_SUPPORTED"
        );
      }
      break;
    }

    case "fire-detector": {
      const region = params.region as string | undefined;
      const fromScenario = params.fromScenario as boolean | undefined;
      if (region !== "Kensai" && !fromScenario) {
        throw new CaseValidationError(
          action,
          "fire-detector 需要 region=Kensai 或 fromScenario=true",
          "PARAM_OUT_OF_ENUM"
        );
      }
      break;
    }

    case "ais-fetch":
    case "maritime": {
      const region = params.region as string | undefined;
      if (region && !KNOWN_SEAS.includes(region) && !KNOWN_SEAS.includes(normalizeRegion(region))) {
        throw new CaseValidationError(
          action,
          `region "${region}" 不在已知海域列表中`,
          "PARAM_OUT_OF_ENUM"
        );
      }
      break;
    }

    case "weather-fetch": {
      const region = params.region as string | undefined;
      if (region && !WEATHER_REGIONS.includes(region) && !WEATHER_REGIONS.includes(normalizeRegion(region))) {
        throw new CaseValidationError(
          action,
          `region "${region}" 不在已知气象区域列表中`,
          "PARAM_OUT_OF_ENUM"
        );
      }
      break;
    }

    case "earthquake-evaluation": {
      const region = params.region as string | undefined;
      if (region && region !== "柳州" && region !== "广西柳州市柳南区") {
        throw new CaseValidationError(
          action,
          `region "${region}" 必须为柳州或广西柳州市柳南区`,
          "PARAM_OUT_OF_ENUM"
        );
      }
      break;
    }

    case "flood-evaluation": {
      const region = params.region as string | undefined;
      if (region && region !== "石门县" && region !== "湖南石门县") {
        throw new CaseValidationError(
          action,
          `region "${region}" 必须为石门县或湖南石门县`,
          "PARAM_OUT_OF_ENUM"
        );
      }
      break;
    }

    default:
  }

  // ========== 运行时 context 依赖校验 ==========

  // 递归搜索 context 中任意层级是否满足条件（兼容 action 返回的嵌套 data 结构）
  function findInContext(
    predicate: (obj: Record<string, unknown>) => boolean
  ): boolean {
    const search = (value: unknown): boolean => {
      if (!value || typeof value !== "object") return false;
      const obj = value as Record<string, unknown>;
      if (predicate(obj)) return true;
      for (const v of Object.values(obj)) {
        if (search(v)) return true;
      }
      return false;
    };
    return Object.values(context).some(search);
  }

  switch (action.type) {
    case "oil-drift": {
      // satellite 返回 oilSpill.outline / oilSpill.centerLng/Lat；兼容 oilFilmGeom
      const hasOilFilm = findInContext((obj) => {
        const oilSpill = obj.oilSpill as Record<string, unknown> | undefined;
        return !!obj.oilFilmGeom || !!(oilSpill?.outline || oilSpill?.centerLng);
      });
      if (!hasOilFilm) {
        throw new CaseValidationError(
          action,
          "oil-drift 需要上游 satellite 返回的油膜数据（oilSpill / oilFilmGeom）",
          "CONTEXT_DEP_MISSING"
        );
      }
      break;
    }

    case "ais-match-suspects": {
      // oil-drift 返回 pollutionOrigin.lng/lat + timeRange；兼容 originPoint + timeWindow
      const hasOrigin = findInContext((obj) => {
        const po = obj.pollutionOrigin as Record<string, unknown> | undefined;
        return !!obj.originPoint || !!(po && typeof po.lng === "number");
      });
      const hasTimeWindow = findInContext((obj) => {
        const po = obj.pollutionOrigin as Record<string, unknown> | undefined;
        return !!obj.timeWindow || !!(po && typeof po.timeRange === "string");
      });
      if (!hasOrigin || !hasTimeWindow) {
        throw new CaseValidationError(
          action,
          "ais-match-suspects 需要 oil-drift 返回的排污原点（pollutionOrigin / originPoint）和时间窗",
          "CONTEXT_DEP_MISSING"
        );
      }
      break;
    }

    case "ais-suspect-ranking": {
      // ais-match-suspects 返回 vessels；兼容 matchedShips
      const hasMatched = findInContext((obj) =>
        Array.isArray(obj.matchedShips) || Array.isArray(obj.vessels)
      );
      if (!hasMatched) {
        throw new CaseValidationError(
          action,
          "ais-suspect-ranking 需要 ais-match-suspects 返回的嫌疑船列表（vessels / matchedShips）",
          "CONTEXT_DEP_MISSING"
        );
      }
      break;
    }

    case "earthquake-evaluation":
    case "flood-evaluation": {
      // satellite 返回 responseType 嵌在 data.data 中，需要递归搜索
      const hasPre = findInContext((obj) =>
        obj.responseType === "pre_earthquake" ||
        obj.responseType === "pre_flood" ||
        obj.phase === "pre"
      );
      const hasPost = findInContext((obj) =>
        obj.responseType === "post_earthquake" ||
        obj.responseType === "post_flood" ||
        obj.phase === "post"
      );
      if (!hasPre || !hasPost) {
        throw new CaseValidationError(
          action,
          `${action.type} 需要 satellite 返回的 pre 和 post 影像数据`,
          "CONTEXT_DEP_MISSING"
        );
      }
      break;
    }
  }
}

// DeepSeek API 配置（与 planner 共用）
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-v4-flash";

interface BlockedItem {
  source: "plan" | "executor";
  actionType: string;
  actionName: string;
  reason: string;
  blockAnalysis?: import("../blockage-analyzer/service.js").BlockAnalysisResult;
}

interface RequirementEvaluation {
  shouldCreate: boolean;
  reason: string;
  requirement?: {
    name: string;
    description: string;
    applicationScenario: string;
  };
}

// evaluateRequirementNeed 统一使用 lib/requirementEvaluator.ts 中的版本（第 22 行已导入）

export const executorService: ExecutorService = {
  run: async (taskId: string, jobTaskId?: string) => {
    console.log(`[Executor] Starting task ${taskId}, jobTaskId=${jobTaskId || "none"}`);

    await taskService.updateTaskStatus(taskId, "running");

    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const stepsRaw = await db
      .select()
      .from(taskSteps)
      .where(eq(taskSteps.taskId, taskId));
    const steps = stepsRaw.sort((a, b) => {
      const orderA = (a.actionConfig as any)?._order ?? 0;
      const orderB = (b.actionConfig as any)?._order ?? 0;
      return orderA - orderB;
    });

    if (steps.length === 0) {
      console.warn(`[Executor] No steps found for task ${taskId}`);

      // plan 中有 unsupported steps 时，统一评估是否生成 requirement
      const taskPlan = task.plan as Record<string, unknown> | undefined;
      const planSteps = taskPlan?.steps as Array<Record<string, unknown>> | undefined;
      const planUnsupported = (planSteps || []).filter(
        (s) => s.supportStatus === "unsupported" || s.supportStatus === "partial"
      );

      if (planUnsupported.length > 0) {
        console.log(`[Executor] ${planUnsupported.length} unsupported steps in plan, evaluating requirement...`);
        const allBlocked = planUnsupported.map((s) => ({
          source: "plan" as const,
          actionType: (s.capability as string) || "unknown",
          actionName: (s.description as string) || (s.purpose as string) || "未知步骤",
          reason: `Planner 判定需要能力 ${s.capability || "unknown"}，当前系统未提供`,
        }));

        try {
          const evaluation = await evaluateRequirementNeed(task.query, allBlocked);
          if (evaluation.shouldCreate && evaluation.requirements.length > 0) {
            for (const req of evaluation.requirements) {
              await createRequirement({
                userId: task.userId,
                description: req.description,
                chatId: taskId,
                status: "pending",
                requirementId: req.applicationScenario,
              });
              await submitToExternalSystem({
                name: req.name,
                description: req.description,
                applicationScenario: req.applicationScenario,
                type: req.type,
              }).catch((submitErr) => {
                console.error("[Executor] External submit failed:", submitErr);
              });
            }
            const firstReq = evaluation.requirements[0];
            await db.insert(events).values({
              userId: task.userId,
              taskName: "需求提报",
              title: `定制需求已提报：共 ${evaluation.requirements.length} 项`,
              content: `${evaluation.reason}\n\n${evaluation.requirements.map((r) => `[${r.type === 1 ? "数据" : r.type === 2 ? "工具" : "组件"}] ${r.name}: ${r.description}`).join("\n\n")}`,
              status: "success",
              agentTaskId: taskId,
            });
            notifyTaskUpdate(taskId, {
              type: "step_update",
              stepName: "需求提报",
              status: "completed",
              message: evaluation.reason,
            });
          } else {
            await db.insert(events).values({
              userId: task.userId,
              taskName: "需求评估",
              title: "当前请求暂不支持",
              content: evaluation.reason,
              status: "partial",
              agentTaskId: taskId,
            });
            notifyTaskUpdate(taskId, {
              type: "step_update",
              stepName: "需求评估",
              status: "failed",
              message: evaluation.reason,
            });
          }
        } catch (evalErr) {
          console.error("[Executor] Requirement evaluation failed:", evalErr);
        }
      }

      // 更新 job_task 状态并注入伪完成子任务，确保前端进度条能正常收起
      if (jobTaskId) {
        await db.update(jobTasks).set({
          status: "completed",
          subTasks: [{
            id: "custom",
            name: "定制任务",
            status: "completed",
            order: 1,
          }],
          updatedAt: new Date(),
        }).where(eq(jobTasks.id, jobTaskId));
      }
      await taskService.updateTaskResult(taskId, { message: "No actions to execute" }, "completed");
      notifyTaskUpdate(taskId, { type: "completed", taskId, status: "completed" });
      return;
    }

    // 获取或创建 job_task
    let jobTask: typeof jobTasks.$inferSelect;
    if (jobTaskId) {
      const [existing] = await db.select().from(jobTasks).where(eq(jobTasks.id, jobTaskId)).limit(1);
      if (existing) {
        jobTask = existing;
        // 用实际 steps 更新 subTasks，保留 controller 中可能已创建的 insight 子任务
        const existingSubTasks = (existing.subTasks || []) as Array<{ id: string; status: string; order?: number }>;
        const insightSubTask = existingSubTasks.find((s) => s.id === "insight");
        const updatedSubTasks = [
          ...steps.map((s, i) => ({
            id: `sub-${i + 1}`,
            name: s.actionConfig.name || s.actionType,
            description: (s.actionConfig as Record<string, unknown>).description as string || "",
            status: "pending" as string,
            order: i + 1,
          })),
          ...(insightSubTask ? [insightSubTask] : []),
        ];
        await db.update(jobTasks).set({ subTasks: updatedSubTasks }).where(eq(jobTasks.id, jobTaskId));
        jobTask = { ...jobTask, subTasks: updatedSubTasks };
      } else {
        // fallback：创建新的
        const [created] = await db.insert(jobTasks).values({
          userId: task.userId,
          name: task.query.substring(0, 50),
          type: inferJobType(Array.isArray(task.actions) ? (task.actions as unknown[]) : []),
          status: "running",
          dataCount: 0,
          agentTaskId: taskId,
          subTasks: [
            ...steps.map((s, i) => ({
              id: `sub-${i + 1}`,
              name: s.actionConfig.name || s.actionType,
              description: (s.actionConfig as Record<string, unknown>).description as string || "",
              status: "pending" as string,
              order: i + 1,
            })),
            {
              id: "insight",
              name: "综合洞察生成",
              description: "汇总各子任务结果，生成综合分析与建议",
              status: "pending" as string,
              order: steps.length + 1,
            },
          ],
        }).returning();
        jobTask = created;
      }
    } else {
      // 向后兼容：没有 jobTaskId 时创建新的
      const [created] = await db.insert(jobTasks).values({
        userId: task.userId,
        name: task.query.substring(0, 50),
        type: inferJobType(Array.isArray(task.actions) ? (task.actions as unknown[]) : []),
        status: "running",
        dataCount: 0,
        agentTaskId: taskId,
        subTasks: steps.map((s, i) => ({
          id: `sub-${i + 1}`,
          name: s.actionConfig.name || s.actionType,
          description: (s.actionConfig as Record<string, unknown>).description as string || "",
          status: "pending",
          order: i + 1,
        })),
      }).returning();
      jobTask = created;
    }

    const completedSteps = new Set<string>();
    const stepResults = new Map<string, Record<string, unknown>>();
    const toolResults: Record<string, unknown> = {};
    let totalDataCount = 0;

    // 聚合所有运行时阻断信息，执行完成后统一评估是否生成 requirement
    const blockedSteps: Array<{
      actionType: string;
      actionName: string;
      reason: string;
      blockReason: string;
      blockAnalysis?: import("../blockage-analyzer/service.js").BlockAnalysisResult;
    }> = [];

    // 用 step index 映射到 subTask，避免 name 匹配歧义
    const stepIndexMap = new Map<string, number>();
    steps.forEach((s, i) => stepIndexMap.set(s.id, i));

    // 维护子任务状态快照，避免使用 stale 的 jobTask.subTasks
    let currentSubTasks = [...(jobTask.subTasks as Array<{ id: string; status: string; order?: number }> || [])];

    try {
      for (const [stepIdx, step] of steps.entries()) {
        const action = step.actionConfig as Action;

        if (action.dependsOn) {
          const missing = action.dependsOn.filter((dep) => !completedSteps.has(dep));
          if (missing.length > 0) {
            console.warn(`[Executor] Step ${step.id} waiting for dependencies: ${missing.join(", ")}`);

            // 依赖未满足 → 标记为 skipped，避免残留 pending 导致状态不一致
            await taskService.updateStepStatus(step.id, "failed", undefined, `依赖步骤未成功完成: ${missing.join(", ")}`);
            publishStepUpdate(taskId, stepIdx, step.id, action.name, "failed", action.id, `依赖步骤未成功完成: ${missing.join(", ")}`, action.type);
// step_update 已通过 publishStepUpdate 走 Redis 推送，dev 模式下避免双通道重复

            currentSubTasks = currentSubTasks.map((s: Record<string, unknown>) =>
              (s.order as number) === stepIdx + 1 ? { ...s, status: "skipped" } : s
            );
            await db.update(jobTasks).set({ subTasks: currentSubTasks }).where(eq(jobTasks.id, jobTask.id));
            notifyTaskUpdate(taskId, { type: "progress", jobTaskId: jobTask.id });

            continue;
          }
        }

        await taskService.updateStepStatus(step.id, "running");

        // 同步把 jobTasks.subTasks 该项写成 running，否则进度窗（轮询 jobTask.subTasks）只能看到 pending → completed
        currentSubTasks = currentSubTasks.map((s: Record<string, unknown>) =>
          (s.order as number) === stepIdx + 1 ? { ...s, status: "running" } : s
        );
        await db.update(jobTasks).set({ subTasks: currentSubTasks }).where(eq(jobTasks.id, jobTask.id));

        publishStepUpdate(taskId, stepIdx, step.id, action.name, "running", action.id, action.type);
        notifyTaskUpdate(taskId, { type: "progress", jobTaskId: jobTask.id });
        // step_update 通过 publishStepUpdate 走 Redis 推送，避免 dev 模式下双通道重复
        console.log(`[Executor] Executing step ${step.id}: ${action.type} - ${action.name}`);

        // demo 节奏：先 running 再等 10 秒才 execute，这 10 秒里上一步 map 动画播放、当前 step 在思考过程卡片里转圈
        // 第一个 region-mark 步骤（如"东海"）缩短为 5 秒，避免首次等待过长
        const delayMs = stepIdx === 0 && action.type === 'region-mark' ? 5000 : 10000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));

        try {
          const context: Record<string, unknown> = {};
          if (action.dependsOn) {
            for (const depId of action.dependsOn) {
              const depResult = stepResults.get(depId);
              if (depResult) {
                context[depId] = depResult;
              }
            }
          }

          // 运行时 context 依赖校验
          validateActionCase(action, context);

          const result = await actionsService.execute(action, context);

          if (result.success) {
            await taskService.updateStepStatus(step.id, "completed", result.data);
            stepResults.set(action.id, result.data || {});
            toolResults[action.type] = result.data || {};
            completedSteps.add(action.id, action.type);
            const operations = (result.data as Record<string, unknown> | undefined)?.operations as Array<Record<string, unknown>> | undefined;
            // satellite 的 gisData 在 result.data.data.gisData（嵌套），region-mark 在 result.data.gisData（顶层）；nested 优先
            const dataObj = result.data as Record<string, unknown> | undefined;
            const gisData = (dataObj?.data as Record<string, unknown> | undefined)?.gisData ?? dataObj?.gisData;

            // 更新子任务状态（先写库，再发 SSE，避免前端 refresh 拿到旧数据）
            currentSubTasks = currentSubTasks.map((s: Record<string, unknown>) =>
              (s.order as number) === stepIdx + 1 ? { ...s, status: "completed" } : s
            );
            await db.update(jobTasks).set({ subTasks: currentSubTasks }).where(eq(jobTasks.id, jobTask.id));

            // 发送 SSE（数据库已更新，前端 refresh 能拿到最新状态）
            console.log(`[Executor] Step ${step.id} publishing gisData:`, gisData ? `type=${(gisData as any)?.type} cameraView=${!!(gisData as any)?.cameraView} regions=${(gisData as any)?.regions?.length} overlays=${(gisData as any)?.imageOverlays?.length}` : 'NONE');
            publishStepUpdate(taskId, stepIdx, step.id, action.name, "completed", action.id, undefined, operations, gisData, action.type);
            console.log(`[Executor] Step ${step.id} completed`);
            notifyTaskUpdate(taskId, { type: "progress", jobTaskId: jobTask.id });

            // 统计数据量
            const data = result.data;
            if (data) {
              if (Array.isArray(data.vessels)) totalDataCount += data.vessels.length;
              if (Array.isArray(data.findings)) totalDataCount += data.findings.length;
              if (Array.isArray(data.layers)) totalDataCount += data.layers.length;
              if (Array.isArray(data.records)) totalDataCount += data.records.length;
            }

            // 将执行结果写入展示表
            await writeDisplayData(taskId, jobTask.id, action, result.data);
          } else {
            await taskService.updateStepStatus(step.id, "failed", undefined, result.error);
            console.error(`[Executor] Step ${step.id} failed: ${result.error}`);

            // 更新子任务状态为失败
            currentSubTasks = currentSubTasks.map((s: Record<string, unknown>) =>
              (s.order as number) === stepIdx + 1 ? { ...s, status: "failed" } : s
            );
            await db.update(jobTasks).set({ subTasks: currentSubTasks }).where(eq(jobTasks.id, jobTask.id));
            publishStepUpdate(taskId, stepIdx, step.id, action.name, "failed", action.id, result.error, action.type);
            notifyTaskUpdate(taskId, { type: "progress", jobTaskId: jobTask.id });
          }
        } catch (err) {
          // 运行时阻断：记录原因，不立即创建 requirement，终止执行
          if (err instanceof CaseValidationError) {
            console.warn(
              `[Executor] Step ${step.id} blocked by case validation: ${err.reason}`
            );

            // 1. 标记当前 step 为 failed
            await taskService.updateStepStatus(
              step.id,
              "failed",
              undefined,
              `场景暂不支持: ${err.reason}`
            );
            currentSubTasks = currentSubTasks.map((s: Record<string, unknown>) =>
              (s.order as number) === stepIdx + 1
                ? { ...s, status: "failed" }
                : s
            );
            await db
              .update(jobTasks)
              .set({ subTasks: currentSubTasks })
              .where(eq(jobTasks.id, jobTask.id));
            publishStepUpdate(
              taskId,
              stepIdx,
              step.id,
              action.name,
              "failed",
              action.id,
              `场景暂不支持: ${err.reason}`,
              undefined,
              undefined,
              action.type
            );
            notifyTaskUpdate(taskId, {
              type: "progress",
              jobTaskId: jobTask.id,
            });

            // 2. AI 分析阻断原因并记录（供后续统一评估）
            try {
              const blockAnalysis = await analyzeBlockReason(
                task.query,
                err.action,
                stepResults,
                err.blockedReason
              );
              blockedSteps.push({
                actionType: err.action.type,
                actionName: err.action.name,
                reason: err.reason,
                blockReason: err.blockedReason,
                blockAnalysis,
              });
              console.log(
                `[Executor] Block analysis recorded: rootCause=${blockAnalysis.rootCause}, severity=${blockAnalysis.severity}`
              );
            } catch (analyzeErr) {
              console.error("[Executor] Block analysis failed:", analyzeErr);
              blockedSteps.push({
                actionType: err.action.type,
                actionName: err.action.name,
                reason: err.reason,
                blockReason: err.blockedReason,
              });
            }

            // 3. 通知用户（不提及 requirement，后续统一处理）
            notifyTaskUpdate(taskId, {
              type: "step_update",
              stepName: action.name,
              status: "failed",
              error: `当前场景暂不支持: ${err.reason}`,
            });

            break; // 终止 for 循环，后续统一评估
          }

          // 普通异常：按原有逻辑处理
          const error = err instanceof Error ? err.message : String(err);
          await taskService.updateStepStatus(step.id, "failed", undefined, error);
          console.error(`[Executor] Step ${step.id} error:`, error);

          // 更新子任务状态为失败
          currentSubTasks = currentSubTasks.map((s: Record<string, unknown>) =>
            (s.order as number) === stepIdx + 1 ? { ...s, status: "failed" } : s
          );
          await db.update(jobTasks).set({ subTasks: currentSubTasks }).where(eq(jobTasks.id, jobTask.id));
          publishStepUpdate(taskId, stepIdx, step.id, action.name, "failed", action.id, error, undefined, undefined, action.type);
          notifyTaskUpdate(taskId, { type: "progress", jobTaskId: jobTask.id });
        }
      }

      // 重新查询 steps 以获取最新状态（避免使用循环前查询的 stale 数据）
      let freshStepsRaw = await db.select().from(taskSteps).where(eq(taskSteps.taskId, taskId));
      let freshSteps = freshStepsRaw.sort((a, b) => {
        const orderA = (a.actionConfig as any)?._order ?? 0;
        const orderB = (b.actionConfig as any)?._order ?? 0;
        return orderA - orderB;
      });
      const hasFailed = freshSteps.some((s) => s.status === "failed");

      // 兜底：任务整体失败时，把仍 pending 的 steps 统一刷为 skipped，避免前端状态不一致
      if (hasFailed) {
        for (const s of freshSteps) {
          if (s.status === "pending") {
            await taskService.updateStepStatus(s.id, "failed", undefined, "前置步骤失败，任务已终止");
          }
        }
        // 重新查询以反映更新
        freshSteps = await db.select().from(taskSteps).where(eq(taskSteps.taskId, taskId));

        currentSubTasks = currentSubTasks.map((s: Record<string, unknown>) =>
          s.status === "pending" ? { ...s, status: "skipped" } : s
        );
        await db.update(jobTasks).set({ subTasks: currentSubTasks }).where(eq(jobTasks.id, jobTask.id));
        notifyTaskUpdate(taskId, { type: "progress", jobTaskId: jobTask.id });
      }

      const finalStatus = hasFailed ? "failed" : "completed";
      const jobStatus = hasFailed ? "failed" : (freshSteps.some((s) => s.status === "pending") ? "partial" : "completed");

      // 汇总结果
      const allResults: Record<string, unknown> = {};
      for (const [id, data] of stepResults) {
        allResults[id] = data;
      }

      await taskService.updateTaskResult(taskId, allResults, finalStatus);

      // 所有工具执行完成后，调用 Dify 生成综合洞察
      const insightSubTask = currentSubTasks.find((s) => s.id === "insight");
      if (insightSubTask && Object.keys(allResults).length > 0 && finalStatus === "completed") {
        const insightStepIndex = steps.length;
        const insightStepId = "insight";
        const insightActionName = "综合洞察生成";

        // 标记 insight 为 running
        currentSubTasks = currentSubTasks.map((s: Record<string, unknown>) =>
          s.id === "insight" ? { ...s, status: "running" } : s
        );
        await db.update(jobTasks).set({ subTasks: currentSubTasks }).where(eq(jobTasks.id, jobTask.id));
        publishStepUpdate(taskId, insightStepIndex, insightStepId, insightActionName, "running", undefined, undefined, undefined, undefined, "insight");
        notifyTaskUpdate(taskId, { type: "step_update", stepName: insightActionName, status: "running" });

        try {
          const generatedInsights = await generateInsights(taskId, task.query, toolResults);

          // 创建 insight 事件（供右侧面板"事件"列表展示）
          if (generatedInsights.length > 0) {
            await db.insert(events).values({
              taskId: jobTask.id,
              taskName: insightActionName,
              title: `综合洞察生成完成`,
              content: generatedInsights.map((ins, i) =>
                `${i + 1}. **${ins.title}**（${ins.riskLevel} / ${ins.category}）\n   ${ins.summary}`
              ).join("\n\n"),
              status: "success",
              agentTaskId: taskId,
            });
          }

          // 标记 insight 为 completed
          currentSubTasks = currentSubTasks.map((s: Record<string, unknown>) =>
            s.id === "insight" ? { ...s, status: "completed" } : s
          );
          await db.update(jobTasks).set({ subTasks: currentSubTasks }).where(eq(jobTasks.id, jobTask.id));
          publishStepUpdate(taskId, insightStepIndex, insightStepId, insightActionName, "completed", undefined, undefined, undefined, undefined, "insight");
          notifyTaskUpdate(taskId, { type: "step_update", stepName: insightActionName, status: "completed" });
        } catch (insightErr) {
          const insightError = insightErr instanceof Error ? insightErr.message : String(insightErr);
          console.error(`[Executor] Insight generation failed:`, insightError);

          currentSubTasks = currentSubTasks.map((s: Record<string, unknown>) =>
            s.id === "insight" ? { ...s, status: "failed" } : s
          );
          await db.update(jobTasks).set({ subTasks: currentSubTasks }).where(eq(jobTasks.id, jobTask.id));
          publishStepUpdate(taskId, insightStepIndex, insightStepId, insightActionName, "failed", undefined, insightError, undefined, undefined, "insight");
          notifyTaskUpdate(taskId, { type: "step_update", stepName: insightActionName, status: "failed", error: insightError });
        }
      } else if (insightSubTask) {
        // 条件不满足（无结果或执行失败），跳过 insight
        currentSubTasks = currentSubTasks.map((s: Record<string, unknown>) =>
          s.id === "insight" ? { ...s, status: "skipped" } : s
        );
        await db.update(jobTasks).set({ subTasks: currentSubTasks }).where(eq(jobTasks.id, jobTask.id));
      }

      // ========== 聚合阻断原因，统一评估是否生成 requirement ==========
      // 1. 收集 plan 中标记为 unsupported 的步骤
      const planUnsupported: Array<{ description: string; capability: string; reason: string }> = [];
      const taskPlan = task.plan as Record<string, unknown> | undefined;
      const planSteps = taskPlan?.steps as Array<Record<string, unknown>> | undefined;
      if (planSteps) {
        for (const s of planSteps) {
          if (s.supportStatus === "unsupported" || s.supportStatus === "partial") {
            planUnsupported.push({
              description: (s.description as string) || (s.purpose as string) || "未知步骤",
              capability: (s.capability as string) || "unknown",
              reason: `Planner 判定该步骤需要能力 ${s.capability || "unknown"}，当前系统未提供`,
            });
          }
        }
      }

      // 2. 聚合所有中断信息
      const allBlocked = [
        ...planUnsupported.map((u) => ({
          source: "plan" as const,
          actionType: u.capability,
          actionName: u.description,
          reason: u.reason,
        })),
        ...blockedSteps.map((b) => ({
          source: "executor" as const,
          actionType: b.actionType,
          actionName: b.actionName,
          reason: b.reason,
          blockAnalysis: b.blockAnalysis,
        })),
      ];

      if (allBlocked.length > 0) {
        console.log(`[Executor] ${allBlocked.length} blocked items detected, evaluating requirement need...`);
        try {
          const evaluation = await evaluateRequirementNeed(task.query, allBlocked);
          if (evaluation.shouldCreate && evaluation.requirements.length > 0) {
            // 批量创建 requirement 并推送到外部平台
            for (const req of evaluation.requirements) {
              await createRequirement({
                userId: task.userId,
                description: req.description,
                chatId: taskId,
                status: "pending",
                requirementId: req.applicationScenario,
              });
              await submitToExternalSystem({
                name: req.name,
                description: req.description,
                applicationScenario: req.applicationScenario,
                type: req.type,
              }).catch((submitErr) => {
                console.error("[Executor] External submit failed:", submitErr);
              });
            }

            // 创建事件通知用户
            await db.insert(events).values({
              taskId: jobTask.id,
              taskName: "需求提报",
              title: `定制需求已提报：共 ${evaluation.requirements.length} 项`,
              content: `${evaluation.reason}\n\n${evaluation.requirements.map((r) => `[${r.type === 1 ? "数据" : r.type === 2 ? "工具" : "组件"}] ${r.name}: ${r.description}`).join("\n\n")}`,
              status: "success",
              agentTaskId: taskId,
            });

            notifyTaskUpdate(taskId, {
              type: "step_update",
              stepName: "需求提报",
              status: "completed",
              message: evaluation.reason,
            });
            console.log(`[Executor] Requirements created and submitted: ${evaluation.requirements.length} items`);
          } else {
            // 不创建 requirement，记录原因
            console.log(`[Executor] Requirement not created: ${evaluation.reason}`);
            await db.insert(events).values({
              taskId: jobTask.id,
              taskName: "需求评估",
              title: "当前请求暂不支持",
              content: evaluation.reason,
              status: "partial",
              agentTaskId: taskId,
            });
            notifyTaskUpdate(taskId, {
              type: "step_update",
              stepName: "需求评估",
              status: "failed",
              message: evaluation.reason,
            });
          }
        } catch (evalErr) {
          console.error("[Executor] Requirement evaluation failed:", evalErr);
        }
      }
      // ================================================================

      // 更新 job_task 最终状态
      await db.update(jobTasks).set({
        status: jobStatus,
        dataCount: totalDataCount,
        updatedAt: new Date(),
        subTasks: currentSubTasks,
      }).where(eq(jobTasks.id, jobTask.id));

      notifyTaskUpdate(taskId, { type: "completed", taskId, status: jobStatus });

      // 验证更新是否生效
      const [verifyJob] = await db.select().from(jobTasks).where(eq(jobTasks.id, jobTask.id)).limit(1);
      console.log(`[Executor] Task ${taskId} finished with status: ${finalStatus}, jobStatus: ${jobStatus}, jobTaskId: ${jobTask.id}`);
      console.log(`[Executor] Verified jobTask ${jobTask.id}: status=${verifyJob?.status}, dataCount=${verifyJob?.dataCount}, subTasks=${JSON.stringify(verifyJob?.subTasks)?.slice(0, 200)}`);

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[Executor] Task ${taskId} failed:`, error);
      await taskService.updateTaskStatus(taskId, "failed", error);

      // 若 insight 仍在 pending/running，标记为 failed
      const hasPendingInsight = currentSubTasks.some(
        (s) => s.id === "insight" && (s.status === "pending" || s.status === "running")
      );
      if (hasPendingInsight) {
        currentSubTasks = currentSubTasks.map((s: Record<string, unknown>) =>
          s.id === "insight" ? { ...s, status: "failed" } : s
        );
      }

      await db.update(jobTasks).set({
        status: "failed",
        subTasks: currentSubTasks,
      }).where(eq(jobTasks.id, jobTask.id));

      notifyTaskUpdate(taskId, { type: "failed", taskId, status: "failed", error });
      throw err;
    }
  },
};

// 推送步骤级 SSE 更新
function publishStepUpdate(
  taskId: string,
  stepIndex: number,
  stepId: string,
  stepName: string,
  status: "running" | "completed" | "failed",
  actionId?: string,
  detail?: string,
  operations?: Array<Record<string, unknown>>,
  gisData?: unknown,
  actionType?: string
) {
  try {
    redisPublisher.publish(
      SSE_CHANNEL,
      JSON.stringify({
        taskId,
        type: "step_update",
        stepIndex,
        stepId,
        actionId,
        status,
        name: stepName,
        actionType,
        detail: detail || undefined,
        operations,
        gisData,
      })
    );
  } catch (err) {
    console.error("[Executor] Failed to publish step update:", err);
  }
}

// 根据 Actions 推断任务类型
function inferJobType(actions: unknown[]): "daily" | "weekly" | "realtime" {
  const types = (actions as Array<{ type?: string }>)
    .map((a) => a.type)
    .filter(Boolean);

  if (types.includes("daily_report")) return "daily";
  if (types.includes("subscription")) {
    // subscription 通过 schedule 推断日报/周报
    const sub = (actions as Array<{ type?: string; params?: { schedule?: string } }>).find(
      (a) => a.type === "subscription"
    );
    const schedule = sub?.params?.schedule || "";
    if (schedule.includes("* * 1")) return "weekly";
    return "daily";
  }
  if (types.some((t) => ["maritime", "intelligence", "satellite", "intelligent_qa", "news"].includes(t))) {
    return "realtime";
  }

  // 兜底：回退到 query 关键词检测
  return "daily";
}

// 将执行结果写入展示表
async function writeDisplayData(
  agentTaskId: string,
  jobTaskId: string,
  action: Action,
  data: Record<string, unknown> | undefined
) {
  if (!data) return;

  const actionType = action.type;

  switch (actionType) {
    case "maritime": {
      // 海域态势分析 → 创建事件（船舶 + 飞机）
      const vessels = (data.vessels || []) as MaritimeVessel[];
      const aircrafts = (data.aircrafts || []) as MaritimeAircraft[];
      const gisLayers = data.gisLayers as Record<string, unknown> | undefined;
      const summary = data.summary as Record<string, unknown> | undefined;
      const riskAssessment = summary?.riskAssessment as string;

      // 组装 entities（船舶 + 飞机）
      const shipEntities = vesselsToSharedEntities(vessels);
      const aircraftEntities = aircrafts.length > 0 ? aircraftsToSharedEntities(aircrafts) : [];
      const entities = [...shipEntities, ...aircraftEntities];

      // 组装 trajectories（从 gisLayers 提取，包含船舶 + 飞机）
      const trajectoryData = gisLayers?.trajectories as { data?: Array<{ vesselId: string; points: Array<{ lat: number; lng: number }> }> } | undefined;
      const trajectories = trajectoryData?.data?.map((t) =>
        toSharedTrajectory(`traj-${t.vesselId}`, `轨迹_${t.vesselId}`, t.points, "route", "realtime")
      ) || [];

      const content = riskAssessment
        || `分析完成，发现 ${vessels.length} 艘关注船舶、${aircrafts.length} 架关注飞机`;

      await db.insert(events).values({
        taskId: jobTaskId,
        taskName: action.name,
        title: `海域态势分析完成`,
        content,
        status: "success",
        gisData: {
          type: "entity" as const,
          entities,
          trajectories: trajectories.length > 0 ? trajectories : undefined,
        },
        agentTaskId,
      });
      break;
    }

    case "intelligence": {
      // 情报分析 → 仅创建事件（洞察统一在 Executor 结束时由 Dify 综合生成）
      const findings = data.findings as Array<Record<string, unknown>> | undefined;
      const summary = data.summary as string;

      await db.insert(events).values({
        taskId: jobTaskId,
        taskName: action.name,
        title: `情报分析完成`,
        content: summary || `发现 ${findings?.length || 0} 条情报`,
        status: "success",
        agentTaskId,
      });
      break;
    }

    // case "gis": {
    //   // GIS 联动 → 创建事件（带 GIS 数据）
    //   const layers = data.layers as Array<Record<string, unknown>> | undefined;
    //
    //   await db.insert(events).values({
    //     taskId: jobTaskId,
    //     taskName: action.name,
    //     title: `GIS 可视化数据已生成`,
    //     content: `已生成 ${layers?.length || 0} 个图层`,
    //     status: "success",
    //     gisData: {
    //       type: "entity",
    //       entities: layers?.flatMap((layer: Record<string, unknown>) => {
    //         const layerData = layer.data as Array<Record<string, unknown>> | undefined;
    //         return layerData?.map((d: Record<string, unknown>) => ({
    //           id: d.id || layer.id,
    //           name: d.label || d.name || layer.name,
    //           type: "ship",
    //           coordinates: [d.lng || d.lon, d.lat],
    //           importance: layer.type === "heatmap" ? "high" : "medium",
    //           status: d.status || "normal",
    //         })) || [];
    //       }),
    //     },
    //     agentTaskId,
    //   });
    //   break;
    // }

    case "intelligent_qa": {
      // 智能问答 → 创建事件
      const reportContent = data.report_content as string;
      const stats = data.stats as Record<string, unknown> | undefined;

      await db.insert(events).values({
        taskId: jobTaskId,
        taskName: action.name,
        title: `智能问答结果`,
        content: reportContent || `查询完成`,
        status: "success",
        agentTaskId,
      });
      break;
    }

    case "daily_report": {
      // 日报生成 → 创建事件
      const reportContent = data.report_content as string;
      const date = data.date as string;
      const reportType = data.report_type as string;

      await db.insert(events).values({
        taskId: jobTaskId,
        taskName: action.name,
        title: `安防日报 ${date || ""}`.trim(),
        content: reportContent || `日报生成完成`,
        status: "success",
        agentTaskId,
      });
      break;
    }

    case "satellite": {
      // 天基查询 → 创建事件（根据返回类型处理）
      const nestedData = data.data as Record<string, unknown> | undefined;
      const responseType = (nestedData?.responseType || nestedData?.type) as string;
      const message = data.message as string;
      const table = data.table as string;
      const gisData = nestedData?.gisData as Record<string, unknown> | undefined;

      let title = "天基数据查询";
      let content = message || "";
      if (table && table.length > 0) {
        content += "\n\n" + table;
      }

      switch (responseType) {
        case "history":
          title = "天基历史数据查询结果";
          break;
        case "demand":
          title = "天基观测需求已提报";
          break;
        case "no_data":
          title = "天基数据查询（无历史数据）";
          break;
        case "error":
          title = "天基数据查询（参数缺失）";
          break;
        case "oil_spill_detection":
          title = "天基遥感影像AI油膜识别";
          break;
      }

      console.log(`[Executor writeDisplayData] satellite gisData:`, gisData ? `type=${(gisData as any)?.type} cameraView=${!!(gisData as any)?.cameraView} regions=${(gisData as any)?.regions?.length} overlays=${(gisData as any)?.imageOverlays?.length}` : 'NONE');
      await db.insert(events).values({
        taskId: jobTaskId,
        taskName: action.name,
        title,
        content,
        status: responseType === "history" || responseType === "demand" || responseType === "oil_spill_detection" ? "success" : "partial",
        gisData: gisData ? gisData : undefined,
        agentTaskId,
      });
      break;
    }

    case "subscription": {
      const subData = data as {
        id?: string;
        name?: string;
        type?: string;
        schedule?: string;
        nextExecuteTime?: string;
        toolType?: string;
        toolParams?: Record<string, unknown>;
      };

      const toolParams = subData.toolParams || {};
      const regionId = (toolParams.regionId as string) || null;

      await db.insert(subscriptions).values({
        name: subData.name || action.name,
        type: subData.type || "daily",
        schedule: subData.schedule || "0 9 * * *",
        nextExecuteTime: subData.nextExecuteTime ? new Date(subData.nextExecuteTime) : new Date(Date.now() + 86400000),
        status: "running",
        regionId,
        toolType: subData.toolType,
        queryParams: toolParams,
      });
      break;
    }

    case "news": {
      const newsData = data as {
        summary?: { overview?: string; totalFound?: number; totalReturned?: number };
        articles?: Array<{ title?: string; source?: string; publishedAt?: string; summary?: string; relevanceScore?: number }>;
        trends?: Array<{ topic?: string; sentiment?: string; articleCount?: number }>;
        gisData?: { type?: string; regions?: unknown[]; cameraView?: unknown };
      };

      const overview = newsData.summary?.overview || "新闻查询完成";
      const articles = newsData.articles || [];
      const trends = newsData.trends || [];
      const gisData = newsData.gisData;
      console.log(`[Executor writeDisplayData] news gisData:`, gisData ? `type=${(gisData as any)?.type} cameraView=${!!(gisData as any)?.cameraView} regions=${(gisData as any)?.regions?.length}` : 'NONE');

      let content = `**新闻概览**：${overview}\n\n`;
      if (articles.length > 0) {
        content += `**重点报道（${articles.length}条）**：\n`;
        articles.slice(0, 5).forEach((a, i) => {
          content += `${i + 1}. **${a.title}**（${a.source}）— ${a.summary?.substring(0, 60) || ""}...\n`;
        });
      }
      if (trends.length > 0) {
        content += `\n**趋势分析**：\n`;
        trends.forEach((t) => {
          content += `- ${t.topic}（${t.sentiment}，${t.articleCount}篇报道）\n`;
        });
      }

      await db.insert(events).values({
        taskId: jobTaskId,
        taskName: action.name,
        title: `实时新闻查询完成`,
        content,
        status: "success",
        gisData: gisData ? gisData : undefined,
        agentTaskId,
      });
      break;
    }

    case "requirement": {
      const reqData = data as {
        id?: string;
        description?: string;
        status?: string;
        requirementId?: string;
        timestamp?: string;
        suggestedTool?: string;
      };

      const description = reqData.description || (action.params?.description as string) || "未指定需求";
      const name = (action.params?.name as string) || description.slice(0, 20);
      const applicationScenario = (action.params?.applicationScenario as string) || "智能体能力扩展";
      const reason = (action.params?.reason as string) || "用户需求超出当前可用工具能力范围";

      await db.insert(requirements).values({
        description,
        chatId: reqData.requirementId || `REQ-${Date.now()}`,
        status: "pending",
        requirementId: reqData.requirementId,
      });

      // 推送到外部平台（静默忽略失败）
      await submitToExternalSystem({
        name,
        description,
        applicationScenario,
        type: (action.params?.type as number) ?? 1,
      }).catch((submitErr) => {
        console.error("[Executor] External submit failed for requirement action:", submitErr);
      });

      // 创建事件通知用户
      await db.insert(events).values({
        userId,
        taskName: "需求提报",
        title: `定制需求已提报：${name}`,
        content: `${reason}\n\n${description}`,
        status: "success",
        agentTaskId,
      });
      break;
    }

    case "fire-detector": {
      // 火灾检测 → 创建事件（含 GIS 火点 + 烧毁区域）
      const summary = data.summary as {
        riskAssessment?: string;
        location?: string;
        burnedAreaHectares?: number;
        centerCoordinates?: [number, number];
        fireType?: string;
        confidence?: string;
      } | undefined;
      const gisData = data.gisData as {
        type?: string;
        entities?: unknown[];
        regions?: unknown[];
      } | undefined;
      const region = data.region as string | undefined;

      const titleSuffix = region || summary?.location || "";
      const content = summary?.riskAssessment
        || `火灾检测完成${summary?.burnedAreaHectares ? `，烧毁面积约 ${summary.burnedAreaHectares} 公顷` : ""}`;
      console.log(`[Executor writeDisplayData] fire-detector gisData:`, gisData ? `type=${(gisData as any)?.type} cameraView=${!!(gisData as any)?.cameraView} regions=${(gisData as any)?.regions?.length} entities=${(gisData as any)?.entities?.length}` : 'NONE');
      await db.insert(events).values({
        taskId: jobTaskId,
        taskName: action.name,
        title: `火灾检测完成${titleSuffix ? `（${titleSuffix}）` : ""}`,
        content,
        status: "success",
        gisData: gisData ? gisData : undefined,
        agentTaskId,
      });
      break;
    }

    case "earthquake-evaluation": {
      const summary = data.summary as {
        location?: string;
        magnitude?: string;
        epicenter?: [number, number];
        depthKm?: number;
        buildingsDamaged?: number;
        roadsInterrupted?: number;
        landslidesDetected?: number;
        totalAffectedAreaKm2?: number;
      } | undefined;
      const gisData = data.gisData as {
        type?: string;
        entities?: unknown[];
        regions?: unknown[];
        imageOverlays?: unknown[];
        compareMode?: string;
      } | undefined;
      const damageZones = data.damageZones as Array<{ level?: string; name?: string; areaKm2?: number; description?: string }> | undefined;

      const location = summary?.location || "未知区域";
      const magnitude = summary?.magnitude || "";

      let content = `**${location} ${magnitude}级地震灾后评估完成**\n\n`;
      content += `| 指标 | 数值 |\n|---|---|\n`;
      content += `| 震中位置 | 东经${summary?.epicenter?.[0] || "—"}°, 北纬${summary?.epicenter?.[1] || "—"}° |\n`;
      content += `| 震源深度 | ${summary?.depthKm || "—"} km |\n`;
      content += `| 损毁建筑 | ${summary?.buildingsDamaged || "—"} 栋 |\n`;
      content += `| 中断道路 | ${summary?.roadsInterrupted || "—"} 条 |\n`;
      content += `| 山体滑坡 | ${summary?.landslidesDetected || "—"} 处 |\n`;
      content += `| 受灾总面积 | ${summary?.totalAffectedAreaKm2 || "—"} km² |\n\n`;

      if (damageZones && damageZones.length > 0) {
        content += `**损毁分级统计**\n\n`;
        damageZones.forEach((z) => {
          content += `- **${z.name}**：${z.areaKm2} km² — ${z.description}\n`;
        });
      }

      if (gisData?.compareMode === "side-by-side") {
        content += `\n*已启用震前/震后影像分屏对比模式*`;
      }

      console.log(`[Executor writeDisplayData] earthquake-evaluation gisData:`, gisData ? `type=${gisData.type} compareMode=${gisData.compareMode} regions=${gisData.regions?.length} entities=${gisData.entities?.length} overlays=${gisData.imageOverlays?.length}` : 'NONE');
      await db.insert(events).values({
        taskId: jobTaskId,
        taskName: action.name,
        title: `${location} ${magnitude}级地震灾后评估`,
        content,
        status: "success",
        gisData: gisData ? gisData : undefined,
        agentTaskId,
      });
      break;
    }

    case "flood-evaluation": {
      const summary = data.summary as {
        location?: string;
        eventTime?: string;
        dataSource?: string;
        floodedAreaKm2?: number;
        bridgesDamaged?: number;
        roadsInterrupted?: number;
        housesFlooded?: number;
      } | undefined;
      const gisData = data.gisData as {
        type?: string;
        entities?: unknown[];
        regions?: unknown[];
        imageOverlays?: unknown[];
        compareMode?: string;
      } | undefined;
      const damageZones = data.damageZones as Array<{ level?: string; name?: string; areaKm2?: number; color?: string; description?: string }> | undefined;

      const location = summary?.location || "未知区域";
      const eventTime = summary?.eventTime || "";

      let content = `**${location} 洪涝灾后评估完成**\n\n`;
      if (eventTime) {
        content += `**降雨时段**：${eventTime}\n\n`;
      }
      content += `| 指标 | 数值 |\n|---|---|\n`;
      content += `| 淹没面积 | ${summary?.floodedAreaKm2 || "—"} km² |\n`;
      content += `| 桥梁损毁 | ${summary?.bridgesDamaged || "—"} 座 |\n`;
      content += `| 道路中断 | ${summary?.roadsInterrupted || "—"} 条 |\n`;
      content += `| 房屋受淹 | ${summary?.housesFlooded || "—"} 栋 |\n`;
      content += `| 数据来源 | ${summary?.dataSource || "—"} |\n\n`;

      if (damageZones && damageZones.length > 0) {
        content += `**淹没分级统计**\n\n`;
        damageZones.forEach((z) => {
          content += `- **${z.name}**：${z.areaKm2} km² — ${z.description}\n`;
        });
      }

      if (gisData?.compareMode === "side-by-side") {
        content += `\n*已启用暴雨前/暴雨后影像分屏对比模式*`;
      }

      console.log(`[Executor writeDisplayData] flood-evaluation gisData:`, gisData ? `type=${gisData.type} compareMode=${gisData.compareMode} regions=${gisData.regions?.length} entities=${gisData.entities?.length} overlays=${gisData.imageOverlays?.length}` : 'NONE');
      await db.insert(events).values({
        taskId: jobTaskId,
        taskName: action.name,
        title: `${location} 洪涝灾后评估`,
        content,
        status: "success",
        gisData: gisData ? gisData : undefined,
        agentTaskId,
      });
      break;
    }

    case "region-mark": {
      const regionName = data.regionName as string | undefined;
      const bounds = data.bounds as { north: number; south: number; east: number; west: number } | undefined;
      const gisData = data.gisData as { type?: string; regions?: unknown[] } | undefined;

      const content = bounds
        ? `已标记 ${regionName} 区域，边界范围：东经${bounds.west}°–${bounds.east}°，北纬${bounds.south}°–${bounds.north}°（WGS84坐标系）`
        : `已标记 ${regionName} 区域`;

      await db.insert(events).values({
        taskId: jobTaskId,
        taskName: action.name,
        title: `区域标记完成：${regionName || "未知区域"}`,
        content,
        status: "success",
        gisData: gisData ? gisData : undefined,
        agentTaskId,
      });
      break;
    }

    case "weather-fetch": {
      const w = data as {
        windSpeed?: number;
        windDirection?: string;
        currentSpeed?: number;
        currentDirection?: string;
        period?: string;
        region?: string;
        dataSource?: string;
      };
      const gisData = data.gisData as { type?: string; entities?: unknown[] } | undefined;

      const content =
        `**气象参数（${w.period || "近72小时"} · ${w.region || "—"}）**\n\n` +
        `| 项 | 值 |\n` +
        `|---|---|\n` +
        `| 风速 | ${w.windSpeed ?? "—"} m/s |\n` +
        `| 风向 | ${w.windDirection || "—"}风 |\n` +
        `| 洋流速度 | ${w.currentSpeed ?? "—"} m/s |\n` +
        `| 洋流方向 | ${w.currentDirection || "—"}向 |\n` +
        `| 数据源 | ${w.dataSource || "mock-fallback"} |`;

      await db.insert(events).values({
        taskId: jobTaskId,
        taskName: action.name,
        title: `气象数据获取完成（${w.region || "东海油膜片区"}）`,
        content,
        status: "success",
        gisData: gisData ? gisData : undefined,
        agentTaskId,
      });
      break;
    }

    case "oil-drift": {
      const d = data as {
        driftPathLengthKm?: number;
        pollutionOrigin?: {
          lngDMS?: string;
          latDMS?: string;
          timeRange?: string;
          confidence?: string;
        };
        weatherInput?: {
          windSpeed?: number;
          windDirection?: string;
          currentSpeed?: number;
          currentDirection?: string;
        };
      };
      const gisData = data.gisData as
        | { type?: string; entities?: unknown[]; trajectories?: unknown[] }
        | undefined;

      const origin = d.pollutionOrigin || {};
      const wx = d.weatherInput || {};
      const content =
        `**油污漂移反推完成**\n\n` +
        `| 项 | 值 |\n|---|---|\n` +
        `| 排污原点 | ${origin.lngDMS || "—"}, ${origin.latDMS || "—"} |\n` +
        `| 漂移路径长度 | ${d.driftPathLengthKm ?? "—"} km |\n` +
        `| 排污时间窗 | ${origin.timeRange || "—"} |\n` +
        `| 误差 | ${origin.confidence || "—"} |\n` +
        `| 风 | ${wx.windSpeed ?? "—"} m/s ${wx.windDirection || ""}风 |\n` +
        `| 洋流 | ${wx.currentSpeed ?? "—"} m/s ${wx.currentDirection || ""}向 |`;

      await db.insert(events).values({
        taskId: jobTaskId,
        taskName: action.name,
        title: `油污漂移反推完成（${origin.lngDMS || "未知排污原点"}）`,
        content,
        status: "success",
        gisData: gisData ? gisData : undefined,
        agentTaskId,
      });
      break;
    }

    case "ais-fetch": {
      const d = data as {
        recordCount?: number;
        vesselCount?: number;
        displayedCount?: number;
        region?: string;
        period?: string;
      };
      const gisData = data.gisData as
        | { type?: string; entities?: unknown[]; trajectories?: unknown[] }
        | undefined;

      const content =
        `**AIS 轨迹数据获取完成（${d.region || "中国东海"}）**\n\n` +
        `| 项 | 值 |\n|---|---|\n` +
        `| 监测区域 | ${d.region || "中国东海"} |\n` +
        `| 时间窗 | ${d.period || "近72小时"} |\n` +
        `| 涉及船舶 | ${d.vesselCount ?? "—"} 艘 |\n` +
        `| AIS 记录 | ${d.recordCount ?? "—"} 条 |\n` +
        `| 候选展示 | ${d.displayedCount ?? "—"} 艘途经候选船 |`;

      await db.insert(events).values({
        taskId: jobTaskId,
        taskName: action.name,
        title: `AIS 轨迹数据获取完成（涉及船舶 ${d.vesselCount ?? "—"} 艘）`,
        content,
        status: "success",
        gisData: gisData ? gisData : undefined,
        agentTaskId,
      });
      break;
    }

    case "ais-match-suspects": {
      const d = data as {
        matchedCount?: number;
        totalScanned?: number;
        matchCriteria?: {
          rangeKm?: number;
          timeRange?: string;
        };
        vessels?: Array<{
          mmsi: string;
          name: string;
          type: string;
          flag: string;
          stayDurationMin?: number;
          closestDistanceM?: number;
          aisGapMin?: number;
        }>;
      };
      const gisData = data.gisData as
        | { type?: string; entities?: unknown[]; cameraView?: unknown }
        | undefined;

      const vesselRows = (d.vessels || [])
        .map((v) => {
          const gap = v.aisGapMin ? ` · AIS 断 ${v.aisGapMin} min` : "";
          return `| ${v.mmsi} | ${v.name} | ${v.type} | ${v.flag} | ${v.stayDurationMin ?? "—"} min | ${v.closestDistanceM ?? "—"} m${gap} |`;
        })
        .join("\n");

      const content =
        `**匹配嫌疑船舶完成（从 ${d.totalScanned ?? "—"} 艘 → ${d.matchedCount ?? "—"} 艘候选）**\n\n` +
        `匹配规则：排污原点 ±${d.matchCriteria?.rangeKm ?? 1} km × 时间窗 ${d.matchCriteria?.timeRange ?? "—"}\n\n` +
        `| MMSI | 船名 | 类型 | 国籍 | 停留 | 距原点 |\n` +
        `|---|---|---|---|---|---|\n` +
        vesselRows;

      await db.insert(events).values({
        taskId: jobTaskId,
        taskName: action.name,
        title: `匹配嫌疑船舶完成（${d.matchedCount ?? "—"} 艘候选）`,
        content,
        status: "success",
        gisData: gisData ? gisData : undefined,
        agentTaskId,
      });
      break;
    }

    case "ais-suspect-ranking": {
      const d = data as {
        totalSuspects?: number;
        primary?: Array<{
          mmsi: string;
          name?: string;
          type?: string;
          flag?: string;
          score?: number;
          rank?: number;
          reasons?: string;
        }>;
        secondary?: Array<{
          mmsi: string;
          name?: string;
          type?: string;
          flag?: string;
          score?: number;
          rank?: number;
          reasons?: string;
        }>;
        normal?: Array<{
          mmsi: string;
          name?: string;
          type?: string;
          flag?: string;
          score?: number;
          rank?: number;
          reasons?: string;
        }>;
      };
      const gisData = data.gisData as
        | { type?: string; entities?: unknown[]; cameraView?: unknown }
        | undefined;

      const allRanked = [
        ...(d.primary || []),
        ...(d.secondary || []),
        ...(d.normal || []),
      ].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
      const tableRows = allRanked
        .map(
          (s) =>
            `| ${s.rank ?? "—"} | **${s.score ?? "—"}** | ${s.mmsi} | ${s.name ?? "—"} | ${s.type ?? "—"} | ${s.flag ?? "—"} | ${s.reasons ?? "—"} |`
        )
        .join("\n");

      const primaryFirst = d.primary?.[0];
      const content =
        `**嫌疑船舶分级排序完成（共 ${d.totalSuspects ?? "—"} 艘候选 → 分三级）**\n\n` +
        (primaryFirst
          ? `🚨 **首要嫌疑**：${primaryFirst.name} (MMSI ${primaryFirst.mmsi}, 得分 ${primaryFirst.score})\n\n`
          : "") +
        `| 排名 | 得分 | MMSI | 船名 | 类型 | 国籍 | 判定依据 |\n` +
        `|---|---|---|---|---|---|---|\n` +
        tableRows;

      await db.insert(events).values({
        taskId: jobTaskId,
        taskName: action.name,
        title: primaryFirst
          ? `首要嫌疑：${primaryFirst.name}（得分 ${primaryFirst.score}）`
          : `嫌疑船舶分级完成`,
        content,
        status: "success",
        gisData: gisData ? gisData : undefined,
        agentTaskId,
      });
      break;
    }

    case "border-push": {
      const d = data as {
        pushed?: boolean;
        targetPlatform?: string;
        payload?: Record<string, unknown>;
        summary?: string;
      };
      const payloadJson = d.payload
        ? "\n\n```json\n" + JSON.stringify(d.payload, null, 2) + "\n```"
        : "";

      await db.insert(events).values({
        taskId: jobTaskId,
        taskName: action.name,
        title: `火情研判事件已推送（${d.targetPlatform || "边防应用平台"}）`,
        content: (d.summary || "推送完成") + payloadJson,
        status: "success",
        agentTaskId,
      });
      break;
    }
  }
}
