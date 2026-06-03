import { db } from "../../config/database.js";
import { taskSteps } from "../../db/schema.js";
import { notifyTaskUpdate } from "../../sse/sseManager.js";
import { eq } from "drizzle-orm";
import { noopContextManager, type ContextManager } from "./contextManager.js";
import { noopMemoryManager, type MemoryManager } from "./memoryManager.js";
import { createModelClient, type ModelClient } from "./modelClient.js";
import { defaultPromptManager, type PromptManager } from "./promptManager.js";
import { noopSkillManager, type SkillManager } from "./skillManager.js";
import { callTool } from "./toolGateway.js";
import { buildDefaultToolRegistry, type ToolRegistry } from "./toolRegistry.js";
import {
  disabledTranscriptStore,
  type AgentTranscriptEntry,
  type AgentTranscriptStore,
} from "./transcriptStore.js";
import type {
  AgentMessage,
  AgentLoopResult,
  AgentRuntimeContext,
  GatewayToolCall,
  ToolObservation,
} from "./types.js";

const MAX_MODEL_TOOL_RESULT_CHARS = 50_000;
const MODEL_TOOL_RESULT_PREVIEW_CHARS = 2_000;

export interface RunAgentLoopOptions {
  taskId: string;
  query: string;
  maxTurns?: number;
  registry?: ToolRegistry;
  modelClient?: ModelClient;
  promptManager?: PromptManager;
  contextManager?: ContextManager;
  memoryManager?: MemoryManager;
  skillManager?: SkillManager;
  transcriptStore?: AgentTranscriptStore;
}

export async function runAgentLoop(options: RunAgentLoopOptions): Promise<AgentLoopResult> {
  const maxTurns = options.maxTurns ?? 10;
  const registry = options.registry ?? buildDefaultToolRegistry();
  const modelClient = options.modelClient ?? createModelClient();
  const promptManager = options.promptManager ?? defaultPromptManager;
  const contextManager = options.contextManager ?? noopContextManager;
  const memoryManager = options.memoryManager ?? noopMemoryManager;
  const skillManager = options.skillManager ?? noopSkillManager;
  const transcriptStore = options.transcriptStore ?? disabledTranscriptStore;

  const observations: ToolObservation[] = [];
  const conversationMessages: AgentMessage[] = [];
  let nextStepOrder = 1;
  let transcriptSequence = 1;

  const appendTranscript = async (
    entry: Omit<AgentTranscriptEntry, "taskId" | "sequence" | "createdAt">
  ) => {
    await transcriptStore.append({
      taskId: options.taskId,
      sequence: transcriptSequence++,
      createdAt: new Date(),
      ...entry,
    });
  };

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const runtimeContext: AgentRuntimeContext = {
      taskId: options.taskId,
      query: options.query,
      turn,
      maxTurns,
      observations,
    };

    notifyTaskUpdate(options.taskId, {
      type: "agent_turn",
      taskId: options.taskId,
      turn,
      maxTurns,
      message: `Agent loop turn ${turn}/${maxTurns}`,
    });

    const [contextSections, memorySections, skillSections] = await Promise.all([
      contextManager.buildContextSections(options.query),
      memoryManager.recall(options.query),
      skillManager.getRelevantSkills(options.query),
    ]);

    const callId = `call-${turn}`;
    const messages = promptManager.buildMessages({
      query: options.query,
      tools: registry.list(),
      contextSections,
      memorySections,
      skillSections,
      observations,
    }).concat(conversationMessages);

    await appendTranscript({
      turn,
      kind: "model_request",
      messages,
    });

    let decision;
    try {
      decision = await modelClient.decide({
        messages,
        tools: registry.list(),
        query: options.query,
        observations,
        callId,
      });
    } catch (error) {
      const finalAnswer = error instanceof Error ? error.message : String(error);
      await appendTranscript({
        turn,
        kind: "loop_stop",
        stoppedBy: "model_error",
        finalAnswer,
        error: finalAnswer,
      });
      return {
        finalAnswer,
        turns: turn,
        observations,
        stoppedBy: "model_error",
      };
    }

    if (decision.type === "final_answer") {
      conversationMessages.push({
        role: "assistant",
        content: decision.content,
      });
      await appendTranscript({
        turn,
        kind: "assistant_message",
        message: {
          role: "assistant",
          content: decision.content,
        },
      });
      await appendTranscript({
        turn,
        kind: "loop_stop",
        stoppedBy: "final_answer",
        finalAnswer: decision.content,
      });
      if (memoryManager.remember) {
        await memoryManager.remember(options.query, decision.content);
      }
      return {
        finalAnswer: decision.content,
        turns: turn,
        observations,
        stoppedBy: "final_answer",
      };
    }

    if (decision.toolCalls.length === 0) {
      const finalAnswer = "Model requested tool calls, but no calls were provided.";
      await appendTranscript({
        turn,
        kind: "loop_stop",
        stoppedBy: "model_error",
        finalAnswer,
        error: finalAnswer,
      });
      return {
        finalAnswer,
        turns: turn,
        observations,
        stoppedBy: "model_error",
      };
    }

    notifyTaskUpdate(options.taskId, {
      type: "tool_calls",
      taskId: options.taskId,
      turn,
      count: decision.toolCalls.length,
      tools: decision.toolCalls.map((toolCall) => toolCall.toolName),
    });

    const assistantMessage: AgentMessage = {
      role: "assistant",
      content: decision.content ?? "",
      toolCalls: decision.toolCalls,
    };
    conversationMessages.push(assistantMessage);
    await appendTranscript({
      turn,
      kind: "assistant_message",
      message: assistantMessage,
    });

    const batches = partitionToolCalls(registry, decision.toolCalls);
    for (const batch of batches) {
      const batchObservations = await executeToolBatch({
        taskId: options.taskId,
        query: options.query,
        turn,
        registry,
        toolCalls: batch.toolCalls,
        concurrent: batch.type === "concurrent",
        observationsSnapshot: [...observations],
        allocateOrder: () => nextStepOrder++,
      });
      observations.push(...batchObservations);
      for (const observation of batchObservations) {
        const toolMessage = toolObservationToMessage(observation);
        conversationMessages.push(toolMessage);
        await appendTranscript({
          turn,
          kind: "tool_message",
          message: toolMessage,
        });
      }
    }
  }

  const finalAnswer = await buildMaxTurnsAnswer({
    modelClient,
    query: options.query,
    observations,
    conversationMessages,
    callId: "max-turns-summary",
  });
  await appendTranscript({
    turn: maxTurns,
    kind: "loop_stop",
    stoppedBy: "max_turns",
    finalAnswer,
  });
  return {
    finalAnswer,
    turns: maxTurns,
    observations,
    stoppedBy: "max_turns",
  };
}

