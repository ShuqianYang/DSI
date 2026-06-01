import type {
  CapabilityContract,
  HarnessRuntimeState,
  Observation,
} from "../actions/contracts/types.js";
import { notifyTaskUpdate } from "../../sse/sseManager.js";
import {
  createRuntimeState,
  pushObservation,
  completeState,
  failState,
} from "./runtimeState.js";
import { validateToolCall } from "../actions/contracts/toolValidator.js";
import { executeTool } from "./toolGateway.js";
import {
  writeStepSnapshot,
  buildSnapshot,
  updateStepRunning,
  updateStepCompleted,
  updateStepFailed,
} from "./taskStepSnapshot.js";
import type { RunnableDefinition, RunnableStep } from "./matchRegistry.js";
import { callDeepSeek } from "./llmClient.js";

export interface RunnableRunOptions {
  taskId: string;
  query: string;
  runnable: RunnableDefinition;
  registry: Map<string, CapabilityContract>;
}

export interface RunnableRunResult {
  status: "completed" | "failed";
  finalText?: string;
  observations: Observation[];
  blockedReason?: string;
}

/**
 * 统一执行 skill / template runnable。
 *
 * skill = 单步 runnable，template = 多步 runnable。
 * 执行层不关心是 skill 还是 template，只看到 steps 数组。
 *
 * 执行流程：
 * 1. 创建 runtimeState
 * 2. 遍历 steps
 * 3. 每步：buildParams → validate → execute → observation 回写
 * 4. 所有步骤完成后生成 final answer
 */
export async function runDeterministicRunnable(
  options: RunnableRunOptions
): Promise<RunnableRunResult> {
  const { taskId, query, runnable, registry } = options;
  const state = createRuntimeState(taskId, query, {
    maxSteps: runnable.steps.length,
  });

  notifyTaskUpdate(taskId, {
    type: "runnable_start",
    runnableId: runnable.id,
    runnableKind: runnable.kind,
    stepCount: runnable.steps.length,
    message: `命中 ${runnable.kind}：${runnable.id}，开始执行...`,
  });

  for (const [index, step] of runnable.steps.entries()) {
    const sequence = index + 1;
    const result = await runStep(step, sequence, state, taskId, runnable, registry);

    if (!result.success) {
      failState(state, result.error || `步骤 ${step.stepKey} 执行失败`);
      notifyTaskUpdate(taskId, {
        type: "runnable_failed",
        runnableId: runnable.id,
        stepKey: step.stepKey,
        error: result.error,
      });
      return {
        status: "failed",
        observations: state.observations,
        blockedReason: result.error,
      };
    }
  }

  // 所有步骤完成
  completeState(state, "all_steps_completed");

  // 优先使用 LLM 理解工具结果生成自然语言回答，无 LLM 时 fallback 到硬编码 buildFinalAnswer
  const finalText = process.env.DEEPSEEK_API_KEY
    ? await generateLlmFinalAnswer(state.userQuery, state.observations, runnable)
    : buildFinalAnswer(state.observations, runnable);

  notifyTaskUpdate(taskId, {
    type: "runnable_completed",
    runnableId: runnable.id,
    message: finalText,
    observations: state.observations,
  });

  return {
    status: "completed",
    finalText,
    observations: state.observations,
  };
}

