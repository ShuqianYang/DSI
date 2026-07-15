import { notifyTaskUpdate } from "../../sse/sseManager.js";
import type { ScenarioId } from "@datasourceintelligence/shared";
import {
  createAgentLoopFileLogger,
  type AgentLoopFileLogger,
  withAgentLoopLogFilePath,
} from "./fileLogger.js";
import { defaultContextProvider, type ContextProvider } from "./contextProvider.js";
import {
  defaultContextWindowManager,
  type ContextWindowManager,
} from "./contextWindowManager.js";
import { noopMemoryManager, type MemoryManager } from "./memoryManager.js";
import { createModelClient, type ModelClient } from "./modelClient.js";
import { defaultPromptManager, type PromptManager } from "./promptManager.js";
import { buildPromptVersionMetadata } from "./promptVersioning.js";
import { buildMemoryRecallDecisionSection } from "./memoryRecallDecision.js";
import { buildMemoryGovernanceSection } from "./memoryGovernance.js";
import { resolveQueryReferences } from "./referenceResolver.js";
import { estimateMessagesTokens } from "./tokenEstimator.js";
import type { MidTaskCheckpointWriter } from "./midTaskCheckpoint.js";
import {
  safeJsonStringify,
  sanitizeForJson,
  stableStringify,
} from "./tools/_shared/serialization.js";
import {
  defaultSkillManager,
  registerSkillTool,
  type SkillManager,
} from "./skillManager.js";
import { callTool } from "./tools/_shared/toolGateway.js";
import { buildDefaultToolRegistry, type ToolRegistry } from "./tools/_shared/toolRegistry.js";
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
  ToolPermissionHandler,
  ToolObservation,
} from "./tools/_shared/types.js";

const MAX_MODEL_TOOL_RESULT_CHARS = 50_000;
const MODEL_TOOL_RESULT_PREVIEW_CHARS = 2_000;
const DEFAULT_MAX_CONCURRENT_TOOL_CALLS = 5;
const MIN_ASSISTANT_ANSWER_CANDIDATE_CHARS = 280;
const MAX_CLOSING_ONLY_FINAL_ANSWER_CHARS = 160;
const ANSWER_CANDIDATE_COMPATIBLE_TOOL_NAMES = new Set(["TodoWrite"]);
let taskStepDependenciesPromise: ReturnType<typeof loadTaskStepDependencies> | undefined;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface RunAgentLoopOptions {
  taskId: string;
  query: string;
  scenarioId?: ScenarioId;
  forcedSkillId?: "border-defense-qa" | "border-defense-daily-report";
  maxTurns?: number;
  registry?: ToolRegistry;
  modelClient?: ModelClient;
  promptManager?: PromptManager;
  contextProvider?: ContextProvider;
  contextWindowManager?: ContextWindowManager;
  memoryManager?: MemoryManager;
  skillManager?: SkillManager;
  transcriptStore?: AgentTranscriptStore;
  maxConcurrentToolCalls?: number;
  permissionHandler?: ToolPermissionHandler;
  signal?: AbortSignal;
  fileLogger?: AgentLoopFileLogger | false;
  onEvent?: (event: AgentLoopEvent) => void;
  onToolProgress?: (event: Extract<AgentLoopEvent, { type: "tool_progress" }>) => void;
  turnDelayMs?: number;
  midTaskCheckpointWriter?: MidTaskCheckpointWriter;
  /** 前序任务上下文摘要，用于指代消解。由 pipeline 层传入。 */
  recentTaskContext?: string;
}

export function hasCompletedForcedDailyReport(
  forcedSkillId: RunAgentLoopOptions["forcedSkillId"],
  observations: ToolObservation[]
): boolean {
  return getCompletedForcedDailyReportContent(forcedSkillId, observations) !== undefined;
}

export function getCompletedForcedDailyReportContent(
  forcedSkillId: RunAgentLoopOptions["forcedSkillId"],
  observations: ToolObservation[]
): string | undefined {
  if (forcedSkillId !== "border-defense-daily-report") return undefined;

  for (let index = observations.length - 1; index >= 0; index -= 1) {
    const observation = observations[index];
    if (observation.toolName !== "DailyReport" || !observation.ok) continue;
    const output = observation.output;
    if (!output || typeof output !== "object" || Array.isArray(output)) continue;
    const reportContent = (output as Record<string, unknown>).report_content;
    if (typeof reportContent === "string" && reportContent.trim()) return reportContent;
  }

  return undefined;
}

