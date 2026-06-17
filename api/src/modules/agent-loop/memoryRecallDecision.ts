import { safeJsonStringify, truncateText } from "./tools/_shared/serialization.js";
import type { PromptSection } from "./tools/_shared/types.js";

export type MemoryRecallDecisionType = "answer_from_memory" | "use_tools" | "insufficient";
export type MemoryRecallFreshnessPolicy = "memory_ok" | "refresh_required" | "unknown";

export interface MemoryRecallDecision {
  source: "memory_recall_decision";
  decision: MemoryRecallDecisionType;
  confidence: number;
  freshnessPolicy: MemoryRecallFreshnessPolicy;
  coveredBy: string[];
  reason: string;
  instructions: string;
}

export interface BuildMemoryRecallDecisionInput {
  query: string;
  memorySections: PromptSection[];
}

interface ScoredMemorySection {
  section: PromptSection;
  taskId: string;
  score: number;
  overlapCount: number;
}

const MEMORY_RECALL_DECISION_SECTION_ID = "memory.recall_decision";
const SESSION_MEMORY_SECTION_PREFIX = "memory.session_summary.";
const MIN_ANSWER_SCORE = 0.28;
const MIN_ANSWER_OVERLAP = 2;
const MAX_CONTENT_CHARS_PER_SECTION = 8_000;

const FRESHNESS_REQUIRED_PATTERNS = [
  /最新/,
  /实时/,
  /当前/,
  /现在/,
  /目前/,
  /此刻/,
  /\blatest\b/i,
  /\bcurrent\b/i,
  /\bcurrently\b/i,
  /\brealtime\b/i,
  /\breal-time\b/i,
  /\bright now\b/i,
];

const DOMAIN_TERMS = [
  "天气",
  "北京",
  "上海",
  "台湾",
  "海峡",
  "台湾海峡",
  "飞机",
  "航班",
  "高度",
  "经纬度",
  "风",
  "降雨",
  "下雨",
  "地震",
  "灾害",
  "卫星",
  "船舶",
  "海事",
  "weather",
  "beijing",
  "taiwan",
  "strait",
  "aircraft",
  "flight",
  "rain",
  "wind",
  "earthquake",
  "disaster",
  "satellite",
  "maritime",
];

export function buildMemoryRecallDecisionSection(
  input: BuildMemoryRecallDecisionInput
): PromptSection | undefined {
  const sessionMemorySections = getSessionMemorySections(input.memorySections);
  if (sessionMemorySections.length === 0) return undefined;

  return {
    id: MEMORY_RECALL_DECISION_SECTION_ID,
    content: safeJsonStringify(
      buildMemoryRecallDecision({
        query: input.query,
        memorySections: sessionMemorySections,
      })
    ),
  };
}

export function buildMemoryRecallDecision(input: BuildMemoryRecallDecisionInput): MemoryRecallDecision {
  const sessionMemorySections = getSessionMemorySections(input.memorySections);
  if (sessionMemorySections.length === 0) {
    return {
      source: "memory_recall_decision",
      decision: "insufficient",
      confidence: 0,
      freshnessPolicy: "unknown",
      coveredBy: [],
      reason: "No session summary memory sections were recalled for this request.",
      instructions:
        "Do not answer from memory. Use tools or ask a clarification if the user request cannot be answered from current context.",
    };
  }

  const scored = scoreMemorySections(input.query, sessionMemorySections);
  const best = scored[0];
  const freshnessRequired = requiresFreshness(input.query);
  const coveredBy = best ? [best.taskId] : [];

  if (freshnessRequired) {
    return {
      source: "memory_recall_decision",
      decision: "use_tools",
      confidence: best ? clampConfidence(0.45 + best.score * 0.25) : 0.45,
      freshnessPolicy: "refresh_required",
      coveredBy,
      reason:
        "The user asked for current/latest/realtime information, so recalled memory may be stale and should be refreshed with tools.",
      instructions:
        "Use relevant memory only as background. Call tools to refresh volatile facts before answering.",
    };
  }

  if (best && best.score >= MIN_ANSWER_SCORE && best.overlapCount >= MIN_ANSWER_OVERLAP) {
    return {
      source: "memory_recall_decision",
      decision: "answer_from_memory",
      confidence: clampConfidence(0.55 + best.score * 0.4),
      freshnessPolicy: "memory_ok",
      coveredBy,
      reason:
        "A recalled session summary overlaps the user's follow-up enough to answer without refreshing data.",
      instructions:
        "Answer from memory first. Do not call tools unless the memory is incomplete, conflicting, or the user explicitly requests fresh/current data.",
    };
  }

  return {
    source: "memory_recall_decision",
    decision: "insufficient",
    confidence: best ? clampConfidence(best.score) : 0,
    freshnessPolicy: "unknown",
    coveredBy,
    reason:
      "Recalled memory exists, but it does not clearly cover the user's current question.",
    instructions:
      "Do not guess from weak memory. Use tools or ask a clarification if needed.",
  };
}

function getSessionMemorySections(sections: PromptSection[]): PromptSection[] {
  return sections.filter((section) => section.id.startsWith(SESSION_MEMORY_SECTION_PREFIX));
}

function scoreMemorySections(query: string, sections: PromptSection[]): ScoredMemorySection[] {
  const queryTerms = extractTerms(query);
  return sections
    .map((section) => {
      const memoryText = `${section.id}\n${truncateText(section.content, MAX_CONTENT_CHARS_PER_SECTION)}`;
      const memoryTerms = extractTerms(memoryText);
      const overlapCount = [...queryTerms].filter((term) => memoryTerms.has(term)).length;
      const score = queryTerms.size === 0 ? 0 : overlapCount / queryTerms.size;
      return {
        section,
        taskId: extractTaskId(section),
        score,
        overlapCount,
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return right.overlapCount - left.overlapCount;
    });
}

function extractTerms(value: string): Set<string> {
  const normalized = value.toLowerCase();
  const terms = new Set<string>();

  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9_-]{1,}/g)) {
    terms.add(match[0]);
  }

  for (const term of DOMAIN_TERMS) {
    if (normalized.includes(term.toLowerCase())) {
      terms.add(term.toLowerCase());
    }
  }

  for (const match of normalized.matchAll(/[\p{Script=Han}]{2,12}/gu)) {
    addCjkNgrams(terms, match[0]);
  }

  return terms;
}

function addCjkNgrams(terms: Set<string>, text: string): void {
  for (let size = 2; size <= 4; size += 1) {
    if (text.length < size) continue;
    for (let index = 0; index <= text.length - size; index += 1) {
      terms.add(text.slice(index, index + size));
    }
  }
}

function requiresFreshness(query: string): boolean {
  return FRESHNESS_REQUIRED_PATTERNS.some((pattern) => pattern.test(query));
}

function extractTaskId(section: PromptSection): string {
  try {
    const parsed = JSON.parse(section.content) as { taskId?: unknown };
    if (typeof parsed.taskId === "string" && parsed.taskId.trim()) return parsed.taskId;
  } catch {
    // Fall back to the section id suffix below.
  }
  return section.id.slice(SESSION_MEMORY_SECTION_PREFIX.length) || section.id;
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(0.95, Number(value.toFixed(2))));
}
