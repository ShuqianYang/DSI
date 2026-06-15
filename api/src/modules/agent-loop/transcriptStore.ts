import type { AgentMessage, AgentLoopResult, PromptSection } from "./tools/_shared/types.js";
import { asc, eq } from "drizzle-orm";
import { agentTranscriptEntries } from "../../db/schema.js";
import { safeJsonStringify, sanitizeForJson } from "./tools/_shared/serialization.js";

const TRANSCRIPT_CONTEXT_SECTION_ID = "transcript.resume_context";
const MAX_TRANSCRIPT_CONTEXT_CHARS = 4_000;
const MAX_TRANSCRIPT_PREVIEW_CHARS = 360;
const MAX_RECENT_TOOL_SUMMARY_ITEMS = 5;
const FALLBACK_TRANSCRIPT_PREVIEW_CHARS = 160;

export type AgentTranscriptEntryKind =
  | "model_request"
  | "assistant_message"
  | "tool_message"
  | "loop_stop";

export interface AgentTranscriptEntry {
  taskId: string;
  turn: number;
  sequence: number;
  kind: AgentTranscriptEntryKind;
  message?: AgentMessage;
  messages?: AgentMessage[];
  finalAnswer?: string;
  error?: string;
  stoppedBy?: AgentLoopResult["stoppedBy"];
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}

export interface AgentTranscriptStore {
  append(entry: AgentTranscriptEntry): Promise<void>;
  load(taskId: string): Promise<AgentTranscriptEntry[]>;
}

export const disabledTranscriptStore: AgentTranscriptStore = {
  async append() {
    return;
  },
  async load() {
    return [];
  },
};

type AgentTranscriptEntryRow = typeof agentTranscriptEntries.$inferSelect;
type NewAgentTranscriptEntryRow = typeof agentTranscriptEntries.$inferInsert;

type TranscriptDatabase = {
  insert(table: typeof agentTranscriptEntries): {
    values(row: NewAgentTranscriptEntryRow): unknown;
  };
  select(): {
    from(table: typeof agentTranscriptEntries): {
      where(condition: unknown): {
        orderBy(...columns: unknown[]): unknown;
      };
    };
  };
};

export function createDbTranscriptStore(database: TranscriptDatabase): AgentTranscriptStore {
  return {
    async append(entry) {
      await database.insert(agentTranscriptEntries).values({
        taskId: entry.taskId,
        turn: entry.turn,
        sequence: entry.sequence,
        kind: entry.kind,
        message: toJsonbValue(entry.message),
        messages: toJsonbValue(entry.messages),
        finalAnswer: entry.finalAnswer,
        error: entry.error,
        stoppedBy: entry.stoppedBy,
        metadata: toJsonbValue(entry.metadata ?? {}),
        createdAt: entry.createdAt,
      });
    },
    async load(taskId) {
      const rows = (await database
        .select()
        .from(agentTranscriptEntries)
        .where(eq(agentTranscriptEntries.taskId, taskId))
        .orderBy(
          asc(agentTranscriptEntries.sequence),
          asc(agentTranscriptEntries.createdAt)
        )) as AgentTranscriptEntryRow[];

      return rows.map(rowToTranscriptEntry);
    },
  };
}

export function createBestEffortTranscriptStore(
  store: AgentTranscriptStore,
  logger: Pick<Console, "warn"> = console
): AgentTranscriptStore {
  return {
    async append(entry) {
      try {
        await store.append(entry);
      } catch (error) {
        logger.warn(
          "[AgentTranscript] append failed:",
          error instanceof Error ? error.message : String(error)
        );
      }
    },
    load(taskId) {
      return store.load(taskId);
    },
  };
}

export function entriesToConversationMessages(entries: AgentTranscriptEntry[]): AgentMessage[] {
  return [...entries]
    .sort(compareTranscriptEntries)
    .filter((entry) => entry.kind === "assistant_message" || entry.kind === "tool_message")
    .map((entry) => entry.message)
    .filter((message): message is AgentMessage => isReplayableConversationMessage(message));
}

export function summarizeTranscriptForContext(
  entries: AgentTranscriptEntry[]
): PromptSection | undefined {
  if (entries.length === 0) return undefined;

  const orderedEntries = [...entries].sort(compareTranscriptEntries);
  const taskId = orderedEntries[0]?.taskId;
  const loopStop = findLast(orderedEntries, (entry) => entry.kind === "loop_stop");
  const lastAssistantMessage = findLast(
    orderedEntries,
    (entry) => entry.kind === "assistant_message" && isReplayableConversationMessage(entry.message)
  )?.message;
  const recentTools = orderedEntries
    .filter((entry) => entry.kind === "tool_message" && isReplayableConversationMessage(entry.message))
    .slice(-MAX_RECENT_TOOL_SUMMARY_ITEMS)
    .map((entry) => summarizeToolMessage(entry.message));

  return {
    id: TRANSCRIPT_CONTEXT_SECTION_ID,
    content: stringifyTranscriptSummary({
      taskId,
      totalEntries: orderedEntries.length,
      stoppedBy: loopStop?.stoppedBy ?? null,
      error: previewText(loopStop?.error),
      finalAnswerPreview: previewText(loopStop?.finalAnswer),
      lastAssistantAnswerPreview: previewText(lastAssistantMessage?.content),
      recentTools,
    }),
  };
}

function toJsonbValue(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(safeJsonStringify(sanitizeForJson(value))) as unknown;
}

