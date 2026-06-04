import { db } from "../../config/database.js";
import { taskSteps } from "../../db/schema.js";
import { notifyTaskUpdate } from "../../sse/sseManager.js";
import { eq } from "drizzle-orm";
import { defaultContextProvider, type ContextProvider } from "./contextProvider.js";
import {
  defaultContextWindowManager,
  type ContextWindowManager,
} from "./contextWindowManager.js";
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
  AgentLoopEvent,
  AgentLoopPrefetch,
  AgentLoopToolUseContext,
  AgentMessage,
  AgentLoopResult,
  GatewayToolCall,
  PromptSection,
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
  contextProvider?: ContextProvider;
  contextWindowManager?: ContextWindowManager;
  memoryManager?: MemoryManager;
  skillManager?: SkillManager;
  transcriptStore?: AgentTranscriptStore;
  signal?: AbortSignal;
  onToolProgress?: (event: Extract<AgentLoopEvent, { type: "tool_progress" }>) => void;
}

export async function runAgentLoop(options: RunAgentLoopOptions): Promise<AgentLoopResult> {
  let finalResult: AgentLoopResult | undefined;
  const eventOptions: RunAgentLoopOptions = {
    ...options,
    onToolProgress: (event) => {
      publishAgentLoopEvent(event);
      options.onToolProgress?.(event);
    },
  };

  for await (const event of runAgentLoopEvents(eventOptions)) {
    publishAgentLoopEvent(event);
    if (event.type === "loop_stop") {
      finalResult = event.result;
    }
  }

  if (!finalResult) {
    throw new Error("Agent loop ended without a loop_stop event");
  }

  return finalResult;
}

