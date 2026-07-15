import type { ModelReasoningMode } from "../types.js";

export interface ThinkTagResult {
  content: string;
  reasoning?: string;
  source?: "think_tag" | "analysis_tag";
  warnings: string[];
}

export function extractReasoningTags(content: string, mode: ModelReasoningMode): ThinkTagResult {
  if (mode === "disabled" || mode === "structured-field" || !content) {
    return { content, warnings: [] };
  }

  const reasoningParts: string[] = [];
  let source: ThinkTagResult["source"];
  const stripped = content.replace(/<(think|analysis)>\s*([\s\S]*?)\s*<\/\1>/gi, (_match, tag: string, body: string) => {
    const trimmed = body.trim();
    if (trimmed) reasoningParts.push(trimmed);
    if (!source) source = tag.toLowerCase() === "analysis" ? "analysis_tag" : "think_tag";
    return "";
  }).trim();

  const warnings: string[] = [];
  if (/<(?:think|analysis)>/i.test(stripped)) {
    warnings.push("Unclosed reasoning tag was preserved in content");
  }

  return {
    content: reasoningParts.length > 0 ? stripped : content,
    reasoning: reasoningParts.length > 0 ? reasoningParts.join("\n\n") : undefined,
    source,
    warnings,
  };
}
