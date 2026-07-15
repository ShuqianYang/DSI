import { and, desc, eq, ne } from "drizzle-orm";
import { tasks, taskConversationSnapshot } from "../../db/schema.js";
import type { MemoryDiagnostics, MemoryManager } from "./memoryManager.js";
import type { AgentTranscriptStore } from "./transcriptStore.js";
import { summarizeTranscriptForContext } from "./transcriptStore.js";
import { truncateText } from "./tools/_shared/serialization.js";
import type { AgentLoopPrefetch, PromptSection } from "./tools/_shared/types.js";

const DEFAULT_RECENT_TASK_LIMIT = 3;
const DEFAULT_SECTION_MAX_CHARS = 3000;

export interface SessionMemoryTaskSummary {
  id: string;
  userId: string | null;
  query: string;
  status: string;
  completedAt: Date | string | null;
}

export interface ListRecentCompletedTasksInput {
  userId: string;
  excludeTaskId: string;
  limit: number;
}

/** Snapshot-based recall summary (P0-3: O(1) query替代 transcript 重建). */
export interface SessionMemorySnapshotSummary {
  taskId: string;
  query: string;
  summary: string | null;
  turns: number;
  stoppedBy: string;
  createdAt: Date;
}

export interface ListRecentSnapshotsInput {
  userId: string;
  excludeTaskId: string;
  limit: number;
}

export interface CreateSessionSummaryMemoryManagerInput {
  enabled: boolean;
  currentTaskId: string;
  currentUserId?: string | null;
  recentTaskLimit?: number;
  maxSectionChars?: number;
  transcriptStore: AgentTranscriptStore;
  listRecentCompletedTasks(input: ListRecentCompletedTasksInput): Promise<SessionMemoryTaskSummary[]>;
  /** Optional snapshot lister for O(1) recall (P0-3). When provided, recall tries snapshots first. */
  listRecentSnapshots?(input: ListRecentSnapshotsInput): Promise<SessionMemorySnapshotSummary[]>;
  logger?: Pick<Console, "warn">;
}

export interface FormatSessionMemorySectionInput {
  task: SessionMemoryTaskSummary;
  transcriptSummary: Record<string, unknown>;
  maxChars: number;
}

export function createSessionSummaryMemoryManager(
  input: CreateSessionSummaryMemoryManagerInput
): MemoryManager & { transcriptStore: AgentTranscriptStore } {
  const logger = input.logger ?? console;
  const recentTaskLimit = positiveIntegerOrDefault(
    input.recentTaskLimit,
    DEFAULT_RECENT_TASK_LIMIT
  );
  const maxSectionChars = Math.max(
    200,
    positiveIntegerOrDefault(input.maxSectionChars, DEFAULT_SECTION_MAX_CHARS)
  );
  const diagnostics: MemoryDiagnostics = {
    enabled: input.enabled,
    status: input.enabled ? "empty" : "disabled",
    currentUserId: input.currentUserId ?? null,
    recalledTaskCount: 0,
    sectionCount: 0,
    skippedReason: input.enabled ? null : "disabled",
    warningCount: 0,
  };

  return {
    transcriptStore: input.transcriptStore,
    startRelevantMemoryPrefetch(): AgentLoopPrefetch | undefined {
      if (!input.enabled) {
        diagnostics.status = "disabled";
        diagnostics.skippedReason = "disabled";
        return undefined;
      }
      if (input.currentUserId == null) {
        diagnostics.status = "no_user";
        diagnostics.skippedReason = "no_user";
        return undefined;
      }

      diagnostics.status = "pending";
      diagnostics.skippedReason = null;

      const prefetch: AgentLoopPrefetch = {
        settledAt: null,
        consumedOnIteration: -1,
        promise: Promise.resolve().then(async () => {
          try {
            const sections: PromptSection[] = [];

            // ---- P0-3: Try snapshot-based recall first (O(1) per task) ----
            if (input.listRecentSnapshots) {
              try {
                const snapshots = await input.listRecentSnapshots({
                  userId: input.currentUserId!,
                  excludeTaskId: input.currentTaskId,
                  limit: recentTaskLimit,
                });
                diagnostics.recalledTaskCount = snapshots.length;

                for (const snapshot of snapshots) {
                  try {
                    if (snapshot.summary) {
                      // Use pre-computed summary directly — skip transcript loading
                      const parsed = parseTranscriptSummary(snapshot.summary);
                      if (parsed) {
                        sections.push(
                          formatSessionMemorySection({
                            task: {
                              id: snapshot.taskId,
                              userId: input.currentUserId!,
                              query: snapshot.query,
                              status: "completed",
                              completedAt: snapshot.createdAt,
                            },
                            transcriptSummary: parsed,
                            maxChars: maxSectionChars,
                          })
                        );
                        continue;
                      }
                    }
                    // Snapshot exists but no summary — fallback to transcript loading
                    const transcriptSection = summarizeTranscriptForContext(
                      await input.transcriptStore.load(snapshot.taskId)
                    );
                    if (!transcriptSection) continue;
                    const transcriptSummary = parseTranscriptSummary(transcriptSection.content);
                    if (!transcriptSummary) continue;
                    sections.push(
                      formatSessionMemorySection({
                        task: {
                          id: snapshot.taskId,
                          userId: input.currentUserId!,
                          query: snapshot.query,
                          status: "completed",
                          completedAt: snapshot.createdAt,
                        },
                        transcriptSummary,
                        maxChars: maxSectionChars,
                      })
                    );
                  } catch (error) {
                    diagnostics.warningCount += 1;
                    logger.warn(
                      "[Memory] snapshot candidate failed:",
                      snapshot.taskId,
                      error instanceof Error ? error.message : String(error)
                    );
                  }
                }
              } catch (error) {
                diagnostics.warningCount += 1;
                logger.warn(
                  "[Memory] snapshot recall failed, falling back to task-based recall:",
                  error instanceof Error ? error.message : String(error)
                );
              }
            }

            // ---- Fallback: task-based recall (when no snapshots found) ----
            if (sections.length === 0) {
              const recentTasks = await input.listRecentCompletedTasks({
                userId: input.currentUserId!,
                excludeTaskId: input.currentTaskId,
                limit: recentTaskLimit,
              });
              diagnostics.recalledTaskCount = recentTasks.length;
              for (const task of recentTasks) {
                try {
                  if (task.id === input.currentTaskId) continue;
                  const transcriptSection = summarizeTranscriptForContext(
                    await input.transcriptStore.load(task.id)
                  );
                  if (!transcriptSection) continue;
                  const transcriptSummary = parseTranscriptSummary(transcriptSection.content);
                  if (!transcriptSummary) continue;
                  sections.push(
                    formatSessionMemorySection({
                      task,
                      transcriptSummary,
                      maxChars: maxSectionChars,
                    })
                  );
                } catch (error) {
                  diagnostics.warningCount += 1;
                  logger.warn(
                    "[Memory] session summary candidate failed:",
                    task.id,
                    error instanceof Error ? error.message : String(error)
                  );
                }
              }
            }

            diagnostics.sectionCount = sections.length;
            diagnostics.status = sections.length > 0 ? "loaded" : "empty";
            diagnostics.skippedReason = sections.length > 0 ? null : "empty";
            return sections;
          } catch (error) {
            diagnostics.status = "failed";
            diagnostics.skippedReason = "failed";
            diagnostics.warningCount += 1;
            logger.warn(
              "[Memory] session summary recall failed:",
              error instanceof Error ? error.message : String(error)
            );
            return [];
          } finally {
            prefetch.settledAt = Date.now();
          }
        }),
      };
      return prefetch;
    },
    getDiagnostics() {
      return { ...diagnostics };
    },
    filterDuplicateMemorySections(sections) {
      const seen = new Set<string>();
      return sections.filter((section) => {
        if (seen.has(section.id)) return false;
        seen.add(section.id);
        return true;
      });
    },
  };
}

