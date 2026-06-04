import type {
  AgentLoopToolUseContext,
  PromptSection,
  ToolDefinition,
} from "./types.js";

export interface ContextProviderInput {
  /** Current task/run id. Use it to load task-scoped context or correlate diagnostics. */
  taskId: string;
  /** Original user request for this agent run. Stable across all loop turns. */
  query: string;
  /** Tool list visible to the model when context is loaded. */
  tools: ToolDefinition[];
  /** Loop runtime context, mirroring Claude Code's ToolUseContext shape. */
  toolUseContext: AgentLoopToolUseContext;
  /** Run-level cancellation signal. Long context fetches should stop when aborted. */
  signal?: AbortSignal;
}

export interface ContextProvider {
  /**
   * Load user-scoped context, similar to Claude Code's getUserContext().
   * Examples: AGENTS.md/CLAUDE.md content, current date, explicit user settings.
   *
   * Return format:
   * - Record keys should be stable, human-readable ids such as "projectInstructions".
   * - Record values must be plain model-visible text, already safe to inject.
   */
  getUserContext(input: ContextProviderInput): Promise<Record<string, string>>;

  /**
   * Load system/workspace context, similar to Claude Code's getSystemContext().
   * Examples: git status, workspace metadata, task status, cache breakers.
   *
   * Return format:
   * - Record keys should be stable, human-readable ids such as "gitStatus".
   * - Record values must be plain model-visible text, already safe to inject.
   */
  getSystemContext(input: ContextProviderInput): Promise<Record<string, string>>;

  /**
   * Load additional structured context sections.
   * Use this for project/task/domain context that does not fit the key/value maps.
   *
   * Return format:
   * - PromptSection[] only; do not include memory or skills here.
   * - PromptManager decides final ordering with memory/skill/tool materials.
   */
  getContextSections(input: ContextProviderInput): Promise<PromptSection[]>;
}

export const noopContextProvider: ContextProvider = {
  async getUserContext() {
    return {};
  },
  async getSystemContext() {
    return {};
  },
  async getContextSections() {
    return [];
  },
};
