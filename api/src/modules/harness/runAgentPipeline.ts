import type { CreateTaskRequest } from "@datasourceintelligence/shared";
import type { CapabilityContract } from "../actions/contracts/types.js";
import { weatherFetchContract } from "../actions/contracts/weather-fetch.contract.js";
import { newsSearchContract } from "../actions/contracts/news.contract.js";
import { finalizerTemplateSummaryContract } from "../actions/contracts/finalizer.contract.js";
import { webFetchContract } from "../actions/contracts/web.contract.js";
import { calcContract } from "../actions/contracts/calc.contract.js";
import { timeContract } from "../actions/contracts/time.contract.js";
import { runOpenAgentLoop } from "./runOpenAgentLoop.js";
import { notifyTaskUpdate } from "../../sse/sseManager.js";
import { matchTemplates, type TemplateMatchResult } from "./templateMatcher.js";
import { getRoutable, convertToRunnable } from "./matchRegistry.js";
import { runDeterministicRunnable } from "./runnableRunner.js";

// ============================================================
// Contract Registry
// ============================================================

function buildContractRegistry(): Map<string, CapabilityContract> {
  const registry = new Map<string, CapabilityContract>();
  registry.set(weatherFetchContract.name, weatherFetchContract);
  registry.set(newsSearchContract.name, newsSearchContract);
  registry.set(finalizerTemplateSummaryContract.name, finalizerTemplateSummaryContract);
  registry.set(webFetchContract.name, webFetchContract);
  registry.set(calcContract.name, calcContract);
  registry.set(timeContract.name, timeContract);
  return registry;
}

// ============================================================
// Harness Pipeline 总入口
// ============================================================

export interface HarnessPipelineResult {
  status:
    | "skill_executed"
    | "template_executed"
    | "agent_completed"
    | "legacy_fallback"
    | "failed";
  finalText?: string;
  observations?: unknown[];
}

/**
 * Harness Pipeline 总入口。
 *
 * 路由决策：
 * 1. templateMatcher 对 query 做关键词匹配
 * 2. 高置信度（>=0.75）：直接执行 skill/template，零 LLM
 * 3. 中置信度（0.45~0.75）：进入 Agent Loop，但把候选信息注入上下文
 * 4. 低置信度（<0.45）：直接进入 Open Agent Loop
 * 5. Agent Loop 结束后，若判断 legacy_fallback，回退旧 pipeline
 */
export async function runHarnessPipeline(
  taskId: string,
  body: CreateTaskRequest
): Promise<HarnessPipelineResult> {
  const query = body.query;
  const registry = buildContractRegistry();

  // 1. 执行关键词匹配
  const matchResult = matchTemplates(query);

  notifyTaskUpdate(taskId, {
    type: "matcher_result",
    tier: matchResult.tier,
    confidence: matchResult.confidence,
    topCandidate: matchResult.topCandidate?.id,
    reason: matchResult.reason,
  });

  // 2. 三档路由
  switch (matchResult.tier) {
    case "high": {
      // 高置信度：直接执行，零 LLM
      return await executeDirectly(taskId, query, matchResult, registry);
    }

    case "medium": {
      // 中置信度：进入 Agent Loop，但注入候选提示
      const enhancedQuery = buildEnhancedQuery(query, matchResult);
      return await runAgentLoop(taskId, enhancedQuery, registry);
    }

    case "low": {
      // 低置信度：直接进入 Open Agent Loop
      return await runAgentLoop(taskId, query, registry);
    }
  }
}

// ============================================================
// 高置信度：直接执行
// ============================================================

async function executeDirectly(
  taskId: string,
  query: string,
  matchResult: TemplateMatchResult,
  registry: Map<string, CapabilityContract>
): Promise<HarnessPipelineResult> {
  const topCandidate = matchResult.topCandidate!;
  const routable = getRoutable(topCandidate.id);

  if (!routable) {
    // 注册表不一致，fallback 到 Agent Loop
    console.warn(
      `[HarnessPipeline] Routable ${topCandidate.id} not found in registry, falling back to agent loop`
    );
    return await runAgentLoop(taskId, query, registry);
  }

  const runnable = convertToRunnable(routable);

  notifyTaskUpdate(taskId, {
    type: "runnable_start",
    runnableId: runnable.id,
    runnableKind: runnable.kind,
    confidence: matchResult.confidence,
    message: `高置信度命中 ${runnable.id}，直接执行...`,
  });

  const result = await runDeterministicRunnable({
    taskId,
    query,
    runnable,
    registry,
  });

  if (result.status === "completed") {
    return {
      status: runnable.kind === "skill" ? "skill_executed" : "template_executed",
      finalText: result.finalText,
      observations: result.observations,
    };
  }

  // 执行失败：fallback 到 Agent Loop
  console.warn(
    `[HarnessPipeline] Direct execution of ${runnable.id} failed: ${result.blockedReason}, falling back to agent loop`
  );
  return await runAgentLoop(taskId, query, registry);
}

// ============================================================
// 中/低置信度：Open Agent Loop
// ============================================================

async function runAgentLoop(
  taskId: string,
  query: string,
  registry: Map<string, CapabilityContract>
): Promise<HarnessPipelineResult> {
  notifyTaskUpdate(taskId, {
    type: "agent_loop_start",
    message: "未命中高置信度模板，进入智能体决策循环...",
  });

  const result = await runOpenAgentLoop({
    taskId,
    query,
    registry,
    maxSteps: 3,
  });

  // 处理 loop 结果
  if (result.status === "legacy_fallback") {
    notifyTaskUpdate(taskId, {
      type: "legacy_fallback",
      message: "Agent Loop 判断需要回退旧 pipeline",
    });
    return { status: "legacy_fallback" };
  }

  if (result.status === "completed") {
    notifyTaskUpdate(taskId, {
      type: "completed",
      taskId,
      status: "completed",
      message: result.finalText || "Agent Loop 执行完成",
      observations: result.observations,
    });
    return {
      status: "agent_completed",
      finalText: result.finalText,
      observations: result.observations,
    };
  }

  // failed
  notifyTaskUpdate(taskId, {
    type: "failed",
    taskId,
    status: "failed",
    message: result.blockedReason || "Agent Loop 执行失败",
    observations: result.observations,
  });
  return {
    status: "failed",
    finalText: result.blockedReason || "Agent Loop 执行失败",
    observations: result.observations,
  };
}

// ============================================================
// 中置信度：增强 query（注入候选提示）
// ============================================================

function buildEnhancedQuery(
  query: string,
  matchResult: TemplateMatchResult
): string {
  const candidateIds = matchResult.candidates
    .slice(0, 3)
    .map((c) => `${c.id}(${c.confidence.toFixed(2)})`)
    .join(", ");

  return (
    query +
    `\n\n[system hint: 以下 skill/template 可能与该请求相关，请优先考虑: ${candidateIds}]`
  );
}
