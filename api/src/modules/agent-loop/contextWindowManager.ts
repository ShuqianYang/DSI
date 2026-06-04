import type {
  AgentLoopToolUseContext,
  AgentMessage,
  PreparedModelMessages,
} from "./types.js";

export interface PrepareMessagesInput {
  /** Fully rendered model messages before context-window governance. */
  messages: AgentMessage[];
  /** Current loop runtime context, including messages, tool state, and caches. */
  toolUseContext: AgentLoopToolUseContext;
}

export interface ContextWindowManager {
  /**
   * Prepare the exact messages for a model request on every loop iteration.
   * Implement token budget, tool-result budgeting, truncation, compaction,
   * and post-compact reinjection here.
   *
   * Return format:
   * - `messages`: required; this exact array is sent to ModelClient.
   * - `contextSections`: optional diagnostics/future data; runAgentLoop currently ignores it.
   */
  prepareMessages(input: PrepareMessagesInput): Promise<PreparedModelMessages>;
}

export const noopContextWindowManager: ContextWindowManager = {
  async prepareMessages(input) {
    return { messages: input.messages };
  },
};
