import type { AgentTranscriptStore } from "../agent-loop/transcriptStore.js";
import type {
  ListRecentCompletedTasksInput,
  SessionMemoryTaskSummary,
} from "../agent-loop/sessionSummaryMemoryManager.js";
import { createSessionSummaryMemoryManager } from "../agent-loop/sessionSummaryMemoryManager.js";

export interface PipelineMemoryTask {
  userId?: string | null;
}

export interface PipelineMemoryEnv {
  AGENT_MEMORY_SESSION_SUMMARY?: string;
  AGENT_MEMORY_RECENT_TASK_LIMIT?: string;
  AGENT_MEMORY_SECTION_MAX_CHARS?: string;
}

export interface CreatePipelineMemoryManagerInput {
  currentTaskId: string;
  currentTask?: PipelineMemoryTask | null;
  env?: PipelineMemoryEnv;
  transcriptStore: AgentTranscriptStore;
  listRecentCompletedTasks(input: ListRecentCompletedTasksInput): Promise<SessionMemoryTaskSummary[]>;
  logger?: Pick<Console, "warn">;
}

export function createPipelineMemoryManager(input: CreatePipelineMemoryManagerInput) {
  const env = input.env ?? {};
  return createSessionSummaryMemoryManager({
    enabled: env.AGENT_MEMORY_SESSION_SUMMARY === "1",
    currentTaskId: input.currentTaskId,
    currentUserId: input.currentTask?.userId ?? null,
    recentTaskLimit: parseMemoryIntegerEnv(env.AGENT_MEMORY_RECENT_TASK_LIMIT),
    maxSectionChars: parseMemoryIntegerEnv(env.AGENT_MEMORY_SECTION_MAX_CHARS),
    transcriptStore: input.transcriptStore,
    listRecentCompletedTasks: input.listRecentCompletedTasks,
    logger: input.logger,
  });
}

export function parseMemoryIntegerEnv(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
