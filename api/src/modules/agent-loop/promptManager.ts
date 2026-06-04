import type { AgentMessage, PromptSection, ToolDefinition, ToolObservation } from "./types.js";

export interface PromptManagerInput {
  /** Original user request for this agent run. */
  query: string;
  /** Tool list currently visible to the model. */
  tools: ToolDefinition[];
  /** User-scoped context loaded by ContextProvider. */
  userContext: Record<string, string>;
  /** System/workspace context loaded by ContextProvider. */
  systemContext: Record<string, string>;
  /** Project/task/domain context loaded by ContextProvider. */
  contextSections: PromptSection[];
  /** Memory sections collected/consumed by the loop so far. */
  memorySections: PromptSection[];
  /** Skill listing and discovery sections collected/consumed by the loop so far. */
  skillSections: PromptSection[];
  /** Tool observations accumulated so far; implementations may summarize/render them. */
  observations: ToolObservation[];
}

export interface PromptManager {
  /**
   * Render the final model messages from prompt materials.
   *
   * Return format:
   * - AgentMessage[] in provider-ready order.
   * - The default implementation returns one system message and one user message.
   * - Context/memory/skill retrieval should happen before this call.
   * - Window compaction should happen after this call in ContextWindowManager.
   */
  buildMessages(input: PromptManagerInput): AgentMessage[];
}

export const defaultPromptManager: PromptManager = {
  buildMessages(input) {
    const toolList = input.tools
      .map((tool) => `- ${tool.name}: ${tool.description}`)
      .join("\n");
    const extraSections = [
      ...recordToPromptSections("user_context", input.userContext),
      ...recordToPromptSections("system_context", input.systemContext),
      ...input.contextSections,
      ...input.memorySections,
      ...input.skillSections,
    ]
      .map((section) => `## ${section.id}\n${section.content}`)
      .join("\n\n");

// *****************************************************************************************************************************************************************************
// ********************* need to change ****************************************************************************************************************************************
    const system = [
      "You are a minimal tool-using agent.",
      "Use the provided tool calling interface when external information or workspace actions are needed.",
      "Do not invent tool names or tool parameters. If a tool fails, use the observation to decide whether to retry, choose another tool, or answer with the limitation.",
      "When you have enough information, answer the user directly in natural language.",
      "",
      "Available tools:",
      toolList || "(none)",
      extraSections ? `\nAdditional context:\n${extraSections}` : "",
    ].join("\n");
// *****************************************************************************************************************************************************************************
// *****************************************************************************************************************************************************************************

    const messages: AgentMessage[] = [
      { role: "system", content: system },
      { role: "user", content: input.query },
    ];

    return messages;
  },
};

function recordToPromptSections(prefix: string, record: Record<string, string>): PromptSection[] {
  return Object.entries(record).map(([key, content]) => ({
    id: `${prefix}.${key}`,
    content,
  }));
}
