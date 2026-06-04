import type {
  AgentLoopPrefetch,
  AgentLoopToolUseContext,
  AgentMessage,
  PromptSection,
} from "./types.js";

export interface SkillManager {
  /**
   * Return lightweight skill listing sections visible near the prompt/tool listing.
   * Do not inline full skill bodies here; expose names/descriptions/usage hints so
   * the model can choose a Skill-style tool later.
   *
   * Return format: PromptSection[] rendered every turn as skillSections.
   */
  getSkillListingSections(toolUseContext: AgentLoopToolUseContext): Promise<PromptSection[]>;

  /**
   * Start per-iteration skill discovery prefetch. `input` is null for the normal
   * tool-loop path, matching Claude Code's call shape; implementations can inspect
   * `messages` to find write pivots, touched files, or task intent.
   *
   * Return format:
   * - `undefined`: no discovery should run for this iteration.
   * - `AgentLoopPrefetch`: resolve `promise` to PromptSection[] consumed after tools.
   */
  startSkillDiscoveryPrefetch(
    input: string | null,
    messages: readonly AgentMessage[],
    toolUseContext: AgentLoopToolUseContext
  ): AgentLoopPrefetch | undefined;

  /**
   * Consume the discovery prefetch and convert results into prompt sections or
   * attachment-like sections for the next model turn.
   *
   * Return format: PromptSection[] appended to future skillSections.
   */
  collectSkillDiscoveryPrefetch(prefetch: AgentLoopPrefetch): Promise<PromptSection[]>;

  /**
   * Optional file-operation hook: discover nested skill directories near touched files.
   * Intended to be called by Read/Write/Edit-style tools after they know file paths.
   *
   * Return format: absolute or workspace-relative skill directory paths, as chosen
   * by the concrete implementation.
   */
  discoverSkillDirsForPaths?(filePaths: string[], cwd: string): Promise<string[]>;

  /**
   * Optional file-operation hook: activate conditional skills whose path globs match
   * touched files, making them available in later listing/discovery calls.
   *
   * Return format: names/ids of skills newly activated by this call.
   */
  activateConditionalSkillsForPaths?(filePaths: string[], cwd: string): string[];
}

export const noopSkillManager: SkillManager = {
  async getSkillListingSections() {
    return [];
  },
  startSkillDiscoveryPrefetch() {
    return undefined;
  },
  async collectSkillDiscoveryPrefetch(prefetch) {
    return prefetch.promise;
  },
};
