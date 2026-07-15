import type { AgentLoopEvent, ToolObservation } from "./tools/_shared/types.js";

export type QaBusinessEvent =
  | {
      type: "qa_connected";
      taskId: string;
    }
  | {
      type: "qa_text";
      taskId: string;
      content: string;
    }
  | {
      type: "qa_tool_start";
      taskId: string;
      toolName: string;
      displayName?: string;
      toolCallId: string;
    }
  | {
      type: "qa_tool_progress";
      taskId: string;
      toolName: string;
      displayName?: string;
      toolCallId: string;
      stage?: string;
      message?: string;
      percent?: number;
      data?: unknown;
    }
  | {
      type: "qa_chart";
      taskId: string;
      toolCallId: string;
      chart: Record<string, unknown>;
    }
  | {
      type: "qa_final";
      taskId: string;
      content: string;
      stoppedBy: string;
    };

export function projectAgentLoopEventToQaBusinessEvents(event: AgentLoopEvent): QaBusinessEvent[] {
  switch (event.type) {
    case "assistant_message": {
      const content = event.message.content?.trim();
      return content ? [{ type: "qa_text", taskId: event.taskId, content }] : [];
    }
    case "tool_call":
      return [
        {
          type: "qa_tool_start",
          taskId: event.taskId,
          toolName: event.toolName,
          ...(event.displayName ? { displayName: event.displayName } : {}),
          toolCallId: event.toolCallId,
        },
      ];
    case "tool_progress":
      return [
        {
          type: "qa_tool_progress",
          taskId: event.taskId,
          toolName: event.toolName,
          ...(event.displayName ? { displayName: event.displayName } : {}),
          toolCallId: event.toolCallId,
          ...(event.stage ? { stage: event.stage } : {}),
          ...(event.message ? { message: event.message } : {}),
          ...(typeof event.percent === "number" ? { percent: event.percent } : {}),
          ...(event.data !== undefined ? { data: event.data } : {}),
        },
      ];
    case "tool_observation":
      return projectObservation(event.taskId, event.observation);
    case "loop_stop":
      return [
        {
          type: "qa_final",
          taskId: event.taskId,
          content: event.result.finalAnswer,
          stoppedBy: event.result.stoppedBy,
        },
      ];
    default:
      return [];
  }
}

function projectObservation(taskId: string, observation: ToolObservation): QaBusinessEvent[] {
  if (!observation.ok) return [];
  const output = recordValue(observation.output);
  const events: QaBusinessEvent[] = [];

  const chart = extractChart(output);
  if (chart) {
    events.push({
      type: "qa_chart",
      taskId,
      toolCallId: observation.toolCallId,
      chart,
    });
  }

  return events;
}

function extractChart(output: Record<string, unknown>): Record<string, unknown> | undefined {
  if (typeof output.chart_id === "string" && typeof output.chart_type === "string") {
    return output;
  }
  const data = recordValue(output.data);
  if (typeof data.chart_id === "string" && typeof data.chart_type === "string") {
    return data;
  }
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
