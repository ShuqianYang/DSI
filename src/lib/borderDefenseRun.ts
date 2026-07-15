import type { AgentLoopEvent } from "@datasourceintelligence/shared";
import type { ThinkingStep, ChartData } from "@/types/prd";
import type { LoopOutcome } from "@/components/border-defense/types";
import { formatAgentLoopThinkingUpdate } from "@/lib/agentLoopStepFormatter";
import { extractChartsFromAgentLoopEvent, extractChartsFromTaskResult } from "@/lib/agentLoopCharts";

export function mergeSteps(current: ThinkingStep[], incoming: ThinkingStep[], completeAs?: ThinkingStep["status"]) {
  const next = current.map((step) => completeAs && (step.status === "pending" || step.status === "running") ? { ...step, status: completeAs } : step);
  for (const step of incoming) {
    const index = next.findIndex((item) => item.id === step.id);
    if (index >= 0) next[index] = { ...next[index], ...step };
    else next.push(step);
  }
  return next;
}

export function consumeAgentEvent(event: AgentLoopEvent, state: { steps: ThinkingStep[]; content: string; charts: ChartData[] }) {
  const update = formatAgentLoopThinkingUpdate(event);
  const charts = extractChartsFromAgentLoopEvent(event);
  const reportContent = reportContentFromAgentEvent(event);
  return {
    steps: mergeSteps(state.steps, update.steps, update.completeOpenStepsAs),
    content: reportContent || update.content || state.content,
    charts: [...state.charts, ...charts.filter((chart) => !state.charts.some((item) => item.chart_id === chart.chart_id))],
    outcome: event.type === "loop_stop" ? createOutcome(event) : undefined,
  };
}

function reportContentFromAgentEvent(event: AgentLoopEvent): string | undefined {
  if (event.type !== "tool_observation") return undefined;
  const observation = event.observation;
  const output = observation.output && typeof observation.output === "object" && !Array.isArray(observation.output)
    ? observation.output as Record<string, unknown>
    : {};
  return typeof output.report_content === "string" ? output.report_content : undefined;
}

export function createOutcome(event: Extract<AgentLoopEvent, { type: "loop_stop" }>): LoopOutcome {
  const { result } = event;
  const degraded = hasDegradedGeneration(result as unknown as Record<string, unknown>);
  const failedToolCount = result.observations.filter((item) => !item.ok).length;
  const reason = result.stoppedBy === "final_answer"
    ? `智能体已在 ${result.turns} 轮执行后生成最终答案${failedToolCount ? `，其中 ${failedToolCount} 个工具执行失败` : ""}`
    : result.stoppedBy === "max_turns"
      ? `达到最大执行轮次（${result.turns} 轮），未获得明确最终答案`
      : result.stoppedBy === "model_error"
        ? result.finalAnswer || "模型服务执行失败"
        : result.finalAnswer || "任务被取消或执行被中断";
  return {
    outcome: result.stoppedBy === "final_answer" ? (degraded ? "warning" : "success") : result.stoppedBy === "max_turns" ? "warning" : "failed",
    stoppedBy: result.stoppedBy,
    reason: degraded ? "日报模型生成失败，当前展示的是原始数据降级报告。" : reason,
    turns: result.turns,
    failedToolCount,
    logFilePath: result.logFilePath,
  };
}

export function chartsFromResult(result: Record<string, unknown> | null) {
  return result ? extractChartsFromTaskResult(result) : [];
}