export function formatSessionMemorySection(input: FormatSessionMemorySectionInput): PromptSection {
  const summary = firstStringValue(
    input.transcriptSummary,
    "summary",
    "lastAssistantAnswerPreview"
  );
  const finalResult = firstStringValue(
    input.transcriptSummary,
    "finalResult",
    "finalAnswerPreview",
    "lastAssistantAnswerPreview"
  );
  return {
    id: `memory.session_summary.${input.task.id}`,
    content: truncateText(
      JSON.stringify(
        {
          source: "recent_completed_task",
          taskId: input.task.id,
          query: input.task.query,
          completedAt: input.task.completedAt,
          summary: input.transcriptSummary,
        },
        null,
        2
      ),
      input.maxChars
    ),
    metadata: {
      memoryRecall: {
        query: input.task.query,
        ...(summary ? { summary } : {}),
        ...(finalResult ? { finalResult } : {}),
        source: "session",
      },
    },
  };
}

function firstStringValue(
  record: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

export function createDbRecentTaskLister(database: {
  select(): {
    from(table: typeof tasks): {
      where(condition: unknown): {
        orderBy(...columns: unknown[]): {
          limit(limit: number): Promise<SessionMemoryTaskSummary[]>;
        };
      };
    };
  };
}) {
  return async function listRecentCompletedTasks(
    input: ListRecentCompletedTasksInput
  ): Promise<SessionMemoryTaskSummary[]> {
    return database
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, input.userId),
          eq(tasks.status, "completed"),
          ne(tasks.id, input.excludeTaskId)
        )
      )
      .orderBy(desc(tasks.completedAt), desc(tasks.createdAt))
      .limit(input.limit);
  };
}

/**
 * Create a snapshot lister that queries task_conversation_snapshot (P0-3).
 * Returns only non-checkpoint snapshots (is_checkpoint = false).
 */
export function createDbSnapshotLister(database: {
  select(): {
    from(table: typeof taskConversationSnapshot): {
      where(condition: unknown): {
        orderBy(...columns: unknown[]): {
          limit(limit: number): Promise<SessionMemorySnapshotSummary[]>;
        };
      };
    };
  };
}) {
  return async function listRecentSnapshots(
    input: ListRecentSnapshotsInput
  ): Promise<SessionMemorySnapshotSummary[]> {
    return database
      .select()
      .from(taskConversationSnapshot)
      .where(
        and(
          eq(taskConversationSnapshot.userId, input.userId),
          ne(taskConversationSnapshot.taskId, input.excludeTaskId),
          eq(taskConversationSnapshot.isCheckpoint, false)
        )
      )
      .orderBy(desc(taskConversationSnapshot.createdAt))
      .limit(input.limit);
  };
}

function parseTranscriptSummary(content: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function positiveIntegerOrDefault(value: unknown, fallback: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(1, Math.floor(numberValue));
}