function toolObservationToMessage(observation: ToolObservation): AgentMessage {
  return {
    role: "tool",
    toolCallId: observation.toolCallId,
    toolName: observation.toolName,
    content: serializeToolObservationForModel(observation),
  };
}

function serializeToolObservationForModel(observation: ToolObservation): string {
  const content = JSON.stringify(observation);
  if (content.length <= MAX_MODEL_TOOL_RESULT_CHARS) {
    return content;
  }

  return JSON.stringify({
    toolCallId: observation.toolCallId,
    toolName: observation.toolName,
    ok: observation.ok,
    error: observation.error,
    outputPreview: content.slice(0, MODEL_TOOL_RESULT_PREVIEW_CHARS),
    originalChars: content.length,
    truncatedChars: content.length - MODEL_TOOL_RESULT_PREVIEW_CHARS,
    note:
      "Tool result exceeded the model-visible budget and was truncated. Use a narrower tool call if more detail is needed.",
  });
}

type ToolCallBatch =
  | { type: "concurrent"; toolCalls: GatewayToolCall[] }
  | { type: "sequential"; toolCalls: [GatewayToolCall] };

function partitionToolCalls(registry: ToolRegistry, toolCalls: GatewayToolCall[]): ToolCallBatch[] {
  const batches: ToolCallBatch[] = [];
  let currentConcurrent: GatewayToolCall[] = [];

  for (const toolCall of toolCalls) {
    if (isConcurrencySafe(registry, toolCall)) {
      currentConcurrent.push(toolCall);
      continue;
    }

    if (currentConcurrent.length > 0) {
      batches.push({ type: "concurrent", toolCalls: currentConcurrent });
      currentConcurrent = [];
    }
    batches.push({ type: "sequential", toolCalls: [toolCall] });
  }

  if (currentConcurrent.length > 0) {
    batches.push({ type: "concurrent", toolCalls: currentConcurrent });
  }

  return batches;
}

function isConcurrencySafe(registry: ToolRegistry, toolCall: GatewayToolCall): boolean {
  const tool = registry.get(toolCall.toolName);
  if (!tool?.isConcurrencySafe) return false;

  const parsed = tool.inputSchema.safeParse(toolCall.input);
  if (!parsed.success) return false;

  try {
    return tool.isConcurrencySafe(parsed.data);
  } catch {
    return false;
  }
}

