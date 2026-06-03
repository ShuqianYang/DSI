import type { AgentMessage, PromptSection, ToolDefinition, ToolObservation } from "./types.js";

export interface PromptManagerInput {
  query: string;
  tools: ToolDefinition[];
  contextSections: PromptSection[];
  memorySections: PromptSection[];
  skillSections: PromptSection[];
  observations: ToolObservation[];
}

export interface PromptManager {
  buildMessages(input: PromptManagerInput): AgentMessage[];
}

export const defaultPromptManager: PromptManager = {
  buildMessages(input) {
    const toolList = input.tools
      .map((tool) => `- ${tool.name}: ${tool.description}`)
      .join("\n");
    const extraSections = [
      ...input.contextSections,
      ...input.memorySections,
      ...input.skillSections,
    ]
      .map((section) => `## ${section.id}\n${section.content}`)
      .join("\n\n");

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

    const messages: AgentMessage[] = [
      { role: "system", content: system },
      { role: "user", content: input.query },
    ];

    return messages;
  },
};
