import type { AgentMessage, PromptSection, ToolDefinition, ToolObservation } from "./tools/_shared/types.js";

export interface PromptManagerVersionMetadata {
  promptVersion: string;
  componentVersions: Record<string, string>;
}

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
  getVersionMetadata?(): PromptManagerVersionMetadata;
}

export type ToolMetadataValue = string | number | boolean | "dynamic";

export const DEFAULT_PROMPT_VERSION = "agent-loop-prompt-v1";

// When editing a corresponding prompt rule below, bump its component version too;
// otherwise transcript metadata will misrepresent which prompt behavior ran.
export const DEFAULT_PROMPT_COMPONENT_VERSIONS = {
  baseSystem: "base-system-v1",
  toolUseRules: "tool-use-rules-v1",
  gisRoutingRules: "gis-routing-rules-v2",
  disasterSatelliteRules: "disaster-satellite-rules-v1",
  dailyReportRoutingRules: "daily-report-routing-rules-v1",
  databaseTimezoneRule: "database-timezone-rule-v1",
  memoryRecallRules: "memory-recall-rules-v1",
  contextPriorityRules: "context-priority-rules-v1",
  toolCatalogRenderer: "tool-catalog-renderer-v1",
  promptSectionRenderer: "prompt-section-renderer-v1",
} as const;

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
  "- When you have enough observations, output the complete answer in a single final_answer. Do not split the answer across multiple turns.",
  "- Do not put the complete final answer in the same assistant message as tool calls. Tool-call assistant messages should contain only brief progress text.",
  "- If you need to mark todos complete before finishing, call TodoWrite first, then in the next turn output the full final_answer.",
  "- Do not send a closing-only final answer such as '以上就是完整的查询结果' after a complete draft. Restate the complete answer instead.",
  "",
  "# GIS Tool Routing Rules",
  "When the user asks to mark, focus, circle, display, or analyze a named geographic region:",
  "1. Call RegionResolve first.",
  "2. If resolved=true, call RegionMark with selected.geometryRef. Pass selected.bbox as fallback only.",
  "3. If downstream weather, aircraft, maritime, or disaster data is requested, reuse selected.bbox exactly.",
  "4. If resolved=false, do not guess. Ask for bbox/polygon or say the region is not available.",
  "5. Never invent a bbox for a named region after RegionResolve fails.",
  "",
  "# Disaster Satellite Query Rules",
  "When the user asks about disasters, earthquakes, floods, typhoons, fires, satellite imagery, remote-sensing imagery, or disaster assessment for a named region:",
  "1. Call RegionResolve first and reuse selected.bbox exactly for DisasterQuery and SatelliteImageSearch.",
  "2. If resolved=true and map display or region context is useful, call RegionMark with selected.geometryRef. Pass selected.bbox as fallback only.",
  "3. Call DisasterQuery for event facts. If no events are returned, say so and do not fabricate incidents, damage, casualties, or source links.",
  "4. Call SatelliteImageSearch when the user asks for satellite imagery, remote-sensing evidence, or post-disaster assessment; use the same bbox and an explicit date range.",
  "5. Call ImageAnalysis when satellite image URLs are available and the user asks for assessment, interpretation, or damage evaluation. Pass the image URLs from SatelliteImageSearch results (prefer thumbnail URLs).",
  "6. If RegionResolve resolved=false, do not guess a bbox; ask for bbox/polygon or say the region is not available.",
  "",
  "# DailyReport Routing Rules",
  "DailyReport is reserved for explicit daily report requests only.",
  "1. Use DailyReport ONLY when the user explicitly asks for a daily report, such as '生成日报', '日报', 'daily report', '今日/昨日/前日边防日报', or '汇总报告'.",
  "2. When the user asks about specific alarm events, warnings, alerts, or incident details for a date (for example: '4月24日有报警事件吗', '今天有什么告警', '查询某一天的报警'), do NOT use DailyReport. Instead, use MysqlQuery to query the border-defense alarm_event table directly.",
  "3. If both a daily report summary and detailed alarm records might answer the question, prefer MysqlQuery unless the user clearly asked for a summary report.",
  "",
  "# Database Timezone Rule",
  "The column border-defense.alarm_event.event_time is already stored in Beijing Time (Asia/Shanghai, UTC+8).",
  "1. When querying alarm_event by date, use the user's date directly without any UTC conversion.",
  "2. For example, if the user asks about '2026-04-25', query: event_time >= '2026-04-25 00:00:00' AND event_time < '2026-04-26 00:00:00'.",
  "3. Do NOT subtract or add 8 hours, and do NOT use ranges like '2026-04-24 16:00:00 to 2026-04-25 16:00:00'.",
  "",
  "# Memory Recall Decision Rules",
  "If a memory.recall_decision section is present, follow it strictly:",
  "- decision=answer_from_memory means recalled memory likely covers the user's follow-up. Answer directly from the recalled memory. Strictly avoid calling tools unless the memory is incomplete, conflicting, or the user explicitly asks for fresh/current data.",
  "- decision=use_tools means memory may help as background, but volatile facts should be refreshed with tools before answering.",
  "- decision=insufficient means do not guess from weak memory. Use tools or ask a clarification if needed.",
  "",
  "# Context Priority",
  "Use context in this priority order: explicit user request, project instructions, system/workspace context, project/domain context, runtime state, memory, then skill listings.",
  "If two context sections conflict, prefer the more specific and more recent section, and mention important uncertainty to the user.",
].join("\n");

export const defaultPromptManager: PromptManager = {
  getVersionMetadata() {
    return {
      promptVersion: DEFAULT_PROMPT_VERSION,
      componentVersions: { ...DEFAULT_PROMPT_COMPONENT_VERSIONS },
    };
  },

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

export function metadataValue(value: unknown): ToolMetadataValue | undefined {
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
