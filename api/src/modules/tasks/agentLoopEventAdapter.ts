import type { AgentLoopEvent, GatewayToolCall } from "../agent-loop/types.js";

export type LegacySseEvent =
  | {
      type: "planning_done";
      taskId: string;
      plan: {
        goal: string;
        reasoning: string;
        steps: Array<{ id: string; description: string; purpose: string }>;
      };
    }
  | {
      type: "routing";
      stage: "router";
      message: string;
    }
  | {
      type: "routing_done";
      taskId: string;
      actions: LegacyAction[];
    }
  | LegacyStepUpdate;

export interface LegacyAction {
  id: string;
  type: string;
  name: string;
  description: string;
  params: Record<string, unknown>;
  dependsOn?: string[];
}

export interface LegacyStepUpdate {
  type: "step_update";
  stepIndex?: number;
  stepId?: string;
  actionId: string;
  actionType: string;
  status: "running" | "completed" | "failed";
  name: string;
  detail?: string;
  gisData?: unknown;
  operations?: unknown[];
}

interface LegacyAdapterOptions {
  taskId: string;
  query: string;
  emit: (event: LegacySseEvent) => void;
}

export function createLegacySseAdapter(options: LegacyAdapterOptions) {
  let planningDoneEmitted = false;
  let routingStartedEmitted = false;
  let routingDoneEmitted = false;

  return {
    handle(event: AgentLoopEvent): void {
      if (event.taskId !== options.taskId) return;

      if (event.type === "agent_turn" && !planningDoneEmitted) {
        planningDoneEmitted = true;
        options.emit(createPlanningDoneEvent(options.taskId, options.query));
        return;
      }

      if (event.type === "assistant_message" && event.message.toolCalls?.length) {
        if (!routingStartedEmitted) {
          routingStartedEmitted = true;
          options.emit({
            type: "routing",
            stage: "router",
            message: "Agent Loop is selecting tools...",
          });
        }
        if (!routingDoneEmitted) {
          routingDoneEmitted = true;
          options.emit({
            type: "routing_done",
            taskId: options.taskId,
            actions: event.message.toolCalls.map(projectToolCallToLegacyAction),
          });
        }
        return;
      }

      if (event.type === "tool_call") {
        options.emit({
          type: "step_update",
          actionId: event.toolCallId,
          actionType: event.toolName,
          status: "running",
          name: event.toolName,
          detail: event.reason || `${event.toolName} running`,
        });
        return;
      }

      if (event.type === "tool_progress") {
        options.emit({
          type: "step_update",
          actionId: event.toolCallId,
          actionType: event.toolName,
          status: "running",
          name: event.toolName,
          detail: event.message || event.stage,
        });
        return;
      }

      if (event.type === "tool_observation") {
        const payload = extractLegacyPayload({ observation: event.observation });
        options.emit({
          type: "step_update",
          actionId: event.toolCallId,
          actionType: event.toolName,
          status: event.ok ? "completed" : "failed",
          name: event.toolName,
          detail: summarizeObservation(event.observation),
          gisData: payload.gisData,
          operations: payload.operations,
        });
      }
    },
  };
}

export function createLegacyStepUpdateFromTaskStep(step: {
  id: string;
  actionType: string;
  actionConfig: unknown;
  status: "completed" | "failed" | "running" | "pending";
  result: unknown;
  error?: string | null;
}): LegacyStepUpdate {
  const actionConfig = objectRecord(step.actionConfig);
  const actionId = stringValue(actionConfig.id) || step.id;
  const actionName = stringValue(actionConfig.name) || step.actionType;
  const order = numberValue(actionConfig._order);
  const payload = extractLegacyPayload(step.result);
  return {
    type: "step_update",
    stepIndex: order ? order - 1 : undefined,
    stepId: step.id,
    actionId,
    actionType: step.actionType,
    status: step.status === "failed" ? "failed" : step.status === "completed" ? "completed" : "running",
    name: actionName,
    detail: step.error || stringValue(actionConfig.reason) || undefined,
    gisData: payload.gisData,
    operations: payload.operations,
  };
}

export function extractLegacyPayload(value: unknown): {
  gisData?: unknown;
  operations?: unknown[];
} {
  const root = objectRecord(value);
  const observation = objectRecord(root.observation);
  const output = objectRecord(observation.output ?? root.output ?? value);
  const data = objectRecord(output.data);

  const gisData = root.gisData ?? output.gisData ?? data.gisData;
  const operations = arrayValue(root.operations) ?? arrayValue(output.operations) ?? arrayValue(data.operations);

  return {
    gisData,
    operations,
  };
}

function createPlanningDoneEvent(taskId: string, query: string): LegacySseEvent {
  return {
    type: "planning_done",
    taskId,
    plan: {
      goal: query,
      reasoning: "Agent Loop will inspect context, choose tools, and synthesize an answer.",
      steps: [
        {
          id: "agent-loop-context",
          description: "Prepare Agent Loop context",
          purpose: "Load task context, instructions, skills, and available tools.",
        },
      ],
    },
  };
}

function projectToolCallToLegacyAction(toolCall: GatewayToolCall): LegacyAction {
  return {
    id: toolCall.id,
    type: toolCall.toolName,
    name: toolCall.toolName,
    description: toolCall.reason || `${toolCall.toolName} tool call`,
    params: toolCall.input,
  };
}

function summarizeObservation(observation: {
  ok: boolean;
  output?: unknown;
  error?: { message: string };
}): string | undefined {
  if (!observation.ok) return observation.error?.message || "Tool call failed";
  if (typeof observation.output === "string") return truncate(observation.output, 500);
  if (observation.output && typeof observation.output === "object") {
    const output = observation.output as Record<string, unknown>;
    const summary =
      stringValue(output.summary) ||
      stringValue(output.message) ||
      stringValue(output.content) ||
      stringValue(output.finalAnswer);
    if (summary) return truncate(summary, 500);
    return truncate(JSON.stringify(observation.output), 500);
  }
  return "Tool call completed";
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function truncate(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 3)}...`;
}