export async function* runAgentLoopEvents(
  options: RunAgentLoopOptions
): AsyncGenerator<AgentLoopEvent, AgentLoopResult, void> {
  const maxTurns = options.maxTurns ?? 10;
  const registry = options.registry ?? buildDefaultToolRegistry();
  const modelClient = options.modelClient ?? createModelClient();
  const promptManager = options.promptManager ?? defaultPromptManager;
  const contextProvider = options.contextProvider ?? defaultContextProvider;
  const contextWindowManager = options.contextWindowManager ?? defaultContextWindowManager;
  const memoryManager = options.memoryManager ?? noopMemoryManager;
  const skillManager = options.skillManager ?? noopSkillManager;
  const transcriptStore = options.transcriptStore ?? disabledTranscriptStore;

  const observations: ToolObservation[] = [];
  const conversationMessages: AgentMessage[] = [];
  const initialMessages: AgentMessage[] = [{ role: "user", content: options.query }];
  const usedToolSignatures = new Map<string, ToolObservation>();
  let toolUseContext = createAgentLoopToolUseContext({
    taskId: options.taskId,
    query: options.query,
    messages: initialMessages,
    observations,
    tools: registry.list(),
    signal: options.signal,
  });
  const memoryPrefetch = memoryManager.startRelevantMemoryPrefetch(
    toolUseContext.messages,
    toolUseContext
  );
  const contextProviderInput = {
    taskId: options.taskId,
    query: options.query,
    tools: registry.list(),
    toolUseContext,
    signal: options.signal,
  };
  const [userContext, systemContext, contextSections] = await Promise.all([
    contextProvider.getUserContext(contextProviderInput),
    contextProvider.getSystemContext(contextProviderInput),
    contextProvider.getContextSections(contextProviderInput),
  ]);
  const skillListingSections = await skillManager.getSkillListingSections(toolUseContext);
  let memorySections: PromptSection[] = [];
  let skillDiscoverySections: PromptSection[] = [];
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

  try {
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const loopMessages = [...initialMessages, ...conversationMessages];
    toolUseContext = updateAgentLoopToolUseContext(toolUseContext, {
      messages: loopMessages,
      observations,
      tools: registry.list(),
      signal: options.signal,
    });
    const activeTools = toolUseContext.options.tools;

    if (options.signal?.aborted) {
      const finalAnswer = formatAbortReason(options.signal.reason);
      const result: AgentLoopResult = {
        finalAnswer,
        turns: turn,
        observations,
        stoppedBy: "aborted",
      };
      await appendTranscript({
        turn,
        kind: "loop_stop",
        stoppedBy: "aborted",
        finalAnswer,
        error: finalAnswer,
      });
      yield {
        type: "loop_stop",
        taskId: options.taskId,
        turn,
        result,
      };
      return result;
    }

    const skillPrefetch = skillManager.startSkillDiscoveryPrefetch(
      null,
      toolUseContext.messages,
      toolUseContext
    );
    try {

    yield {
      type: "agent_turn",
      taskId: options.taskId,
      turn,
      maxTurns,
      message: `Agent loop turn ${turn}/${maxTurns}`,
    };

    const callId = `call-${turn}`;
    const skillSections = [...skillListingSections, ...skillDiscoverySections];
    const rawMessages = promptManager.buildMessages({
      query: options.query,
      tools: activeTools,
      userContext,
      systemContext,
      contextSections,
      memorySections,
      skillSections,
      observations,
    }).concat(conversationMessages);
    const prepared = await contextWindowManager.prepareMessages({
      messages: rawMessages,
      toolUseContext,
    });
    const messages = prepared.messages;

    await appendTranscript({
      turn,
      kind: "model_request",
      messages,
    });
    yield {
      type: "model_request",
      taskId: options.taskId,
      turn,
      messages,
    };

    let decision;
    try {
      decision = await modelClient.decide({
        messages,
        tools: activeTools,
        query: options.query,
        observations,
        callId,
      });
    } catch (error) {
      const finalAnswer = error instanceof Error ? error.message : String(error);
      const result: AgentLoopResult = {
        finalAnswer,
        turns: turn,
        observations,
        stoppedBy: "model_error",
      };
      await appendTranscript({
        turn,
        kind: "loop_stop",
        stoppedBy: "model_error",
        finalAnswer,
        error: finalAnswer,
      });
      yield {
        type: "loop_stop",
        taskId: options.taskId,
        turn,
        result,
      };
      return result;
    }

    if (decision.type === "final_answer") {
      const assistantMessage: AgentMessage = {
        role: "assistant",
        content: decision.content,
      };
      conversationMessages.push(assistantMessage);
      await appendTranscript({
        turn,
        kind: "assistant_message",
        message: assistantMessage,
      });
      yield {
        type: "assistant_message",
        taskId: options.taskId,
        turn,
        message: assistantMessage,
      };
      const result: AgentLoopResult = {
        finalAnswer: decision.content,
        turns: turn,
        observations,
        stoppedBy: "final_answer",
      };
      await appendTranscript({
        turn,
        kind: "loop_stop",
        stoppedBy: "final_answer",
        finalAnswer: decision.content,
      });
      if (memoryManager.remember) {
        await memoryManager.remember({
          query: options.query,
          finalAnswer: decision.content,
          result,
          messages: [...initialMessages, ...conversationMessages],
          observations,
          toolUseContext,
        });
      }
      yield {
        type: "loop_stop",
        taskId: options.taskId,
        turn,
        result,
      };
      return result;
    }

    if (decision.toolCalls.length === 0) {
      const finalAnswer = "Model requested tool calls, but no calls were provided.";
      const result: AgentLoopResult = {
        finalAnswer,
        turns: turn,
        observations,
        stoppedBy: "model_error",
      };
      await appendTranscript({
        turn,
        kind: "loop_stop",
        stoppedBy: "model_error",
        finalAnswer,
        error: finalAnswer,
      });
      yield {
        type: "loop_stop",
        taskId: options.taskId,
        turn,
        result,
      };
      return result;
    }

    yield {
      type: "tool_calls",
      taskId: options.taskId,
      turn,
      count: decision.toolCalls.length,
      tools: decision.toolCalls.map((toolCall) => toolCall.toolName),
    };

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
    yield {
      type: "assistant_message",
      taskId: options.taskId,
      turn,
      message: assistantMessage,
    };

    const batches = partitionToolCalls(registry, decision.toolCalls);
    for (const batch of batches) {
      const batchObservations = yield* executeToolBatch({
        taskId: options.taskId,
        query: options.query,
        turn,
        registry,
        toolCalls: batch.toolCalls,
        concurrent: batch.type === "concurrent",
        observationsSnapshot: [...observations],
        allocateOrder: () => nextStepOrder++,
        signal: options.signal,
        onToolProgress: options.onToolProgress,
        toolUseContext,
        usedToolSignatures,
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
        yield {
          type: "tool_message",
          taskId: options.taskId,
          turn,
          message: toolMessage,
        };
      }
    }

    const nextMemorySections = await consumeMemoryPrefetchIfReady({
      prefetch: memoryPrefetch,
      turn,
      memoryManager,
      toolUseContext,
    });
    if (nextMemorySections.length > 0) {
      memorySections = [...memorySections, ...nextMemorySections];
    }

    if (skillPrefetch) {
      const nextSkillSections = await skillManager.collectSkillDiscoveryPrefetch(skillPrefetch);
      if (nextSkillSections.length > 0) {
        skillDiscoverySections = [...skillDiscoverySections, ...nextSkillSections];
      }
    }
    } finally {
      skillPrefetch?.dispose?.();
    }
  }
  } finally {
    memoryPrefetch?.dispose?.();
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
  const result: AgentLoopResult = {
    finalAnswer,
    turns: maxTurns,
    observations,
    stoppedBy: "max_turns",
  };
  yield {
    type: "loop_stop",
    taskId: options.taskId,
    turn: maxTurns,
    result,
  };
  return result;
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

function createAgentLoopToolUseContext(input: {
  taskId: string;
  query: string;
  messages: AgentMessage[];
  observations: ToolObservation[];
  tools: ReturnType<ToolRegistry["list"]>;
  signal?: AbortSignal;
}): AgentLoopToolUseContext {
  return {
    taskId: input.taskId,
    query: input.query,
    messages: input.messages,
    observations: input.observations,
    options: {
      tools: input.tools,
    },
    signal: input.signal,
    readFileState: new Map(),
    nestedMemoryAttachmentTriggers: new Set(),
    dynamicSkillDirTriggers: new Set(),
    discoveredSkillNames: new Set(),
  };
}

function updateAgentLoopToolUseContext(
  context: AgentLoopToolUseContext,
  input: {
    messages: AgentMessage[];
    observations: ToolObservation[];
    tools: ReturnType<ToolRegistry["list"]>;
    signal?: AbortSignal;
  }
): AgentLoopToolUseContext {
  const refreshedTools = context.options.refreshTools?.() ?? input.tools;
  return {
    ...context,
    messages: input.messages,
    observations: input.observations,
    signal: input.signal,
    options: {
      ...context.options,
      tools: refreshedTools,
    },
  };
}

async function consumeMemoryPrefetchIfReady(input: {
  prefetch: AgentLoopPrefetch | undefined;
  turn: number;
  memoryManager: MemoryManager;
  toolUseContext: AgentLoopToolUseContext;
}): Promise<PromptSection[]> {
  const { prefetch } = input;
  if (!prefetch || prefetch.settledAt === null || prefetch.consumedOnIteration !== -1) {
    return [];
  }

  const sections = await prefetch.promise;
  prefetch.consumedOnIteration = input.turn - 1;
  return input.memoryManager.filterDuplicateMemorySections
    ? input.memoryManager.filterDuplicateMemorySections(sections, input.toolUseContext)
    : sections;
}

function publishAgentLoopEvent(event: AgentLoopEvent): void {
  switch (event.type) {
    case "agent_turn":
    case "tool_calls":
    case "tool_batch":
    case "tool_call":
    case "tool_progress":
    case "tool_observation":
    case "assistant_message":
    case "loop_stop":
      notifyTaskUpdate(event.taskId, event);
      break;
    case "model_request":
    case "tool_message":
      break;
  }
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

async function* executeToolBatch(options: {
  taskId: string;
  query: string;
  turn: number;
  registry: ToolRegistry;
  toolCalls: GatewayToolCall[];
  concurrent: boolean;
  observationsSnapshot: ToolObservation[];
  allocateOrder: () => number;
  signal?: AbortSignal;
  onToolProgress?: (event: Extract<AgentLoopEvent, { type: "tool_progress" }>) => void;
  toolUseContext: AgentLoopToolUseContext;
  usedToolSignatures: Map<string, ToolObservation>;
}): AsyncGenerator<AgentLoopEvent, ToolObservation[], void> {
  yield {
    type: "tool_batch",
    taskId: options.taskId,
    turn: options.turn,
    mode: options.concurrent ? "concurrent" : "sequential",
    tools: options.toolCalls.map((toolCall) => toolCall.toolName),
  };

  if (options.concurrent) {
    const executions: Array<Promise<{ observation: ToolObservation; signature?: string }>> = [];
    for (const toolCall of options.toolCalls) {
      yield toolCallEvent(options, toolCall);
      const signature = getReadOnlyToolSignature(options.registry, toolCall);
      const previousObservation = signature ? options.usedToolSignatures.get(signature) : undefined;
      if (signature && previousObservation) {
        executions.push(
          Promise.resolve({
            observation: createDuplicateToolObservation(toolCall, previousObservation),
          })
        );
        continue;
      }
      executions.push(
        executeSingleToolCall({
          ...options,
          toolCall,
          order: options.allocateOrder(),
        }).then((observation) => ({ observation, signature }))
      );
    }
    const completed = await Promise.all(executions);
    const observations = completed.map((item) => item.observation);
    for (const item of completed) {
      rememberToolSignature(options.usedToolSignatures, item.signature, item.observation);
    }
    for (const observation of observations) {
      yield toolObservationEvent(options, observation);
    }
    return observations;
  }

  const observations: ToolObservation[] = [];
  for (const toolCall of options.toolCalls) {
    yield toolCallEvent(options, toolCall);
    const signature = getReadOnlyToolSignature(options.registry, toolCall);
    const previousObservation = signature ? options.usedToolSignatures.get(signature) : undefined;
    if (signature && previousObservation) {
      const duplicateObservation = createDuplicateToolObservation(toolCall, previousObservation);
      observations.push(duplicateObservation);
      yield toolObservationEvent(options, duplicateObservation);
      continue;
    }
    const observation = await executeSingleToolCall({
      ...options,
      toolCall,
      order: options.allocateOrder(),
    });
    rememberToolSignature(options.usedToolSignatures, signature, observation);
    observations.push(observation);
    yield toolObservationEvent(options, observation);
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
  signal?: AbortSignal;
  onToolProgress?: (event: Extract<AgentLoopEvent, { type: "tool_progress" }>) => void;
  toolUseContext: AgentLoopToolUseContext;
}): Promise<ToolObservation> {
  const stepId = await createToolStep(options.taskId, options.order, options.toolCall);
  await markToolStepRunning(stepId);

  const observation = await callTool(options.registry, options.toolCall, {
    taskId: options.taskId,
    query: options.query,
    observations: options.observationsSnapshot,
    signal: options.signal,
    toolUseContext: options.toolUseContext,
    onProgress: (event) => {
      options.onToolProgress?.({
        type: "tool_progress",
        taskId: options.taskId,
        turn: options.turn,
        toolCallId: event.toolCallId || options.toolCall.id,
        toolName: event.toolName || options.toolCall.toolName,
        stage: event.stage,
        message: event.message,
        percent: event.percent,
        data: event.data,
      });
    },
  });

  await markToolStepCompleted(stepId, observation);

  return observation;
}

function getReadOnlyToolSignature(
  registry: ToolRegistry,
  toolCall: GatewayToolCall,
): string | undefined {
  const tool = registry.get(toolCall.toolName);
  if (!tool?.isReadOnly) return undefined;

  const parsed = tool.inputSchema.safeParse(toolCall.input);
  if (!parsed.success) return undefined;

  try {
    if (!tool.isReadOnly(parsed.data)) return undefined;
  } catch {
    return undefined;
  }

  return stableStringify({
    toolName: tool.name,
    input: parsed.data,
  });
}

function rememberToolSignature(
  usedToolSignatures: Map<string, ToolObservation>,
  signature: string | undefined,
  observation: ToolObservation,
): void {
  if (!signature) return;
  usedToolSignatures.set(signature, observation);
}

function createDuplicateToolObservation(
  toolCall: GatewayToolCall,
  previousObservation: ToolObservation,
): ToolObservation {
  if (!previousObservation.ok) {
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.toolName,
      ok: false,
      output: {
        skipped: true,
        previousToolCallId: previousObservation.toolCallId,
        previousOk: previousObservation.ok,
        previousError: previousObservation.error,
      },
      error: {
        code: "duplicate_tool_call_skipped",
        message:
          "Duplicate read-only tool call skipped because the previous matching call failed. Use the previous error or change the tool input before retrying.",
      },
    };
  }

  return {
    toolCallId: toolCall.id,
    toolName: toolCall.toolName,
    ok: true,
    output: {
      skipped: true,
      reason:
        "Duplicate read-only tool call skipped. Use the previous matching tool observation already present in the conversation.",
      previousToolCallId: previousObservation.toolCallId,
      previousOk: previousObservation.ok,
      previousError: previousObservation.error,
    },
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForStableStringify(value));
}

function sortForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForStableStringify);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortForStableStringify(child)])
  );
}

function formatAbortReason(reason: unknown): string {
  if (typeof reason === "string" && reason.trim()) {
    return `Agent loop aborted: ${reason}`;
  }
  return "Agent loop aborted.";
}

function toolCallEvent(
  options: { taskId: string; turn: number },
  toolCall: GatewayToolCall,
): AgentLoopEvent {
  return {
    type: "tool_call",
    taskId: options.taskId,
    turn: options.turn,
    toolCallId: toolCall.id,
    toolName: toolCall.toolName,
    reason: toolCall.reason,
  };
}

function toolObservationEvent(
  options: { taskId: string; turn: number },
  observation: ToolObservation,
): AgentLoopEvent {
  return {
    type: "tool_observation",
    taskId: options.taskId,
    turn: options.turn,
    toolCallId: observation.toolCallId,
    toolName: observation.toolName,
    ok: observation.ok,
    observation,
  };
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