export function stepsFromTaskResult(result: Record<string, unknown> | null): ThinkingStep[] {
  if (!result) return [];
  const observations = Array.isArray(result.observations) ? result.observations : [];
  const tools = observations.map((value, index): { step: ThinkingStep; turn?: number } => {
    const observation = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const toolName = typeof observation.toolName === "string" ? observation.toolName : "Tool";
    const toolCallId = typeof observation.toolCallId === "string" ? observation.toolCallId : `history-tool-${index}`;
    const ok = observation.ok !== false;
    const output = observation.output && typeof observation.output === "object" && !Array.isArray(observation.output)
      ? observation.output as Record<string, unknown>
      : undefined;
    const replayInput = toolName === "MysqlQuery" && typeof output?.sql === "string"
      ? {
          ...(typeof output.database === "string" ? { database: output.database } : {}),
          sql: output.sql,
        }
      : undefined;
    const turn = typeof observation.turn === "number" && Number.isInteger(observation.turn) && observation.turn >= 0
      ? observation.turn
      : undefined;
    return {
      turn,
      step: {
        id: toolCallId,
        name: toolName,
        status: ok ? "completed" : "failed",
        detail: ok ? "工具调用完成（历史回放）" : "工具调用失败（历史回放）",
        category: "tool",
        toolName,
        toolCallId,
        input: replayInput,
        output: observation.output ?? observation.error,
      },
    };
  });
  const turns = typeof result.turns === "number" ? Math.max(0, result.turns) : 0;
  const agents = Array.from({ length: turns }, (_, index): ThinkingStep => ({
    id: `agent-turn-${index + 1}`,
    name: `Agent Turn ${index + 1}`,
    status: "completed",
    detail: "本轮处理完成（历史回放）",
    category: "agent",
  }));
  const preLoopTools = tools.filter((item) => item.turn === 0 || (item.turn === undefined && item.step.toolName === "Skill"));
  const turnTools = tools.filter((item) => !preLoopTools.includes(item));
  const legacyTools = turnTools.filter((item) => item.turn === undefined);
  let legacyIndex = 0;
  const ordered: ThinkingStep[] = preLoopTools.map((item) => item.step);
  for (let turn = 1; turn <= agents.length; turn += 1) {
    ordered.push(agents[turn - 1]);
    ordered.push(...turnTools.filter((item) => item.turn === turn).map((item) => item.step));
    if (legacyIndex < legacyTools.length) {
      ordered.push(legacyTools[legacyIndex].step);
      legacyIndex += 1;
    }
  }
  ordered.push(...turnTools.filter((item) => typeof item.turn === "number" && item.turn > agents.length).map((item) => item.step));
  ordered.push(...legacyTools.slice(legacyIndex).map((item) => item.step));
  return ordered;
}

export function reportContentFromTaskResult(result: Record<string, unknown> | null): string | undefined {
  if (!result) return undefined;
  const candidates = [...Object.values(result), ...(Array.isArray(result.observations) ? result.observations : [])];
  for (const value of candidates) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    if (typeof record.report_content === "string") return record.report_content;
    const output = record.output;
    if (output && typeof output === "object" && !Array.isArray(output)) {
      const reportContent = (output as Record<string, unknown>).report_content;
      if (typeof reportContent === "string") return reportContent;
    }
  }
  return undefined;
}

export function outcomeFromTaskResult(result: Record<string, unknown> | null): LoopOutcome | undefined {
  if (!result) return undefined;
  const stoppedBy = result.stoppedBy;
  if (stoppedBy !== "final_answer" && stoppedBy !== "max_turns" && stoppedBy !== "model_error" && stoppedBy !== "aborted") return undefined;
  const observations = Array.isArray(result.observations) ? result.observations : [];
  const failedToolCount = observations.filter((item) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return record.ok === false;
  }).length;
  const turns = typeof result.turns === "number" ? result.turns : 0;
  const finalAnswer = typeof result.message === "string" ? result.message : "";
  const reason = stoppedBy === "final_answer"
    ? `智能体已在 ${turns} 轮执行后生成最终答案${failedToolCount ? `，其中 ${failedToolCount} 个工具执行失败` : ""}`
    : stoppedBy === "max_turns"
      ? `达到最大执行轮次（${turns} 轮），未获得明确最终答案`
      : finalAnswer || (stoppedBy === "model_error" ? "模型服务执行失败" : "任务被取消或执行被中断");
  const degraded = hasDegradedGeneration(result);
  return {
    outcome: stoppedBy === "final_answer" ? (degraded ? "warning" : "success") : stoppedBy === "max_turns" ? "warning" : "failed",
    stoppedBy,
    reason: degraded ? "日报模型生成失败，当前展示的是原始数据降级报告。" : reason,
    turns,
    failedToolCount,
    logFilePath: typeof result.logFilePath === "string" ? result.logFilePath : undefined,
  };
}

function hasDegradedGeneration(result: Record<string, unknown>): boolean {
  const candidates = [...Object.values(result), ...(Array.isArray(result.observations) ? result.observations : [])];
  return candidates.some((value) => {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const output = record.output && typeof record.output === "object" && !Array.isArray(record.output)
      ? record.output as Record<string, unknown>
      : record;
    const generation = output.generation && typeof output.generation === "object" && !Array.isArray(output.generation)
      ? output.generation as Record<string, unknown>
      : {};
    return generation.status === "degraded";
  });
}
