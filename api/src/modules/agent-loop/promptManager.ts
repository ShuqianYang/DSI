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

type ToolMetadataValue = string | number | boolean | "dynamic";

const BASE_SYSTEM_PROMPT = [
  "# Agent Role",
  "You are a software engineering agent running inside this project's agent loop.",
  "You help with code, project analysis, tool-assisted investigation, and implementation planning.",
  "",
  "# Operating Rules",
  "- Follow the user's request and the project instructions provided in context.",
  "- Answer in the user's language unless the user asks for a different language.",
  "- Be concise, but include enough technical detail for the user to act.",
  "- When discussing code, reference relevant files or symbols when they are known.",
  "- Do not invent files, tool outputs, commands, APIs, or project facts.",
  "- Do not expose full private chain-of-thought. Briefly state intent or progress when useful, then use tools or answer.",
  "",
  "# Tool Use Rules",
  "- Use tools when workspace state, file contents, command output, or external facts are needed.",
  "- Use only the available tool names and valid arguments.",
  "- If a tool fails, use the observation to decide whether to retry, choose another tool, or explain the limitation.",
  "- When existing observations are enough to answer, stop calling tools and provide the final answer.",
  "- Do not keep calling tools merely to be more exhaustive. Avoid repeating the same tool call with the same inputs.",
  "- Work through the tool protocol instead of writing visible ReAct labels.",
  "- Avoid unnecessary destructive or permission-sensitive actions.",
  "- Treat tool observations as authoritative for the current run.",
  "- For complex multi-step work, use TodoWrite to maintain a concise task checklist. Keep exactly one item in_progress while actively working.",
  "- Do not use TodoWrite for trivial one-step questions.",
  "",
  "# GIS Tool Routing Rules",
  "When the user asks to mark, focus, circle, display, or analyze a named geographic region:",
  "1. Call RegionResolve first.",
  "2. If resolved=true, call RegionMark with selected.bbox before downstream data tools.",
  "3. If downstream weather, aircraft, or maritime data is requested, reuse the same bbox.",
  "4. If resolved=false, do not guess. Ask for bbox/polygon or say the region GeoJSON is missing.",
  "",
  "# Context Priority",
  "Use context in this priority order: explicit user request, project instructions, system/workspace context, project/domain context, runtime state, memory, then skill listings.",
  "If two context sections conflict, prefer the more specific and more recent section, and mention important uncertainty to the user.",
].join("\n");

export const defaultPromptManager: PromptManager = {
  buildMessages(input) {
    const toolCatalog = renderToolCatalog(input.tools);
    const sections = [
      ...recordToPromptSections("user_context", input.userContext),
      ...recordToPromptSections("system_context", input.systemContext),
      ...input.contextSections,
      ...input.runtimeSections,
      ...input.memorySections,
      ...input.skillSections,
    ];
    const additionalContext = renderPromptSections(sections);

    const system = [
      BASE_SYSTEM_PROMPT,
      "",
      "# Available Tools",
      toolCatalog,
      additionalContext ? ["", "# Additional Context", additionalContext].join("\n") : "",
    ].filter(Boolean).join("\n");

    return [
      { role: "system", content: system },
      { role: "user", content: input.query },
    ];
  },
};

function metadataValue(value: unknown): ToolMetadataValue | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "function") return "dynamic";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function renderMetadataLine(label: string, value: ToolMetadataValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  return `${label}: ${value}`;
}

function renderToolCatalog(tools: ToolDefinition[]): string {
  if (tools.length === 0) return "(none)";

  return tools
    .map((tool) => {
      const lines = [
        `## ${tool.name}`,
        `description: ${tool.description}`,
        renderMetadataLine("kind", metadataValue(tool.kind)),
        renderMetadataLine("aliases", tool.aliases?.length ? tool.aliases.join(", ") : undefined),
        renderMetadataLine("readOnly", metadataValue(tool.isReadOnly)),
        renderMetadataLine("destructive", metadataValue(tool.isDestructive)),
        renderMetadataLine("concurrencySafe", metadataValue(tool.isConcurrencySafe)),
        renderMetadataLine("riskLevel", metadataValue(tool.riskLevel)),
        renderMetadataLine("requiresUserInteraction", metadataValue(tool.requiresUserInteraction)),
        renderMetadataLine("maxResultSizeChars", metadataValue(tool.maxResultSizeChars)),
      ].filter((line): line is string => Boolean(line));
      return lines.join("\n");
    })
    .join("\n\n");
}

function renderPromptSections(sections: PromptSection[]): string {
  return sections
    .map((section) => `## ${section.id}\n${section.content}`)
    .join("\n\n");
}

function recordToPromptSections(prefix: string, record: Record<string, string>): PromptSection[] {
  return Object.entries(record)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, content]) => ({
      id: `${prefix}.${key}`,
      content,
    }));
}
