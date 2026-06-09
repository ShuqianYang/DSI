import type {
  AgentLoopPrefetch,
  AgentLoopResult,
  AgentLoopToolUseContext,
  AgentMessage,
  PromptSection,
  ToolObservation,
} from "./tools/_shared/types.js";

export interface RememberInput {
  /** Original user request for this agent run. */
  query: string;
  /** Final natural-language answer produced by the loop. */
  finalAnswer: string;
  /** Full loop result, including terminal reason and turn count. */
  result: AgentLoopResult;
  /** Conversation messages available at run completion. */
  messages: AgentMessage[];
  /** Tool observations accumulated during the run. */
  observations: ToolObservation[];
  /** Runtime context with caches/state needed to decide what is already surfaced. */
  toolUseContext: AgentLoopToolUseContext;
}

export interface MemoryManager {
  /**
   * Start relevant-memory retrieval once for the user turn, matching Claude Code's
   * startRelevantMemoryPrefetch(messages, toolUseContext). Implementations should
   * extract the last real user message from `messages`, then run recall asynchronously.
   * The main loop consumes the handle only after tools finish and only when settled.
   *
   * Return format:
   * - `undefined`: no memory lookup should run.
   * - `AgentLoopPrefetch`: resolve `promise` to PromptSection[]; set `settledAt`
   *   when the promise settles; keep `consumedOnIteration` at -1 initially.
   */
  startRelevantMemoryPrefetch(
    messages: readonly AgentMessage[],
    toolUseContext: AgentLoopToolUseContext
  ): AgentLoopPrefetch | undefined;

  /**
   * Remove memory sections already present in context or seen through tool reads.
   * Use `toolUseContext.readFileState` or your equivalent cache to dedupe.
   *
   * Return format: PromptSection[] that is safe to append to future memorySections.
   */
  filterDuplicateMemorySections?(
    sections: PromptSection[],
    toolUseContext: AgentLoopToolUseContext
  ): PromptSection[];

  /**
   * Post-run/session-memory hook. Use this for session summaries, durable memories,
   * user preferences, or project experience updates after the model finishes.
   *
   * Return format: no model-visible return value; persist side effects only.
   */
  remember?(input: RememberInput): Promise<void>;
}

export const noopMemoryManager: MemoryManager = {
  startRelevantMemoryPrefetch() {
    return undefined;
  },
};
