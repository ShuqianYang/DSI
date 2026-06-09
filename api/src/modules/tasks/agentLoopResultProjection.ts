import type { AgentLoopResult, ToolObservation } from "../agent-loop/types.js";

export type AgentLoopTaskResult = {
  message: string;
  mode: "agent_loop";
  turns: number;
  stoppedBy: AgentLoopResult["stoppedBy"];
  observations: ToolObservation[];
} & Record<string, unknown>;

export function buildAgentLoopTaskResult(loopResult: AgentLoopResult): AgentLoopTaskResult {
  return {
    message: loopResult.finalAnswer,
    mode: "agent_loop",
    turns: loopResult.turns,
    stoppedBy: loopResult.stoppedBy,
    ...(loopResult.logFilePath ? { logFilePath: loopResult.logFilePath } : {}),
    observations: loopResult.observations,
    ...projectObservationsToLegacyActionResults(loopResult.observations),
  };
}

function projectObservationsToLegacyActionResults(observations: ToolObservation[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const observation of observations) {
    result[observation.toolCallId] = projectObservationToLegacyActionResult(observation);
  }
  return result;
}

function projectObservationToLegacyActionResult(observation: ToolObservation): Record<string, unknown> {
  const output = isRecord(observation.output) ? observation.output : undefined;
  if (observation.ok) {
    return {
      success: true,
      ...(output ?? { data: observation.output }),
      metadata: {
        ...(isRecord(output?.metadata) ? output.metadata : {}),
        toolName: observation.toolName,
        toolCallId: observation.toolCallId,
      },
    };
  }

  return {
    success: false,
    ...(output ? { output } : {}),
    error: observation.error ?? {
      code: "tool_execution_error",
      message: "Tool call failed.",
    },
    metadata: {
      toolName: observation.toolName,
      toolCallId: observation.toolCallId,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
