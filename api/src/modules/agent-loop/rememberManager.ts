/**
 * RememberManager - Post-run persistence hook (P0-1, P0-2, P0-3).
 *
 * Executed after the agent loop produces a final answer (or hits max_turns).
 * Persists:
 *   P0-2: Pre-computed transcript summary entry (loop_stop with summary)
 *   P0-3: Conversation snapshot row in task_conversation_snapshot (O(1) recall)
 *   P1-4: Episodic memory extraction (optional, when embeddingClient + episodeExtractor available)
 *
 * All operations are best-effort: errors are logged but never thrown.
 */

import type { RememberInput } from "./memoryManager.js";
import type { AgentTranscriptStore, AgentTranscriptEntry } from "./transcriptStore.js";
import { summarizeTranscriptForContext } from "./transcriptStore.js";
import { taskConversationSnapshot, episodicMemories } from "../../db/schema.js";
import type { NewTaskConversationSnapshot, NewEpisodicMemory } from "../../db/schema.js";
import type { EmbeddingClient } from "./embeddingClient.js";
import type { EpisodeExtractor } from "./episodeExtractor.js";
import type { AgentMessage, ToolObservation } from "./tools/_shared/types.js";
import { safeJsonStringify, sanitizeForJson, truncateText } from "./tools/_shared/serialization.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Structural type matching the drizzle insert surface we need. */
export interface RememberManagerDatabase {
  insert(table: typeof taskConversationSnapshot): {
    values(row: NewTaskConversationSnapshot): unknown;
  };
  insert(table: typeof episodicMemories): {
    values(row: NewEpisodicMemory): unknown;
  };
}

export interface CreateRememberManagerInput {
  db: RememberManagerDatabase;
  currentTaskId: string;
  currentUserId: string | null;
  transcriptStore: AgentTranscriptStore;
  embeddingClient?: EmbeddingClient;
  episodeExtractor?: EpisodeExtractor;
  logger?: Pick<Console, "warn" | "log">;
}

export interface RememberManager {
  remember(input: RememberInput): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRememberManager(input: CreateRememberManagerInput): RememberManager {
  const logger = input.logger ?? console;
  const { db, currentTaskId, currentUserId, transcriptStore } = input;

  return {
    async remember(rememberInput: RememberInput): Promise<void> {
      // Skip entirely when there is no userId — snapshot and episode tables
      // require NOT NULL userId, and the session-summary manager also skips.
      if (!currentUserId) {
        logger.log("[RememberManager] skipped: no userId");
        return;
      }

      // ---- Step 1: Compute pre-computed summary from transcript ----
      let summary: string | undefined;
      let nextSequence = 1;
      try {
        const entries = await transcriptStore.load(currentTaskId);
        nextSequence =
          entries.length > 0
            ? Math.max(...entries.map((e) => e.sequence)) + 1
            : 1;
        const summarySection = summarizeTranscriptForContext(entries);
        summary = summarySection?.content;
      } catch (error) {
        logger.warn(
          "[RememberManager] summary computation failed:",
          error instanceof Error ? error.message : String(error)
        );
      }

      // ---- Step 2: Write transcript entry with pre-computed summary (P0-2) ----
      try {
        const entry: AgentTranscriptEntry = {
          taskId: currentTaskId,
          turn: rememberInput.result.turns,
          sequence: nextSequence,
          kind: "loop_stop",
          stoppedBy: rememberInput.result.stoppedBy,
          finalAnswer: rememberInput.finalAnswer,
          metadata: {
            preComputedSummary: true,
            ...(summary ? { summary } : {}),
          },
          createdAt: new Date(),
        };
        await transcriptStore.append(entry);
      } catch (error) {
        logger.warn(
          "[RememberManager] transcript summary entry write failed:",
          error instanceof Error ? error.message : String(error)
        );
      }

      // ---- Step 3: Write conversation snapshot (P0-3) ----
      try {
        const toolSummary = extractToolSummary(
          rememberInput.observations,
          rememberInput.messages
        );
        await db.insert(taskConversationSnapshot).values({
          taskId: currentTaskId,
          userId: currentUserId,
          query: rememberInput.query,
          finalAnswer: rememberInput.finalAnswer,
          messages: toJsonbValue(rememberInput.messages),
          toolSummary: toJsonbValue(toolSummary),
          summary: summary ?? null,
          turns: rememberInput.result.turns,
          stoppedBy: rememberInput.result.stoppedBy,
          isCheckpoint: false,
        });
      } catch (error) {
        logger.warn(
          "[RememberManager] conversation snapshot write failed:",
          error instanceof Error ? error.message : String(error)
        );
      }

      // ---- Step 4: Episode extraction (P1-4, optional) ----
      if (input.embeddingClient && input.episodeExtractor) {
        try {
          const episode = await input.episodeExtractor.extract(rememberInput);
          const embedding = await input.embeddingClient.embed(episode.userQuery);
          await db.insert(episodicMemories).values({
            taskId: currentTaskId,
            userId: currentUserId,
            scene: episode.scene,
            userQuery: episode.userQuery,
            toolSequence: toJsonbValue(episode.toolSequence),
            finalResult: episode.finalResult,
            importance: episode.importance,
            tags: episode.tags,
            relatedEntities: episode.relatedEntities,
            embedding: formatVectorForPg(embedding),
          });
        } catch (error) {
          logger.warn(
            "[RememberManager] episode extraction failed:",
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_OUTPUT_PREVIEW_CHARS = 500;

interface ToolSummaryEntry {
  toolName: string;
  ok: boolean;
  inputParams: Record<string, unknown>;
  outputPreview: string;
}

/**
 * Extract a lightweight tool summary from observations + conversation messages.
 * Matches toolCallId to find the original input params from assistant messages.
 */
function extractToolSummary(
  observations: ToolObservation[],
  messages: AgentMessage[]
): ToolSummaryEntry[] {
  const inputMap = new Map<string, Record<string, unknown>>();
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.toolCalls) {
      for (const call of msg.toolCalls) {
        inputMap.set(call.id, call.input);
      }
    }
  }

  return observations.map((obs) => ({
    toolName: obs.toolName,
    ok: obs.ok,
    inputParams: inputMap.get(obs.toolCallId) ?? {},
    outputPreview: truncateOutputPreview(obs.output),
  }));
}

function truncateOutputPreview(output: unknown): string {
  if (output === undefined || output === null) return "";
  const text =
    typeof output === "string" ? output : safeJsonStringify(output);
  return truncateText(text, MAX_OUTPUT_PREVIEW_CHARS);
}

/** Serialize a value for JSONB storage (handles undefined, sanitizes for JSON). */
function toJsonbValue(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(safeJsonStringify(sanitizeForJson(value))) as unknown;
}

/** Format a number[] as a pgvector-compatible string: "[0.1,0.2,0.3]". */
function formatVectorForPg(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
