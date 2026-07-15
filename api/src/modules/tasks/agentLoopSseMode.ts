import type { AgentLoopEvent, AgentLoopResult, ToolObservation } from "../agent-loop/tools/_shared/types.js";
import type { AgentTranscriptEntry } from "../agent-loop/transcriptStore.js";

type LoopStopEvent = Extract<AgentLoopEvent, { type: "loop_stop" }>;
type MemoryRecallEvent = Extract<AgentLoopEvent, { type: "memory_recall" }>;

const STOPPED_BY_VALUES = new Set<AgentLoopResult["stoppedBy"]>([
  "final_answer",
  "max_turns",
  "model_error",
  "aborted",
]);

export function buildMemoryRecallEventsFromTranscript(
  entries: readonly AgentTranscriptEntry[]
): MemoryRecallEvent[] {
  return [...entries]
    .sort((left, right) => left.sequence - right.sequence)
    .filter(
      (entry): entry is AgentTranscriptEntry & { memoryRecall: NonNullable<AgentTranscriptEntry["memoryRecall"]> } =>
        entry.kind === "memory_recall" && entry.memoryRecall !== undefined
    )
    .map((entry) => ({
      type: "memory_recall",
      taskId: entry.taskId,
      turn: entry.turn,
      source: entry.memoryRecall.source,
      recalledCount: entry.memoryRecall.recalledCount,
      snippets: entry.memoryRecall.snippets,
    }));
}

export function buildLoopStopEventFromTaskResult(input: {
  taskId: string;
  status: "completed" | "failed" | "running" | "pending";
  result: unknown;
  error?: string | null;
}): LoopStopEvent | undefined {
  const result = recordValue(input.result);
  const isAgentLoopResult = result.mode === "agent_loop";

  if (!isAgentLoopResult && input.status !== "failed") {
    return undefined;
  }

  const turns = nonNegativeInteger(result.turns) ?? 0;
  const observations = observationArray(result.observations);
  const stoppedBy =
    stoppedByValue(result.stoppedBy) ?? (input.status === "failed" ? "model_error" : "final_answer");
  const finalAnswer =
    stringValue(result.message) ||
    stringValue(result.finalAnswer) ||
    stringValue(input.error) ||
    (input.status === "failed" ? "Task failed." : "");
  const logFilePath = stringValue(result.logFilePath);

  return {
    type: "loop_stop",
    taskId: input.taskId,
    turn: turns,
    result: {
      finalAnswer,
      turns,
      observations,
      stoppedBy,
      ...(logFilePath ? { logFilePath } : {}),
    },
  };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

function stoppedByValue(value: unknown): AgentLoopResult["stoppedBy"] | undefined {
  return typeof value === "string" && STOPPED_BY_VALUES.has(value as AgentLoopResult["stoppedBy"])
    ? (value as AgentLoopResult["stoppedBy"])
    : undefined;
}

function observationArray(value: unknown): ToolObservation[] {
  return Array.isArray(value) ? (value as ToolObservation[]) : [];
}
