import { and, eq } from "drizzle-orm";
import type { db as appDb } from "../../config/database.js";
import { agentLoopLogFiles } from "../../db/schema.js";

export type AgentLoopLogMode = "debug" | "operational";

export interface AgentLoopLogManifestStartedInput {
  taskId: string;
  sessionId?: string;
  requestId?: string;
  userId?: string;
  filePath: string;
  mode: AgentLoopLogMode;
  startedAt?: Date;
}

export interface AgentLoopLogManifestFinishedInput {
  taskId: string;
  filePath: string;
  endedAt?: Date;
}

export interface AgentLoopLogManifestStore {
  recordStarted(input: AgentLoopLogManifestStartedInput): Promise<void>;
  recordCompleted(input: AgentLoopLogManifestFinishedInput): Promise<void>;
  recordFailed(input: AgentLoopLogManifestFinishedInput): Promise<void>;
}

type Database = typeof appDb;

export function createDbAgentLoopLogManifestStore(db: Database): AgentLoopLogManifestStore {
  return {
    async recordStarted(input) {
      await db.insert(agentLoopLogFiles).values({
        taskId: input.taskId,
        sessionId: input.sessionId,
        requestId: input.requestId,
        userId: input.userId,
        filePath: input.filePath,
        mode: input.mode,
        status: "running",
        startedAt: input.startedAt ?? new Date(),
      });
    },

    async recordCompleted(input) {
      await updateStatus(db, input, "completed");
    },

    async recordFailed(input) {
      await updateStatus(db, input, "failed");
    },
  };
}

async function updateStatus(
  db: Database,
  input: AgentLoopLogManifestFinishedInput,
  status: "completed" | "failed"
): Promise<void> {
  await db
    .update(agentLoopLogFiles)
    .set({
      status,
      endedAt: input.endedAt ?? new Date(),
    })
    .where(
      and(
        eq(agentLoopLogFiles.taskId, input.taskId),
        eq(agentLoopLogFiles.filePath, input.filePath)
      )
    );
}

export async function bestEffortManifestWrite(
  action: () => Promise<void>,
  logger: Pick<Console, "warn"> = console
): Promise<void> {
  try {
    await action();
  } catch (error) {
    logger.warn(
      "[AgentLoopLogManifest] write failed:",
      error instanceof Error ? error.message : String(error)
    );
  }
}