async function executeToolBatch(options: {
  taskId: string;
  query: string;
  turn: number;
  registry: ToolRegistry;
  toolCalls: GatewayToolCall[];
  concurrent: boolean;
  observationsSnapshot: ToolObservation[];
  allocateOrder: () => number;
}): Promise<ToolObservation[]> {
  notifyTaskUpdate(options.taskId, {
    type: "tool_batch",
    taskId: options.taskId,
    turn: options.turn,
    mode: options.concurrent ? "concurrent" : "sequential",
    tools: options.toolCalls.map((toolCall) => toolCall.toolName),
  });

  if (options.concurrent) {
    return Promise.all(
      options.toolCalls.map((toolCall) =>
        executeSingleToolCall({
          ...options,
          toolCall,
          order: options.allocateOrder(),
        })
      )
    );
  }

  const observations: ToolObservation[] = [];
  for (const toolCall of options.toolCalls) {
    observations.push(
      await executeSingleToolCall({
        ...options,
        toolCall,
        order: options.allocateOrder(),
      })
    );
  }
  return observations;
}

async function executeSingleToolCall(options: {
  taskId: string;
  query: string;
  turn: number;
  registry: ToolRegistry;
  toolCall: GatewayToolCall;
  order: number;
  observationsSnapshot: ToolObservation[];
}): Promise<ToolObservation> {
  notifyTaskUpdate(options.taskId, {
    type: "tool_call",
    taskId: options.taskId,
    turn: options.turn,
    toolCallId: options.toolCall.id,
    toolName: options.toolCall.toolName,
    reason: options.toolCall.reason,
  });

  const stepId = await createToolStep(options.taskId, options.order, options.toolCall);
  await markToolStepRunning(stepId);

  const observation = await callTool(options.registry, options.toolCall, {
    taskId: options.taskId,
    query: options.query,
    observations: options.observationsSnapshot,
  });

  await markToolStepCompleted(stepId, observation);

  notifyTaskUpdate(options.taskId, {
    type: "tool_observation",
    taskId: options.taskId,
    turn: options.turn,
    toolCallId: observation.toolCallId,
    toolName: observation.toolName,
    ok: observation.ok,
    observation,
  });

  return observation;
}

async function createToolStep(
  taskId: string,
  order: number,
  toolCall: {
    id: string;
    toolName: string;
    input: Record<string, unknown>;
    reason?: string;
  }
): Promise<string> {
  const [step] = await db
    .insert(taskSteps)
    .values({
      taskId,
      actionType: toolCall.toolName,
      actionConfig: {
        id: toolCall.id,
        type: toolCall.toolName,
        name: toolCall.toolName,
        params: toolCall.input,
        reason: toolCall.reason,
        _order: order,
      },
      status: "pending",
    })
    .returning({ id: taskSteps.id });

  return step.id;
}

async function markToolStepRunning(stepId: string): Promise<void> {
  await db
    .update(taskSteps)
    .set({
      status: "running",
      startedAt: new Date(),
    })
    .where(eq(taskSteps.id, stepId));
}

async function markToolStepCompleted(stepId: string, observation: ToolObservation): Promise<void> {
  await db
    .update(taskSteps)
    .set({
      status: observation.ok ? "completed" : "failed",
      result: { observation },
      error: observation.error?.message,
      completedAt: new Date(),
    })
    .where(eq(taskSteps.id, stepId));
}

async function buildMaxTurnsAnswer(options: {
  modelClient: ModelClient;
  query: string;
  observations: ToolObservation[];
  conversationMessages: AgentMessage[];
  callId: string;
}): Promise<string> {
  const { observations } = options;
  if (observations.length === 0) {
    return "Agent loop reached the maximum number of turns without producing a final answer.";
  }

  try {
    const decision = await options.modelClient.decide({
      messages: [
        {
          role: "system",
          content: [
            "You are completing an agent run that reached its maximum tool-call turns.",
            "Do not call tools. Give the best final answer possible using the prior tool observations.",
            "Be concise, mention important limitations, and avoid dumping raw JSON unless the user asked for it.",
          ].join("\n"),
        },
        { role: "user", content: options.query },
        ...options.conversationMessages,
        {
          role: "user",
          content:
            "The agent loop reached its maximum number of tool-call turns. Produce the final answer now without using tools.",
        },
      ],
      tools: [],
      query: options.query,
      observations,
      callId: options.callId,
    });

    if (decision.type === "final_answer") {
      return decision.content;
    }
  } catch {
    // Fall back below. The max-turns path should still finish the task even if
    // the summary request fails.
  }

  return [
    "Agent loop reached the maximum number of turns before producing a final answer.",
    "Latest tool observations:",
    JSON.stringify(observations.slice(-3), null, 2),
  ].join("\n");
}