async function runStep(
  step: RunnableStep,
  sequence: number,
  state: HarnessRuntimeState,
  taskId: string,
  runnable: RunnableDefinition,
  registry: Map<string, CapabilityContract>
): Promise<{ success: boolean; error?: string }> {
  const params = step.buildParams(state);

  // 写入 pending snapshot
  const snapshot = buildSnapshot(
    runnable.source,
    "tool_call",
    state.runId,
    sequence,
    step.stepKey,
    { type: step.tool, name: step.tool, params },
    {
      attempt: 1,
    }
  );

  // 保留 runnable 元数据
  const snapshotWithMeta = {
    ...snapshot,
    runnableId: runnable.id,
    runnableKind: runnable.kind,
  };

  const { stepId } = await writeStepSnapshot(taskId, snapshotWithMeta, "pending");

  // 校验
  const validation = validateToolCall(step.tool, params, state, registry);
  if (!validation.ok) {
    await updateStepFailed(stepId, validation.reason || "参数校验失败");
    return { success: false, error: validation.reason };
  }

  // 执行
  await updateStepRunning(stepId);
  notifyTaskUpdate(taskId, {
    type: "step_running",
    stepKey: step.stepKey,
    tool: step.tool,
    sequence,
  });

  const execResult = await executeTool(step.tool, params, state, registry);

  // 回填 observation
  execResult.observation.sequence = sequence;
  pushObservation(state, execResult.observation);

  // saveAs：将结果存入 artifacts，供后续步骤读取
  if (step.saveAs && execResult.observation.result) {
    const result = execResult.observation.result as Record<string, unknown>;
    // 提取列表型数据（articles / items）
    const items =
      (result.articles as Array<Record<string, unknown>>) ||
      (result.items as Array<Record<string, unknown>>) ||
      [result];
    state.artifacts[step.saveAs] = items;
    console.log(`[runnableRunner] Saved artifact ${step.saveAs}: ${items.length} items`);
  }

  if (execResult.success) {
    await updateStepCompleted(stepId, {
      observation: execResult.observation,
    });
    notifyTaskUpdate(taskId, {
      type: "step_completed",
      stepKey: step.stepKey,
      tool: step.tool,
      sequence,
    });
    return { success: true };
  } else {
    await updateStepFailed(stepId, execResult.observation.error || "执行失败");
    return { success: false, error: execResult.observation.error };
  }
}

function buildFinalAnswer(
  observations: Observation[],
  runnable: RunnableDefinition
): string {
  // skill：直接返回最后一步的结果
  if (runnable.kind === "skill" && observations.length > 0) {
    const last = observations[observations.length - 1];
    if (last.success && last.result) {
      const result = last.result as Record<string, unknown>;
      if (typeof result.message === "string") {
        return result.message;
      }
    }
  }

  // template：汇总所有步骤结果
  const parts: string[] = [];
  for (const obs of observations) {
    if (obs.success && obs.result) {
      const result = obs.result as Record<string, unknown>;
      if (typeof result.message === "string") {
        parts.push(result.message);
      }
    }
  }

  return parts.join("\n") || `${runnable.id} 执行完成。`;
}

// ============================================================
// LLM Finalizer：让智能体理解工具结果并生成自然语言回答
// ============================================================

async function generateLlmFinalAnswer(
  userQuery: string,
  observations: Observation[],
  runnable: RunnableDefinition
): Promise<string> {
  // 构建 observation 摘要
  const toolResults: string[] = [];
  for (const obs of observations) {
    if (!obs.success) continue;
    const result = obs.result as Record<string, unknown> | null;
    if (!result) continue;
    // 提取关键字段，排除 GIS/网格等可视化数据
    const summary: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(result)) {
      if (key === "gisData" || key === "windField" || key === "grid") continue;
      if (typeof val === "object" && val !== null) {
        summary[key] = JSON.stringify(val).slice(0, 500);
      } else {
        summary[key] = val;
      }
    }
    toolResults.push(
      `工具: ${obs.toolName}\n结果: ${JSON.stringify(summary, null, 2)}`
    );
  }

  const systemPrompt =
    "你是智能体结果解读助手。用户的问题已经通过工具执行完成，你的任务是根据工具返回的原始数据，" +
    "生成一段自然、流畅、符合用户问题的中文回答。不要提及工具名称或技术细节，直接给出用户想要的答案。";

  const userPrompt =
    `用户问题: ${userQuery}\n\n` +
    `已执行的工具及结果:\n${toolResults.join("\n\n")}\n\n` +
    `请基于以上工具结果，生成一段自然的中文回答。直接给出答案，不要添加前言。`;

  try {
    const llmResponse = await callDeepSeek(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.5, maxTokens: 1024, jsonMode: false }
    );
    return llmResponse.content.trim() || buildFinalAnswer(observations, runnable);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[LLM Finalizer] Failed: ${error}`);
    return buildFinalAnswer(observations, runnable);
  }
}