function rowToTranscriptEntry(row: AgentTranscriptEntryRow): AgentTranscriptEntry {
  return {
    taskId: row.taskId,
    turn: row.turn,
    sequence: row.sequence,
    kind: row.kind,
    ...(isAgentMessage(row.message) ? { message: row.message } : {}),
    ...(isAgentMessageArray(row.messages) ? { messages: row.messages } : {}),
    ...(row.finalAnswer ? { finalAnswer: row.finalAnswer } : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(isStoppedBy(row.stoppedBy) ? { stoppedBy: row.stoppedBy } : {}),
    ...(isRecord(row.metadata) ? { metadata: row.metadata } : {}),
    createdAt: row.createdAt,
  };
}

function isAgentMessage(value: unknown): value is AgentMessage {
  const record = isRecord(value) ? value : undefined;
  return Boolean(record && typeof record.role === "string");
}

function isReplayableConversationMessage(value: unknown): value is AgentMessage {
  if (!isAgentMessage(value)) return false;
  return value.role === "assistant" || value.role === "tool";
}

function isAgentMessageArray(value: unknown): value is AgentMessage[] {
  return Array.isArray(value) && value.every(isAgentMessage);
}

function isStoppedBy(value: unknown): value is AgentLoopResult["stoppedBy"] {
  return (
    value === "final_answer" ||
    value === "max_turns" ||
    value === "model_error" ||
    value === "aborted"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareTranscriptEntries(left: AgentTranscriptEntry, right: AgentTranscriptEntry): number {
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  const leftTime = left.createdAt?.getTime() ?? 0;
  const rightTime = right.createdAt?.getTime() ?? 0;
  return leftTime - rightTime;
}

function findLast<T>(items: T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return items[index];
  }
  return undefined;
}

function summarizeToolMessage(message: AgentMessage | undefined): {
  toolName: string | null;
  toolCallId: string | null;
  ok: boolean | null;
  error: string | null;
} {
  const parsedObservation = parseToolObservationContent(message?.content);
  const error = parsedObservation?.error;
  return {
    toolName: message?.toolName ?? parsedObservation?.toolName ?? null,
    toolCallId: message?.toolCallId ?? parsedObservation?.toolCallId ?? null,
    ok: typeof parsedObservation?.ok === "boolean" ? parsedObservation.ok : null,
    error: previewText(error?.message),
  };
}

function parseToolObservationContent(content: string | undefined): {
  toolCallId?: string;
  toolName?: string;
  ok?: boolean;
  error?: { message?: string };
} | undefined {
  if (!content) return undefined;
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) return undefined;
    const error = isRecord(parsed.error) ? parsed.error : undefined;
    return {
      ...(typeof parsed.toolCallId === "string" ? { toolCallId: parsed.toolCallId } : {}),
      ...(typeof parsed.toolName === "string" ? { toolName: parsed.toolName } : {}),
      ...(typeof parsed.ok === "boolean" ? { ok: parsed.ok } : {}),
      ...(error ? { error: { message: typeof error.message === "string" ? error.message : undefined } } : {}),
    };
  } catch {
    return undefined;
  }
}

function previewText(value: string | undefined): string | null {
  if (!value) return null;
  return truncateText(value.replace(/\s+/g, " ").trim(), MAX_TRANSCRIPT_PREVIEW_CHARS);
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function stringifyTranscriptSummary(summary: {
  taskId: string | undefined;
  totalEntries: number;
  stoppedBy: AgentLoopResult["stoppedBy"] | null;
  error: string | null;
  finalAnswerPreview: string | null;
  lastAssistantAnswerPreview: string | null;
  recentTools: Array<{
    toolName: string | null;
    toolCallId: string | null;
    ok: boolean | null;
    error: string | null;
  }>;
}): string {
  const serialized = JSON.stringify(summary, null, 2);
  if (serialized.length < MAX_TRANSCRIPT_CONTEXT_CHARS) return serialized;

  const fallback = JSON.stringify(
    {
      ...summary,
      error: summary.error ? truncateText(summary.error, FALLBACK_TRANSCRIPT_PREVIEW_CHARS) : null,
      finalAnswerPreview: summary.finalAnswerPreview
        ? truncateText(summary.finalAnswerPreview, FALLBACK_TRANSCRIPT_PREVIEW_CHARS)
        : null,
      lastAssistantAnswerPreview: summary.lastAssistantAnswerPreview
        ? truncateText(summary.lastAssistantAnswerPreview, FALLBACK_TRANSCRIPT_PREVIEW_CHARS)
        : null,
      recentTools: summary.recentTools.slice(-2).map((tool) => ({
        ...tool,
        error: tool.error ? truncateText(tool.error, FALLBACK_TRANSCRIPT_PREVIEW_CHARS) : null,
      })),
      truncated: true,
    },
    null,
    2
  );
  if (fallback.length < MAX_TRANSCRIPT_CONTEXT_CHARS) return fallback;

  return JSON.stringify(
    {
      taskId: summary.taskId,
      totalEntries: summary.totalEntries,
      stoppedBy: summary.stoppedBy,
      error: summary.error ? truncateText(summary.error, 80) : null,
      finalAnswerPreview: summary.finalAnswerPreview
        ? truncateText(summary.finalAnswerPreview, 80)
        : null,
      lastAssistantAnswerPreview: summary.lastAssistantAnswerPreview
        ? truncateText(summary.lastAssistantAnswerPreview, 80)
        : null,
      recentTools: [],
      truncated: true,
    },
    null,
    2
  );
}
