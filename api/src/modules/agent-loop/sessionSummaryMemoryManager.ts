import { and, desc, eq, ne } from "drizzle-orm";
import { tasks } from "../../db/schema.js";
import type { MemoryManager } from "./memoryManager.js";
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

export interface CreateSessionSummaryMemoryManagerInput {
  enabled: boolean;
  currentTaskId: string;
  currentUserId?: string | null;
  recentTaskLimit?: number;
  maxSectionChars?: number;
  transcriptStore: AgentTranscriptStore;
  listRecentCompletedTasks(input: ListRecentCompletedTasksInput): Promise<SessionMemoryTaskSummary[]>;
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

  return {
    transcriptStore: input.transcriptStore,
    startRelevantMemoryPrefetch(): AgentLoopPrefetch | undefined {
      if (!input.enabled || input.currentUserId == null) return undefined;

      const prefetch: AgentLoopPrefetch = {
        settledAt: null,
        consumedOnIteration: -1,
        promise: Promise.resolve().then(async () => {
          try {
            const recentTasks = await input.listRecentCompletedTasks({
              userId: input.currentUserId!,
              excludeTaskId: input.currentTaskId,
              limit: recentTaskLimit,
            });
            const sections: PromptSection[] = [];
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
                logger.warn(
                  "[Memory] session summary candidate failed:",
                  task.id,
                  error instanceof Error ? error.message : String(error)
                );
              }
            }
            return sections;
          } catch (error) {
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
  };
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