export async function runAgentLoop(options: RunAgentLoopOptions): Promise<AgentLoopResult> {
  let finalResult: AgentLoopResult | undefined;
  const publishEvent = (event: AgentLoopEvent) => {
    publishAgentLoopEvent(event);
    options.onEvent?.(event);
  };
  const eventOptions: RunAgentLoopOptions = {
    ...options,
    onEvent: publishEvent,
    onToolProgress: (event) => {
      publishEvent(event);
      options.onToolProgress?.(event);
    },
  };

  for await (const event of runAgentLoopEvents(eventOptions)) {
    publishEvent(event);
    if (event.type === "loop_stop") {
      finalResult = event.result;
    }
  }

  if (!finalResult) {
    throw new Error("Agent loop ended without a loop_stop event");
  }

  return finalResult;
}

async function resolveRunFileLogger(
  options: RunAgentLoopOptions
): Promise<AgentLoopFileLogger | undefined> {
  if (options.fileLogger === false) return undefined;
  if (options.fileLogger) return options.fileLogger;

  try {
    const fileLogger = await createAgentLoopFileLogger({
      taskId: options.taskId,
      query: options.query,
    });
    console.log(`[AgentLoop] log file: ${fileLogger.filePath}`);
    return fileLogger;
  } catch (error) {
    console.warn(
      `[AgentLoop] file logging disabled for task ${options.taskId}:`,
      error instanceof Error ? error.message : String(error)
    );
    return undefined;
  }
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
  const skillManager = options.skillManager ?? defaultSkillManager;
  registerSkillTool(registry, skillManager);
  const transcriptStore = options.transcriptStore ?? disabledTranscriptStore;
  const maxConcurrentToolCalls =
    options.maxConcurrentToolCalls ?? DEFAULT_MAX_CONCURRENT_TOOL_CALLS;
  const fileLogger = await resolveRunFileLogger(options);
  const emitEvent = (event: AgentLoopEvent): AgentLoopEvent => {
    fileLogger?.logEvent(event);
    return event;
  };
  const finishAndReturn = async (result: AgentLoopResult): Promise<AgentLoopResult> => {
    const resultWithLogFilePath = withAgentLoopLogFilePath(result, fileLogger);
    await fileLogger?.finish(resultWithLogFilePath);
    return resultWithLogFilePath;
  };
  const failAndRethrow = async (error: unknown): Promise<never> => {
    await fileLogger?.fail(error);
    throw error;
  };

  // ---- 上下文指代消解：在召回前将"上一轮说的XX"替换为实际指代 ----
  if (options.recentTaskContext) {
    try {
      const { resolvedQuery, wasResolved } = await resolveQueryReferences({
        query: options.query,
        recentTaskContext: options.recentTaskContext,
      });
      if (wasResolved) {
        options.query = resolvedQuery;
      }
    } catch (error) {
      // 消解失败时降级使用原始 query，不影响主流程
      console.warn(
        "[AgentLoop] Reference resolution failed, using original query:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  const observations: ToolObservation[] = [];
  const conversationMessages: AgentMessage[] = [];
  const initialMessages: AgentMessage[] = [{ role: "user", content: options.query }];
  const usedToolSignatures = new Map<string, ToolObservation>();
  let latestAssistantAnswerCandidate: string | undefined;
  let toolUseContext = createAgentLoopToolUseContext({
    taskId: options.taskId,
    query: options.query,
    scenarioId: options.scenarioId,
    messages: initialMessages,
    observations,
    tools: registry.list(),
    skillManager,
    signal: options.signal,
  });
  if (options.forcedSkillId) {
    const forcedSkillCall: GatewayToolCall = {
      id: `forced-skill-${options.taskId}`,
      toolName: "Skill",
      displayName: "业务能力路由",
      input: { skill: options.forcedSkillId, args: options.query },
      reason: `该边防业务入口固定使用 ${options.forcedSkillId}`,
    };
    yield emitEvent(toolCallEvent({ taskId: options.taskId, turn: 0 }, forcedSkillCall));
    const forcedSkillResult = await callTool(registry, forcedSkillCall, {
      taskId: options.taskId,
      query: options.query,
      observations,
      signal: options.signal,
      permissionHandler: options.permissionHandler,
      toolUseContext,
    });
    const forcedSkillObservation: ToolObservation = { ...forcedSkillResult, turn: 0 };
    observations.push(forcedSkillObservation);
    yield emitEvent(toolObservationEvent({ taskId: options.taskId, turn: 0 }, forcedSkillObservation));
    if (!forcedSkillObservation.ok) {
      throw new Error(forcedSkillObservation.error?.message || `Failed to load forced skill: ${options.forcedSkillId}`);
    }
    // The dedicated border-defense routes must stay inside their selected
    // business skill. Generic /tasks callers never set forcedSkillId and keep
    // the original model-selected Skill behavior.
    toolUseContext.skillAllowedToolNames?.delete("Skill");
    toolUseContext.options.tools = filterToolsForActiveSkill(
      toolUseContext.options.refreshTools?.() ?? registry.list(),
      toolUseContext.skillAllowedToolNames,
    );
  }
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
  let pendingSkillPrefetch: AgentLoopPrefetch | undefined;
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
  const recordMemoryRecall = async (turn: number, sections: PromptSection[]) => {
    const event = buildMemoryRecallEvent(options.taskId, turn, sections);
    if (!event) return undefined;
    await appendTranscript({
      turn,
      kind: "memory_recall",
      memoryRecall: {
        source: event.source,
        recalledCount: event.recalledCount,
        snippets: event.snippets,
      },
    });
    return event;
  };

  try {
    for (let turn = 1; turn <= maxTurns; turn += 1) {
      clearExpiredSkillToolRestriction(toolUseContext, turn);

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
        const resultWithLogFilePath = withAgentLoopLogFilePath(result, fileLogger);
        yield emitEvent({
          type: "loop_stop",
          taskId: options.taskId,
          turn,
          result: resultWithLogFilePath,
        });
        return await finishAndReturn(result);
      }

      if (pendingSkillPrefetch) {
        const skillPrefetch = pendingSkillPrefetch;
        pendingSkillPrefetch = undefined;
        try {
          const nextSkillSections = await skillManager.collectSkillDiscoveryPrefetch(skillPrefetch);
          if (nextSkillSections.length > 0) {
            skillDiscoverySections = [...skillDiscoverySections, ...nextSkillSections];
          }
        } finally {
          skillPrefetch.dispose?.();
        }
      }

      yield emitEvent({
        type: "agent_turn",
        taskId: options.taskId,
        turn,
        maxTurns,
        message: `Agent loop turn ${turn}/${maxTurns}`,
      });

      if (options.turnDelayMs && options.turnDelayMs > 0) {
        await sleep(options.turnDelayMs);
      }

      const callId = `call-${turn}`;
      const skillSections = [...skillListingSections, ...skillDiscoverySections];
      const runtimeSections = buildRuntimeToolStateSections(toolUseContext);
      const prePromptMemorySections = await consumeMemoryPrefetchIfReady({
        prefetch: memoryPrefetch,
        turn,
        memoryManager,
        toolUseContext,
      });
      if (prePromptMemorySections.length > 0) {
        memorySections = [...memorySections, ...prePromptMemorySections];
        const memoryRecallEvent = await recordMemoryRecall(turn, prePromptMemorySections);
        if (memoryRecallEvent) {
          yield emitEvent(memoryRecallEvent);
        }
      }
      const memoryRecallDecisionSection = buildMemoryRecallDecisionSection({
        query: options.query,
        memorySections,
      });
      const memoryDiagnosticsSection = buildMemoryDiagnosticsSection(memoryManager);
      const memoryGovernanceSection = buildMemoryGovernanceSection();
      const promptMemorySections = [
        ...memorySections,
        ...(memoryRecallDecisionSection ? [memoryRecallDecisionSection] : []),
        ...(memoryDiagnosticsSection ? [memoryDiagnosticsSection] : []),
        memoryGovernanceSection,
      ];
      const promptInput = {
        query: options.query,
        tools: activeTools,
        userContext,
        systemContext,
        contextSections,
        runtimeSections,
        memorySections: promptMemorySections,
        skillSections,
        observations,
      };
      const rawMessages = promptManager.buildMessages(promptInput).concat(conversationMessages);
      const prepared = await contextWindowManager.prepareMessages({
        messages: rawMessages,
        toolUseContext,
      });
      const messages = prepared.messages;
      const promptMetadata = buildPromptVersionMetadata({
        promptVersionMetadata: promptManager.getVersionMetadata?.(),
        tools: activeTools,
        contextSections,
        runtimeSections,
        memorySections: promptInput.memorySections,
        skillSections,
        rawMessages,
        preparedMessages: messages,
      });

      await appendTranscript({
        turn,
        kind: "model_request",
        messages,
        metadata: {
          prompt: promptMetadata,
        },
      });
      yield emitEvent({
        type: "model_request",
        taskId: options.taskId,
        turn,
        messages,
      });

      let decision;
      try {
        decision = await modelClient.decide({
          messages,
          tools: activeTools,
          query: options.query,
          observations,
          callId,
          signal: options.signal,
          onRetry: ({ nextAttempt, maxAttempts, error }) => {
            const retryEvent = emitEvent({
              type: "agent_turn",
              taskId: options.taskId,
              turn,
              maxTurns,
              message: `模型调用失败（${error.message}），正在进行第 ${nextAttempt}/${maxAttempts} 次尝试`,
            });
            options.onEvent?.(retryEvent);
          },
        });
      } catch (error) {
        const aborted = options.signal?.aborted === true;
        const stoppedBy = aborted ? "aborted" : "model_error";
        const finalAnswer = aborted
          ? formatAbortReason(options.signal?.reason)
          : error instanceof Error ? error.message : String(error);
        const result: AgentLoopResult = {
          finalAnswer,
          turns: turn,
          observations,
          stoppedBy,
        };
        await appendTranscript({
          turn,
          kind: "loop_stop",
          stoppedBy,
          finalAnswer,
          error: finalAnswer,
        });
        const resultWithLogFilePath = withAgentLoopLogFilePath(result, fileLogger);
        yield emitEvent({
          type: "loop_stop",
          taskId: options.taskId,
          turn,
          result: resultWithLogFilePath,
        });
        return await finishAndReturn(result);
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
        yield emitEvent({
          type: "assistant_message",
          taskId: options.taskId,
          turn,
          message: assistantMessage,
        });
        const finalAnswer = selectFinalAnswer(decision.content, latestAssistantAnswerCandidate);
        const result: AgentLoopResult = {
          finalAnswer,
          turns: turn,
          observations,
          stoppedBy: "final_answer",
        };
        await appendTranscript({
          turn,
          kind: "loop_stop",
          stoppedBy: "final_answer",
          finalAnswer,
        });
        if (memoryManager.remember) {
          await memoryManager.remember({
            query: options.query,
            finalAnswer,
            result,
            messages: [...initialMessages, ...conversationMessages],
            observations,
            toolUseContext,
          });
        }
        const resultWithLogFilePath = withAgentLoopLogFilePath(result, fileLogger);
        yield emitEvent({
          type: "loop_stop",
          taskId: options.taskId,
          turn,
          result: resultWithLogFilePath,
        });
        return await finishAndReturn(result);
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
        const resultWithLogFilePath = withAgentLoopLogFilePath(result, fileLogger);
        yield emitEvent({
          type: "loop_stop",
          taskId: options.taskId,
          turn,
          result: resultWithLogFilePath,
        });
        return await finishAndReturn(result);
      }

      const toolCallsWithDisplayName = decision.toolCalls.map((toolCall) => ({
        ...toolCall,
        displayName: registry.get(toolCall.toolName)?.displayName,
      }));

      yield emitEvent({
        type: "tool_calls",
        taskId: options.taskId,
        turn,
        count: toolCallsWithDisplayName.length,
        tools: toolCallsWithDisplayName.map((toolCall) => toolCall.toolName),
      });

      const assistantMessage: AgentMessage = {
        role: "assistant",
        content: decision.content ?? "",
        toolCalls: toolCallsWithDisplayName,
      };
      conversationMessages.push(assistantMessage);
      latestAssistantAnswerCandidate =
        getAssistantAnswerCandidate(assistantMessage) ?? latestAssistantAnswerCandidate;
      await appendTranscript({
        turn,
        kind: "assistant_message",
        message: assistantMessage,
      });
      yield emitEvent({
        type: "assistant_message",
        taskId: options.taskId,
        turn,
        message: assistantMessage,
      });

      const obsCountBeforeBatches = observations.length;
      const batches = partitionToolCalls(registry, toolCallsWithDisplayName, maxConcurrentToolCalls);
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
          permissionHandler: options.permissionHandler,
          onToolProgress: (event) => {
            fileLogger?.logEvent(event);
            options.onToolProgress?.(event);
          },
          fileLogger,
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
          yield emitEvent({
            type: "tool_message",
            taskId: options.taskId,
            turn,
            message: toolMessage,
          });
        }
      }

      const dailyReportContent = getCompletedForcedDailyReportContent(
        options.forcedSkillId,
        observations
      );
      if (dailyReportContent !== undefined) {
        // DailyReport already returns the complete report body and chart data.
        // Return that body directly instead of spending another model turn on
        // a redundant summary or completion message.
        const finalAnswer = dailyReportContent;
        const result: AgentLoopResult = {
          finalAnswer,
          turns: turn,
          observations,
          stoppedBy: "final_answer",
        };
        await appendTranscript({
          turn,
          kind: "loop_stop",
          stoppedBy: "final_answer",
          finalAnswer,
        });
        const resultWithLogFilePath = withAgentLoopLogFilePath(result, fileLogger);
        yield emitEvent({
          type: "loop_stop",
          taskId: options.taskId,
          turn,
          result: resultWithLogFilePath,
        });
        return await finishAndReturn(result);
      }

      const nextMemorySections = await consumeMemoryPrefetchIfReady({
        prefetch: memoryPrefetch,
        turn,
        memoryManager,
        toolUseContext,
      });
      if (nextMemorySections.length > 0) {
        memorySections = [...memorySections, ...nextMemorySections];
        const memoryRecallEvent = await recordMemoryRecall(turn, nextMemorySections);
        if (memoryRecallEvent) {
          yield emitEvent(memoryRecallEvent);
        }
      }

      // --- Mid-task checkpoint (Part C: 超长任务中途提取) ---
      if (options.midTaskCheckpointWriter) {
        const cpw = options.midTaskCheckpointWriter;
        const tokenEstimate = estimateMessagesTokens([
          ...initialMessages, ...conversationMessages,
        ]);
        cpw.trigger.updateTokenEstimate(tokenEstimate.totalTokens);
        cpw.trigger.recordToolCalls(observations.length - obsCountBeforeBatches);

        if (cpw.trigger.shouldTrigger({
          currentTurn: turn,
          isNaturalBreakpoint: true,
        })) {
          cpw
            .writeCheckpoint({
              taskId: options.taskId,
              userId: cpw.userId,
              query: options.query,
              messages: [...initialMessages, ...conversationMessages],
              observations,
              turn,
            })
            .catch(() => {
              // best-effort: silently ignore errors
            });
        }
      }

      const postToolMessages = [...initialMessages, ...conversationMessages];
      pendingSkillPrefetch = skillManager.startSkillDiscoveryPrefetch(
        null,
        postToolMessages,
        { ...toolUseContext, messages: postToolMessages }
      );
    }
  } catch (error) {
    return await failAndRethrow(error);
  } finally {
    memoryPrefetch?.dispose?.();
    pendingSkillPrefetch?.dispose?.();
  }

  const finalAnswer = await buildMaxTurnsAnswer({
    modelClient,
    query: options.query,
    observations,
    conversationMessages,
    callId: "max-turns-summary",
    signal: options.signal,
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
  if (memoryManager.remember) {
    await memoryManager.remember({
      query: options.query,
      finalAnswer,
      result,
      messages: [...initialMessages, ...conversationMessages],
      observations,
      toolUseContext,
    });
  }
  const resultWithLogFilePath = withAgentLoopLogFilePath(result, fileLogger);
  yield emitEvent({
    type: "loop_stop",
    taskId: options.taskId,
    turn: maxTurns,
    result: resultWithLogFilePath,
  });
  return await finishAndReturn(result);
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
  const content = safeJsonStringify(observation);
  if (content.length <= MAX_MODEL_TOOL_RESULT_CHARS) {
    return content;
  }

  return safeJsonStringify({
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
  scenarioId?: ScenarioId;
  messages: AgentMessage[];
  observations: ToolObservation[];
  tools: ReturnType<ToolRegistry["list"]>;
  skillManager: SkillManager;
  signal?: AbortSignal;
}): AgentLoopToolUseContext {
  return {
    taskId: input.taskId,
    query: input.query,
    scenarioId: input.scenarioId,
    messages: input.messages,
    observations: input.observations,
    options: {
      tools: input.tools,
    },
    signal: input.signal,
    readFileState: new Map(),
    todoState: [],
    nestedMemoryAttachmentTriggers: new Set(),
    dynamicSkillDirTriggers: new Set(),
    discoveredSkillNames: new Set(),
    invokedSkillSections: [],
    skillManager: input.skillManager,
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
  const toolSource = context.skillAllowedToolNames
    ? context.options.refreshTools?.() ?? input.tools
    : input.tools;
  const refreshedTools = filterToolsForActiveSkill(
    toolSource,
    context.skillAllowedToolNames,
  );
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

function buildRuntimeToolStateSections(toolUseContext: AgentLoopToolUseContext): PromptSection[] {
  const sections: PromptSection[] = [];

  if (toolUseContext.todoState.length > 0) {
    sections.push({
      id: "tool_state.todos",
      content: toolUseContext.todoState
        .map((todo) => `- [${todo.status}] ${todo.content} (${todo.activeForm})`)
        .join("\n"),
    });
  }

  if (toolUseContext.planModeState?.enabled) {
    sections.push({
      id: "tool_state.plan_mode",
      content: [
        `enabled: ${toolUseContext.planModeState.enabled}`,
        `updatedAt: ${toolUseContext.planModeState.updatedAt}`,
        toolUseContext.planModeState.plan ? `plan:\n${toolUseContext.planModeState.plan}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  sections.push(...toolUseContext.invokedSkillSections);

  return sections;
}

function filterToolsForActiveSkill(
  tools: ReturnType<ToolRegistry["list"]>,
  allowedToolNames: Set<string> | undefined,
): ReturnType<ToolRegistry["list"]> {
  if (!allowedToolNames || allowedToolNames.size === 0) return tools;
  return tools.filter((tool) => allowedToolNames.has(tool.name) || tool.aliases?.some((alias) => allowedToolNames.has(alias)));
}

function buildMemoryDiagnosticsSection(memoryManager: MemoryManager): PromptSection | undefined {
  const diagnostics = memoryManager.getDiagnostics?.();
  if (!diagnostics) return undefined;
  return {
    id: "memory.diagnostics",
    content: JSON.stringify(diagnostics),
  };
}

function clearExpiredSkillToolRestriction(
  toolUseContext: AgentLoopToolUseContext,
  turn: number,
): void {
  if (
    toolUseContext.skillAllowedToolsExpiresOnTurn !== undefined &&
    toolUseContext.skillAllowedToolsExpiresOnTurn <= turn
  ) {
    toolUseContext.skillAllowedToolNames = undefined;
    toolUseContext.skillAllowedToolsExpiresOnTurn = undefined;
  }
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
    case "memory_recall":
    case "loop_stop":
      console.log(`[AgentLoop][SSE] ${formatAgentLoopEventForLog(event)}`);
      notifyTaskUpdate(event.taskId, event);
      break;
    case "model_request":
    case "tool_message":
      break;
  }
}

function formatAgentLoopEventForLog(event: AgentLoopEvent): string {
  const prefix = `[${event.taskId}] ${event.type}`;

  switch (event.type) {
    case "agent_turn":
      return `${prefix} turn=${event.turn}/${event.maxTurns}`;
    case "assistant_message": {
      const toolCalls = event.message.toolCalls || [];
      if (toolCalls.length > 0) {
        const tools = toolCalls.map((call) => call.toolName || call.id).join(", ");
        return `${prefix} toolCalls=[${tools}]`;
      }
      return `${prefix} content="${previewLog(event.message.content)}"`;
    }
    case "tool_calls":
      return `${prefix} count=${event.count} tools=[${event.tools.join(", ")}]`;
    case "tool_batch":
      return `${prefix} mode=${event.mode} tools=[${event.tools.join(", ")}]`;
    case "tool_call":
      return `${prefix} tool=${event.toolName} id=${event.toolCallId}`;
    case "tool_progress": {
      const stage = event.stage ? ` stage=${event.stage}` : "";
      const percent = typeof event.percent === "number" ? ` ${event.percent}%` : "";
      return `${prefix} tool=${event.toolName}${stage}${percent} ${previewLog(String(event.message || ""))}`;
    }
    case "tool_observation":
      return `${prefix} tool=${event.toolName} ok=${event.ok}`;
    case "loop_stop": {
      const result = event.result;
      return `${prefix} stoppedBy=${result.stoppedBy} turns=${result.turns} final="${previewLog(result.finalAnswer)}"`;
    }
    case "memory_recall":
      return `${prefix} source=${event.source} recalled=${event.recalledCount}`;
    default:
      return prefix;
  }
}

function previewLog(text: string, max = 120): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

function determineMemorySource(sections: PromptSection[]): "session" | "vector" | "hybrid" {
  const hasSession = sections.some((s) => s.id.startsWith("memory.session_summary."));
  const hasVector = sections.some((s) => s.id.startsWith("memory.vector."));
  if (hasSession && hasVector) return "hybrid";
  if (hasVector) return "vector";
  return "session";
}

function parseMemorySnippet(
  section: PromptSection
): { query: string; summary?: string; finalResult?: string; score?: number; source?: string } | undefined {
  const metadata = section.metadata?.memoryRecall;
  if (metadata && typeof metadata.query === "string") {
    return {
      query: metadata.query,
      ...(typeof metadata.summary === "string" ? { summary: metadata.summary } : {}),
      ...(typeof metadata.finalResult === "string" ? { finalResult: metadata.finalResult } : {}),
      ...(typeof metadata.score === "number" ? { score: metadata.score } : {}),
      ...(typeof metadata.source === "string" ? { source: metadata.source } : {}),
    };
  }
  try {
    const parsed = JSON.parse(section.content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;

    if (section.id.startsWith("memory.session_summary.")) {
      const summaryObj =
        parsed.summary && typeof parsed.summary === "object" && !Array.isArray(parsed.summary)
          ? parsed.summary
          : {};
      return {
        query: String(parsed.query ?? ""),
        summary:
          typeof summaryObj.summary === "string"
            ? summaryObj.summary
            : typeof summaryObj.lastAssistantAnswerPreview === "string"
              ? summaryObj.lastAssistantAnswerPreview
              : undefined,
        finalResult:
          typeof summaryObj.finalResult === "string"
            ? summaryObj.finalResult
            : typeof summaryObj.finalAnswerPreview === "string"
              ? summaryObj.finalAnswerPreview
              : typeof summaryObj.lastAssistantAnswerPreview === "string"
                ? summaryObj.lastAssistantAnswerPreview
                : undefined,
        source: "session",
      };
    }

    if (section.id.startsWith("memory.vector.")) {
      return {
        query: String(parsed.query ?? ""),
        summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
        finalResult: typeof parsed.finalResult === "string" ? parsed.finalResult : undefined,
        score:
          typeof parsed.hybridScore === "number"
            ? parsed.hybridScore
            : typeof parsed.similarity === "number"
              ? parsed.similarity
              : undefined,
        source: typeof parsed.source === "string" ? parsed.source : undefined,
      };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function buildMemoryRecallEvent(
  taskId: string,
  turn: number,
  sections: PromptSection[]
): Extract<AgentLoopEvent, { type: "memory_recall" }> | undefined {
  const recalledSections = sections.filter((section) =>
    section.id.startsWith("memory.session_summary.") || section.id.startsWith("memory.vector.")
  );
  if (recalledSections.length === 0) return undefined;
  const snippets = recalledSections
    .map(parseMemorySnippet)
    .filter((s): s is NonNullable<typeof s> => !!s);
  return {
    type: "memory_recall",
    taskId,
    turn,
    source: determineMemorySource(recalledSections),
    recalledCount: recalledSections.length,
    snippets,
  };
}

type ToolCallBatch =
  | { type: "concurrent"; toolCalls: GatewayToolCall[] }
  | { type: "sequential"; toolCalls: [GatewayToolCall] };

function partitionToolCalls(
  registry: ToolRegistry,
  toolCalls: GatewayToolCall[],
  maxConcurrentToolCalls: number,
): ToolCallBatch[] {
  const batches: ToolCallBatch[] = [];
  let currentConcurrent: GatewayToolCall[] = [];
  const concurrentLimit =
    Number.isFinite(maxConcurrentToolCalls) && maxConcurrentToolCalls > 0
      ? Math.max(1, Math.floor(maxConcurrentToolCalls))
      : DEFAULT_MAX_CONCURRENT_TOOL_CALLS;

  for (const toolCall of toolCalls) {
    if (isConcurrencySafe(registry, toolCall)) {
      currentConcurrent.push(toolCall);
      if (currentConcurrent.length >= concurrentLimit) {
        batches.push({ type: "concurrent", toolCalls: currentConcurrent });
        currentConcurrent = [];
      }
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
  permissionHandler?: ToolPermissionHandler;
  onToolProgress?: (event: Extract<AgentLoopEvent, { type: "tool_progress" }>) => void;
  fileLogger?: AgentLoopFileLogger;
  toolUseContext: AgentLoopToolUseContext;
  usedToolSignatures: Map<string, ToolObservation>;
}): AsyncGenerator<AgentLoopEvent, ToolObservation[], void> {
  const emitBatchEvent = (event: AgentLoopEvent): AgentLoopEvent => {
    options.fileLogger?.logEvent(event);
    return event;
  };

  yield emitBatchEvent({
    type: "tool_batch",
    taskId: options.taskId,
    turn: options.turn,
    mode: options.concurrent ? "concurrent" : "sequential",
    tools: options.toolCalls.map((toolCall) => toolCall.toolName),
  });

  if (options.concurrent) {
    const executions: Array<Promise<{ observation: ToolObservation; signature?: string }>> = [];
    const inBatchExecutions = new Map<
      string,
      Promise<{ observation: ToolObservation; signature?: string }>
    >();

    for (const toolCall of options.toolCalls) {
      yield emitBatchEvent(toolCallEvent(options, toolCall));
      const signature = getReadOnlyToolSignature(options.registry, toolCall);
      const previousObservation = signature ? options.usedToolSignatures.get(signature) : undefined;
      if (signature && previousObservation) {
        executions.push(
          Promise.resolve({
            observation: createDuplicateToolObservation(toolCall, previousObservation, options.turn),
          })
        );
        continue;
      }

      const inBatchExecution = signature ? inBatchExecutions.get(signature) : undefined;
      if (signature && inBatchExecution) {
        executions.push(
          inBatchExecution.then((item) => ({
            observation: createDuplicateToolObservation(toolCall, item.observation, options.turn),
          }))
        );
        continue;
      }

      const execution = executeSingleToolCall({
          ...options,
          toolCall,
          order: options.allocateOrder(),
        }).then((observation) => ({ observation, signature }));
      executions.push(execution);
      if (signature) {
        inBatchExecutions.set(signature, execution);
      }
    }
    const completed = await Promise.all(executions);
    const observations = completed.map((item) => item.observation);
    for (const item of completed) {
      rememberToolSignature(options.usedToolSignatures, item.signature, item.observation);
    }
    for (const observation of observations) {
      yield emitBatchEvent(toolObservationEvent(options, observation));
    }
    return observations;
  }

  const observations: ToolObservation[] = [];
  for (const toolCall of options.toolCalls) {
    yield emitBatchEvent(toolCallEvent(options, toolCall));
    const signature = getReadOnlyToolSignature(options.registry, toolCall);
    const previousObservation = signature ? options.usedToolSignatures.get(signature) : undefined;
    if (signature && previousObservation) {
      const duplicateObservation = createDuplicateToolObservation(toolCall, previousObservation, options.turn);
      observations.push(duplicateObservation);
      yield emitBatchEvent(toolObservationEvent(options, duplicateObservation));
      continue;
    }
    const observation = await executeSingleToolCall({
      ...options,
      toolCall,
      order: options.allocateOrder(),
    });
    rememberToolSignature(options.usedToolSignatures, signature, observation);
    observations.push(observation);
    yield emitBatchEvent(toolObservationEvent(options, observation));
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
  permissionHandler?: ToolPermissionHandler;
  onToolProgress?: (event: Extract<AgentLoopEvent, { type: "tool_progress" }>) => void;
  toolUseContext: AgentLoopToolUseContext;
}): Promise<ToolObservation> {
  const stepId = await createToolStep(options.taskId, options.order, options.toolCall);
  await markToolStepRunning(stepId);

  const toolResult = await callTool(options.registry, options.toolCall, {
    taskId: options.taskId,
    query: options.query,
    observations: options.observationsSnapshot,
    signal: options.signal,
    permissionHandler: options.permissionHandler,
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
  const observation: ToolObservation = { ...toolResult, turn: options.turn };

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
  turn: number,
): ToolObservation {
  if (!previousObservation.ok) {
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.toolName,
      turn,
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
    turn,
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

function formatAbortReason(reason: unknown): string {
  if (typeof reason === "string" && reason.trim()) {
    return `Agent loop aborted: ${reason}`;
  }
  return "Agent loop aborted.";
}

function getAssistantAnswerCandidate(message: AgentMessage): string | undefined {
  const content = message.content.trim();
  if (content.length < MIN_ASSISTANT_ANSWER_CANDIDATE_CHARS) return undefined;
  if (!message.toolCalls?.length) return undefined;
  if (!message.toolCalls.every((toolCall) => ANSWER_CANDIDATE_COMPATIBLE_TOOL_NAMES.has(toolCall.toolName))) {
    return undefined;
  }
  return content;
}

function selectFinalAnswer(currentFinalAnswer: string, previousCandidate: string | undefined): string {
  const current = currentFinalAnswer.trim();
  if (!previousCandidate) return currentFinalAnswer;
  if (shouldPreferPreviousAnswerCandidate(current, previousCandidate)) return previousCandidate;
  return currentFinalAnswer;
}

function shouldPreferPreviousAnswerCandidate(current: string, previousCandidate: string): boolean {
  if (!current) return true;
  if (previousCandidate.length < MIN_ASSISTANT_ANSWER_CANDIDATE_CHARS) return false;
  if (current.length > MAX_CLOSING_ONLY_FINAL_ANSWER_CHARS) return false;
  if (current.length * 3 >= previousCandidate.length && !isClosingOnlyFinalAnswer(current)) return false;
  return isClosingOnlyFinalAnswer(current) || current.length < previousCandidate.length / 4;
}

function isClosingOnlyFinalAnswer(content: string): boolean {
  const compact = content.replace(/\s+/g, " ").trim();
  if (!compact) return false;
  if (/^#{1,6}\s|\|.+\||```/.test(compact)) return false;
  return /以上就是|完整的查询结果|如果您希望|可以告诉我|进一步了解|let me know|hope this helps/i.test(compact);
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
    displayName: toolCall.displayName,
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
    displayName: observation.displayName,
    ok: observation.ok,
    observation,
  };
}

async function createToolStep(
  taskId: string,
  order: number,
  toolCall: GatewayToolCall
): Promise<string> {
  const { db, taskSteps } = await getTaskStepDependencies();
  const [step] = await db
    .insert(taskSteps)
    .values({
      taskId,
      actionType: toolCall.toolName,
      actionConfig: {
        id: toolCall.id,
        type: toolCall.toolName,
        name: toolCall.displayName || toolCall.toolName,
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
  const { db, eq, taskSteps } = await getTaskStepDependencies();
  await db
    .update(taskSteps)
    .set({
      status: "running",
      startedAt: new Date(),
    })
    .where(eq(taskSteps.id, stepId));
}

async function markToolStepCompleted(stepId: string, observation: ToolObservation): Promise<void> {
  const { db, eq, taskSteps } = await getTaskStepDependencies();
  await db
    .update(taskSteps)
    .set({
      status: observation.ok ? "completed" : "failed",
      result: sanitizeForJson({ observation }),
      error: observation.error?.message,
      completedAt: new Date(),
    })
    .where(eq(taskSteps.id, stepId));
}

async function getTaskStepDependencies() {
  taskStepDependenciesPromise ??= loadTaskStepDependencies();
  return taskStepDependenciesPromise;
}

async function loadTaskStepDependencies() {
  const [{ db }, { taskSteps }, { eq }] = await Promise.all([
    import("../../config/database.js"),
    import("../../db/schema.js"),
    import("drizzle-orm"),
  ]);
  return { db, taskSteps, eq };
}

async function buildMaxTurnsAnswer(options: {
  modelClient: ModelClient;
  query: string;
  observations: ToolObservation[];
  conversationMessages: AgentMessage[];
  callId: string;
  signal?: AbortSignal;
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
            "For business/data QA, do not expose table names, column names, SQL aliases, SQL fragments, or encoded filter expressions unless the user explicitly asked for SQL or schema details. State results and limitations in natural business language.",
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
      signal: options.signal,
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
