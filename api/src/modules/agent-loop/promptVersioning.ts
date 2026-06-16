import { createHash } from "node:crypto";
import {
  metadataValue,
  type PromptManagerVersionMetadata,
} from "./promptManager.js";
import { stableStringify, truncateText } from "./tools/_shared/serialization.js";
import type { AgentMessage, PromptSection, ToolDefinition } from "./tools/_shared/types.js";

const HASH_LENGTH = 16;
const MAX_SECTION_CONTENT_PREVIEW_CHARS = 240;
const MAX_TOOL_DESCRIPTION_PREVIEW_CHARS = 240;
const UNKNOWN_PROMPT_VERSION = "custom-prompt-manager/unknown";

// Bounded audit fingerprints keep transcript metadata compact. They are not
// complete content fingerprints; add separate full-content hashes only if a
// future workflow needs strong uniqueness.

export interface PromptVersionMetadata {
  promptVersion: string;
  componentVersions: Record<string, string>;
  toolCatalog: {
    count: number;
    names: string[];
    hash: string;
  };
  contextSections: PromptSectionSummary;
  runtimeSections: PromptSectionSummary;
  memorySections: PromptSectionSummary;
  skillSections: PromptSectionSummary;
  messages: {
    rawCount: number;
    preparedCount: number;
    rawHash: string;
    preparedHash: string;
  };
}

export interface PromptSectionSummary {
  count: number;
  ids: string[];
  hash: string;
}

export interface BuildPromptVersionMetadataInput {
  promptVersionMetadata?: PromptManagerVersionMetadata;
  tools: ToolDefinition[];
  contextSections: PromptSection[];
  runtimeSections: PromptSection[];
  memorySections: PromptSection[];
  skillSections: PromptSection[];
  rawMessages: AgentMessage[];
  preparedMessages: AgentMessage[];
}

export function buildPromptVersionMetadata(
  input: BuildPromptVersionMetadataInput
): PromptVersionMetadata {
  const prompt = input.promptVersionMetadata ?? {
    promptVersion: UNKNOWN_PROMPT_VERSION,
    componentVersions: {},
  };

  return {
    promptVersion: prompt.promptVersion,
    componentVersions: { ...prompt.componentVersions },
    toolCatalog: summarizeToolCatalog(input.tools),
    contextSections: summarizePromptSections(input.contextSections),
    runtimeSections: summarizePromptSections(input.runtimeSections),
    memorySections: summarizePromptSections(input.memorySections),
    skillSections: summarizePromptSections(input.skillSections),
    messages: {
      rawCount: input.rawMessages.length,
      preparedCount: input.preparedMessages.length,
      rawHash: hashStableJson(input.rawMessages.map(summarizeMessage)),
      preparedHash: hashStableJson(input.preparedMessages.map(summarizeMessage)),
    },
  };
}

export function hashStableJson(value: unknown): string {
  const hash = createHash("sha256")
    .update(stableStringify(value))
    .digest("hex")
    .slice(0, HASH_LENGTH);
  return `sha256:${hash}`;
}

function summarizeToolCatalog(tools: ToolDefinition[]): PromptVersionMetadata["toolCatalog"] {
  const summary = tools.map((tool) => {
    const description = typeof tool.description === "string" ? tool.description : "";
    return {
      name: tool.name,
      descriptionPreview: previewText(description, MAX_TOOL_DESCRIPTION_PREVIEW_CHARS),
      descriptionLength: description.length,
      kind: metadataValue(tool.kind),
      aliases: tool.aliases ?? [],
      readOnly: metadataValue(tool.isReadOnly),
      destructive: metadataValue(tool.isDestructive),
      concurrencySafe: metadataValue(tool.isConcurrencySafe),
      riskLevel: metadataValue(tool.riskLevel),
      requiresUserInteraction: metadataValue(tool.requiresUserInteraction),
      maxResultSizeChars: metadataValue(tool.maxResultSizeChars),
    };
  });

  return {
    count: tools.length,
    names: tools.map((tool) => tool.name),
    hash: hashStableJson(summary),
  };
}

function summarizePromptSections(sections: PromptSection[]): PromptSectionSummary {
  const summary = sections.map((section) => {
    const content = typeof section.content === "string" ? section.content : "";
    return {
      id: section.id,
      contentPreview: previewText(content, MAX_SECTION_CONTENT_PREVIEW_CHARS),
      contentLength: content.length,
    };
  });

  return {
    count: sections.length,
    ids: sections.map((section) => section.id),
    hash: hashStableJson(summary),
  };
}

function summarizeMessage(message: AgentMessage): unknown {
  const content = typeof message.content === "string" ? message.content : "";
  return {
    role: message.role,
    contentPreview: previewText(content, 360),
    contentLength: content.length,
    toolCalls: message.toolCalls?.map((toolCall) => ({
      id: toolCall.id,
      toolName: toolCall.toolName,
    })),
    toolCallId: message.toolCallId,
    toolName: message.toolName,
  };
}

export function previewText(value: unknown, maxChars: number): string {
  return truncateText(value, maxChars);
}
