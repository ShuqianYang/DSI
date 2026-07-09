/**
 * MidTaskCheckpointWriter (Part C) - 轻量快照写入.
 *
 * Writes lightweight checkpoint snapshots at natural breakpoints during
 * long-running tasks. Unlike remember(), checkpoints only store messages
 * and toolSummary — no summary, no embedding, no episode extraction.
 *
 * This prevents ContextWindowManager from losing critical information when
 * it trims early conversation history in tasks exceeding 30K tokens.
 *
 * Best-effort: all errors are caught and logged as warnings.
 */

import { taskConversationSnapshot } from "../../db/schema.js";
import { safeJsonStringify, sanitizeForJson, truncateText } from "./tools/_shared/serialization.js";
import type { AgentMessage, ToolObservation } from "./tools/_shared/types.js";
import type { SessionMemoryTrigger } from "./sessionMemoryTrigger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal DB surface for writing checkpoint snapshots. */
export interface CheckpointDatabase {
  insert(table: typeof taskConversationSnapshot): {
    values(row: NewCheckpointSnapshot): unknown;
  };
}

export interface MidTaskCheckpointWriter {
  /** Write a checkpoint snapshot at a natural breakpoint. */
  writeCheckpoint(input: CheckpointInput): Promise<void>;
  /** The associated trigger (for external state checks). */
  readonly trigger: SessionMemoryTrigger;
  /** The userId for this task. */
  readonly userId: string | null;
}

export interface CheckpointInput {
  taskId: string;
  userId: string | null;
  query: string;
  messages: AgentMessage[];
  observations: ToolObservation[];
  turn: number;
}

interface NewCheckpointSnapshot {
  taskId: string;
  userId: string;
  query: string;
  finalAnswer: string;
  messages: unknown;
  toolSummary: unknown;
  summary: null;
  turns: number;
  stoppedBy: string;
  isCheckpoint: boolean;
  checkpointTurn: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const MAX_OUTPUT_PREVIEW_CHARS = 500;

export function createMidTaskCheckpointWriter(input: {
  db: CheckpointDatabase;
  trigger: SessionMemoryTrigger;
  userId: string | null;
  logger?: Pick<Console, "warn" | "log">;
}): MidTaskCheckpointWriter {
  const logger = input.logger ?? console;

  return {
    trigger: input.trigger,
    userId: input.userId,

    async writeCheckpoint(checkpointInput: CheckpointInput): Promise<void> {
      if (!checkpointInput.userId) {
        logger.log("[MidTaskCheckpoint] skipped — no userId");
        return;
      }

      try {
        const toolSummary = extractToolSummary(
          checkpointInput.observations,
          checkpointInput.messages
        );

        await input.db.insert(taskConversationSnapshot).values({
          taskId: checkpointInput.taskId,
          userId: checkpointInput.userId,
          query: checkpointInput.query,
          finalAnswer: "",
          messages: toJsonbValue(checkpointInput.messages),
          toolSummary: toJsonbValue(toolSummary),
          summary: null,
          turns: checkpointInput.turn,
          stoppedBy: "checkpoint",
          isCheckpoint: true,
          checkpointTurn: checkpointInput.turn,
        });

        // Reset increment counters after successful write
        input.trigger.markCheckpoint(checkpointInput.turn);

        logger.log(
          `[MidTaskCheckpoint] checkpoint written at turn ${checkpointInput.turn}`
        );
      } catch (error) {
        logger.warn(
          "[MidTaskCheckpoint] checkpoint write failed:",
          error instanceof Error ? error.message : String(error)
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers (mirrors RememberManager logic for consistency)
// ---------------------------------------------------------------------------

interface ToolSummaryEntry {
  toolName: string;
  ok: boolean;
  inputParams: Record<string, unknown>;
  outputPreview: string;
}

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
  const text = typeof output === "string" ? output : safeJsonStringify(output);
  return truncateText(text, MAX_OUTPUT_PREVIEW_CHARS);
}

function toJsonbValue(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(safeJsonStringify(sanitizeForJson(value))) as unknown;
}
