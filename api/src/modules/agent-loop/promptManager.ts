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
  /** Runtime state maintained by tool calls during this loop, such as TodoWrite. */
  runtimeSections: PromptSection[];
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
      ...input.runtimeSections,
      ...input.memorySections,
      ...input.skillSections,
    ]
      .map((section) => `## ${section.id}\n${section.content}`)
      .join("\n\n");

    const system = [
      "You are a tool-using agent. Work through the tool protocol instead of writing visible ReAct labels.",
      "Use tools when external information, workspace inspection, web lookup, or workspace actions are needed.",
      "Do not invent tool names or tool parameters. Use only the available tool schemas.",
      "After each tool result, decide whether the observation is sufficient, whether a different tool is needed, or whether you should answer with the limitation.",
      "When existing observations are enough to answer, stop calling tools and provide the final answer.",
      "Do not keep calling tools merely to be more exhaustive. Avoid repeating the same tool call with the same inputs.",
      "For complex multi-step work, use TodoWrite to maintain a concise task checklist. Keep exactly one item in_progress while actively working.",
      "Do not use TodoWrite for trivial one-step questions.",
      "Do not expose full private chain-of-thought. Briefly state intent or progress when useful, then use tools or answer.",
      "",
      "Available tools:",
      toolList || "(none)",
      extraSections ? `\nAdditional context:\n${extraSections}` : "",
    ].join("\n");

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
