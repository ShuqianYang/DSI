import type {
  CapabilityContract,
  HarnessRuntimeState,
  Observation,
} from "../actions/contracts/types.js";
import { notifyTaskUpdate } from "../../sse/sseManager.js";
import {
  createRuntimeState,
  pushObservation,
  markToolUsed,
  hasUsedTool,
  isMaxStepsReached,
  completeState,
  failState,
} from "./runtimeState.js";
import { retrieveCandidateTools, filterUsedTools } from "./retrieveCandidateTools.js";
import { makeAgentDecision } from "./agentDecision.js";
import { validateToolCall } from "../actions/contracts/toolValidator.js";
import { executeTool } from "./toolGateway.js";
import {
  writeStepSnapshot,
  buildSnapshot,
  updateStepRunning,
  updateStepCompleted,
  updateStepFailed,
} from "./taskStepSnapshot.js";

export interface AgentLoopOptions {
  taskId: string;
  query: string;
  registry: Map<string, CapabilityContract>;
  maxSteps?: number;
}

export interface AgentLoopResult {
  status: "completed" | "failed" | "legacy_fallback";
  finalText?: string;
  observations: Observation[];
  blockedReason?: string;
}

/**
 * Open Agent Loop：未命中 template / skill 后的多轮智能体决策。
 *
 * 每轮循环：
 * 1. retrieveCandidateTools → top-k 候选
 * 2. filterUsedTools → 过滤已调用
 * 3. makeAgentDecision → Agent 输出决策
 * 4. 根据决策类型执行：
 *    - tool_call → validate → execute → observation 回写
 *    - final_answer → 结束 loop
 *    - create_requirement → 结束 loop
 *    - legacy_fallback → 结束 loop，回退旧 pipeline
 */
