import type { AgentTranscriptStore } from "../agent-loop/transcriptStore.js";
import type {
  ListRecentCompletedTasksInput,
  SessionMemoryTaskSummary,
  SessionMemorySnapshotSummary,
} from "../agent-loop/sessionSummaryMemoryManager.js";
import {
  createSessionSummaryMemoryManager,
  createDbSnapshotLister,
} from "../agent-loop/sessionSummaryMemoryManager.js";
import type { MemoryManager } from "../agent-loop/memoryManager.js";
import {
  createRememberManager,
  type RememberManagerDatabase,
} from "../agent-loop/rememberManager.js";
import type { EmbeddingClient } from "../agent-loop/embeddingClient.js";
import type { EpisodeExtractor } from "../agent-loop/episodeExtractor.js";
import {
  createHybridMemoryManager,
  type HybridMemoryDatabase,
} from "../agent-loop/hybridMemoryManager.js";
import { taskConversationSnapshot } from "../../db/schema.js";

/** Database type that satisfies both RememberManager (insert) and SnapshotLister (select). */
export type PipelineMemoryDatabase = RememberManagerDatabase & HybridMemoryDatabase & {
  select(): {
    from(table: typeof taskConversationSnapshot): {
      where(condition: unknown): {
        orderBy(...columns: unknown[]): {
          limit(limit: number): Promise<SessionMemorySnapshotSummary[]>;
        };
      };
    };
  };
};

export interface PipelineMemoryTask {
  userId?: string | null;
}

export interface PipelineMemoryEnv {
  AGENT_MEMORY_SESSION_SUMMARY?: string;
  AGENT_MEMORY_RECENT_TASK_LIMIT?: string;
  AGENT_MEMORY_SECTION_MAX_CHARS?: string;
  AGENT_MEMORY_DECAY_LAMBDA?: string;
  AGENT_MEMORY_VECTOR_WEIGHT?: string;
  AGENT_MEMORY_KEYWORD_WEIGHT?: string;
  AGENT_MEMORY_ENTITY_WEIGHT?: string;
  AGENT_MEMORY_VECTOR_TOP_K?: string;
}

export interface CreatePipelineMemoryManagerInput {
  currentTaskId: string;
  currentTask?: PipelineMemoryTask | null;
  env?: PipelineMemoryEnv;
  transcriptStore: AgentTranscriptStore;
  listRecentCompletedTasks(input: ListRecentCompletedTasksInput): Promise<SessionMemoryTaskSummary[]>;
  logger?: Pick<Console, "warn" | "log">;
  /** Database instance for remember() persistence + snapshot recall (P0). Optional — when omitted, remember() is a no-op. */
  db?: PipelineMemoryDatabase;
  /** Embedding client for P1 vector recall. Optional. */
  embeddingClient?: EmbeddingClient;
  /** Episode extractor for P1 episodic memory. Optional. */
  episodeExtractor?: EpisodeExtractor;
}

export function createPipelineMemoryManager(input: CreatePipelineMemoryManagerInput): MemoryManager {
  const env = input.env ?? {};
  const sessionMemory = createSessionSummaryMemoryManager({
    enabled: env.AGENT_MEMORY_SESSION_SUMMARY === "1",
    currentTaskId: input.currentTaskId,
    currentUserId: input.currentTask?.userId ?? null,
    recentTaskLimit: parseMemoryIntegerEnv(env.AGENT_MEMORY_RECENT_TASK_LIMIT),
    maxSectionChars: parseMemoryIntegerEnv(env.AGENT_MEMORY_SECTION_MAX_CHARS),
    transcriptStore: input.transcriptStore,
    listRecentCompletedTasks: input.listRecentCompletedTasks,
    // Create snapshot lister when db is available (P0-3: O(1) recall)
    ...(input.db
      ? { listRecentSnapshots: createDbSnapshotLister(input.db) }
      : {}),
    logger: input.logger,
  });

  // Create rememberManager when db is available; merge remember() into the
  // session memory manager so the agent loop can call a single interface.
  const rememberManager = input.db
    ? createRememberManager({
        db: input.db,
        currentTaskId: input.currentTaskId,
        currentUserId: input.currentTask?.userId ?? null,
        transcriptStore: input.transcriptStore,
        embeddingClient: input.embeddingClient,
        episodeExtractor: input.episodeExtractor,
        logger: input.logger,
      })
    : undefined;

  const recallManager = input.db
    ? createHybridMemoryManager({
        sessionMemoryManager: sessionMemory,
        db: input.db,
        embeddingClient: input.embeddingClient,
        currentUserId: input.currentTask?.userId ?? null,
        decayLambda: parseNonNegativeMemoryNumber(env.AGENT_MEMORY_DECAY_LAMBDA, 0.1),
        vectorWeight: parseNonNegativeMemoryNumber(env.AGENT_MEMORY_VECTOR_WEIGHT, 0.6),
        keywordWeight: parseNonNegativeMemoryNumber(env.AGENT_MEMORY_KEYWORD_WEIGHT, 0.3),
        entityWeight: parseNonNegativeMemoryNumber(env.AGENT_MEMORY_ENTITY_WEIGHT, 0.1),
        vectorTopK: parsePositiveMemoryInteger(env.AGENT_MEMORY_VECTOR_TOP_K),
        logger: input.logger,
      })
    : sessionMemory;

  if (!rememberManager) {
    return recallManager;
  }

  // Merge: delegate recall/prefetch to sessionMemory, delegate remember to rememberManager.
  return {
    ...recallManager,
    remember: (rememberInput) => rememberManager.remember(rememberInput),
  };
}

export function parseMemoryIntegerEnv(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseNonNegativeMemoryNumber(value: string | undefined, fallback: number): number {
  const parsed = parseMemoryIntegerEnv(value);
  return parsed !== undefined && parsed >= 0 ? parsed : fallback;
}

function parsePositiveMemoryInteger(value: string | undefined): number | undefined {
  const parsed = parseMemoryIntegerEnv(value);
  return parsed !== undefined && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