export async function runOpenAgentLoop(
  options: AgentLoopOptions
): Promise<AgentLoopResult> {
  const { taskId, query, registry, maxSteps } = options;
  const state = createRuntimeState(taskId, query, { maxSteps });

  // 推送 loop 开始
  notifyTaskUpdate(taskId, {
    type: "agent_thinking",
    message: "正在分析请求，检索候选工具...",
  });

  while (state.status === "running") {
    // 硬限制：maxSteps
    if (isMaxStepsReached(state)) {
      completeState(state, "max_steps_reached");
      notifyTaskUpdate(taskId, {
        type: "final_answer",
        message: "已达到最大步数限制，给出当前最佳回答。",
      });
      return {
        status: "completed",
        finalText: buildTruncatedAnswer(state.observations),
        observations: state.observations,
      };
    }

    // 1. 检索候选工具
    const candidates = retrieveCandidateTools(
      state.userQuery,
      state.observations,
      registry
    );

    const usedToolNames = new Set(state.usedTools.map((t) => t.toolName));
    const filtered = filterUsedTools(candidates, usedToolNames);

    if (filtered.length === 0) {
      // 如果已有 observations，让 LLM 基于已有信息判断是否可以 final_answer
      if (state.observations.length > 0) {
        const finalDecision = await makeAgentDecision(
          state.userQuery,
          state.observations,
          [],
          registry
        );

        if (finalDecision.decision === "final_answer") {
          completeState(state, "final_answer");
          notifyTaskUpdate(taskId, {
            type: "final_answer",
            message: finalDecision.finalText,
          });
          return {
            status: "completed",
            finalText: finalDecision.finalText,
            observations: state.observations,
          };
        }

        // LLM 判断需要更多工具但无候选可用，返回当前最佳回答
        const truncated = buildTruncatedAnswer(state.observations);
        completeState(state, "no_candidates_after_llm");
        notifyTaskUpdate(taskId, {
          type: "final_answer",
          message: truncated || "已获取部分信息，但无法进一步处理。",
        });
        return {
          status: "completed",
          finalText: truncated || "已获取部分信息，但无法进一步处理。",
          observations: state.observations,
        };
      }

      // 无 observations，返回兜底文案
      completeState(state, "no_candidates");
      notifyTaskUpdate(taskId, {
        type: "final_answer",
        message: "没有可用工具能继续处理该请求。",
      });
      return {
        status: "completed",
        finalText: "当前没有可用工具能处理您的请求。",
        observations: state.observations,
      };
    }

    // 2. Agent 决策
    const decision = await makeAgentDecision(
      state.userQuery,
      state.observations,
      filtered,
      registry
    );

    // 3. 根据决策类型处理
    switch (decision.decision) {
      case "tool_call": {
        const { tool, params, reason } = decision;
        const sequence = state.stepCount + 1;
        const stepKey = `agent.step.${String(sequence).padStart(3, "0")}`;

        // 防重复调用检查
        if (hasUsedTool(state, tool, params)) {
          failState(state, `重复调用被拦截: ${tool}`);
          notifyTaskUpdate(taskId, {
            type: "step_blocked",
            stepKey,
            reason: `工具 ${tool} 已被调用过，参数相同。`,
          });
          continue;
        }

        notifyTaskUpdate(taskId, {
          type: "agent_thinking",
          message: reason,
          nextTool: tool,
        });

        // 写入 pending snapshot
        const snapshot = buildSnapshot(
          "agent",
          "tool_call",
          state.runId,
          sequence,
          stepKey,
          { type: tool, name: tool, params },
          { agentDecision: decision }
        );
        const { stepId } = await writeStepSnapshot(taskId, snapshot, "pending");

        // 校验
        const validation = validateToolCall(tool, params, state, registry);
        if (!validation.ok) {
          await updateStepFailed(stepId, validation.reason || "参数校验失败");
          failState(state, validation.reason || "参数校验失败");
          notifyTaskUpdate(taskId, {
            type: "step_failed",
            stepKey,
            reason: validation.reason,
          });
          continue;
        }

        // 执行
        await updateStepRunning(stepId);
        notifyTaskUpdate(taskId, {
          type: "step_running",
          stepKey,
          tool,
        });

        const execResult = await executeTool(tool, params, state, registry);

        // 回填 observation sequence
        execResult.observation.sequence = sequence;
        pushObservation(state, execResult.observation);
        markToolUsed(state, tool, params);

        if (execResult.success) {
          await updateStepCompleted(stepId, {
            observation: execResult.observation,
          });
          notifyTaskUpdate(taskId, {
            type: "step_completed",
            stepKey,
            tool,
            observation: execResult.observation,
          });
        } else {
          await updateStepFailed(stepId, execResult.observation.error || "执行失败");
          notifyTaskUpdate(taskId, {
            type: "step_failed",
            stepKey,
            tool,
            error: execResult.observation.error,
          });
          // 执行失败不立即结束 loop，让 Agent 在下一轮决定如何处理
        }
        break;
      }

      case "final_answer": {
        completeState(state, "final_answer");
        notifyTaskUpdate(taskId, {
          type: "final_answer",
          message: decision.finalText,
        });
        return {
          status: "completed",
          finalText: decision.finalText,
          observations: state.observations,
        };
      }

      case "create_requirement": {
        completeState(state, "create_requirement");
        notifyTaskUpdate(taskId, {
          type: "requirement_created",
          requirement: decision.requirementDraft,
        });
        return {
          status: "completed",
          finalText: `需求已记录：${decision.requirementDraft.title}`,
          observations: state.observations,
        };
      }

      case "legacy_fallback": {
        completeState(state, "legacy_fallback");
        notifyTaskUpdate(taskId, {
          type: "legacy_fallback",
          message: decision.reason,
        });
        return {
          status: "legacy_fallback",
          observations: state.observations,
        };
      }
    }
  }

  // loop 意外退出
  return {
    status: state.status === "failed" ? "failed" : "completed",
    observations: state.observations,
    blockedReason: state.blockedReasons[0],
  };
}

function buildTruncatedAnswer(observations: Observation[]): string {
  const parts: string[] = [];
  for (const obs of observations) {
    if (obs.success && obs.result) {
      const result = obs.result as Record<string, unknown>;
      if (typeof result.message === "string") {
        parts.push(result.message);
      }
    }
  }
  return parts.join("\n") || "处理完成，但未生成有效回答。";
}
