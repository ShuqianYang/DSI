import { notifyTaskUpdate } from "../../sse/sseManager.js";
import type { CreateTaskRequest } from "@datasourceintelligence/shared";
import { runAgentLoop } from "../agent-loop/runAgentLoop.js";
import type { RunAgentLoopOptions } from "../agent-loop/runAgentLoop.js";
import { buildAgentLoopTaskResult } from "./agentLoopResultProjection.js";
import { buildLoopStopEventFromTaskResult } from "./agentLoopSseMode.js";
import { createAgentLoopFileLogger, type AgentLoopFileLogger } from "../agent-loop/fileLogger.js";
import {
  createBestEffortTranscriptStore,
  createDbTranscriptStore,
} from "../agent-loop/transcriptStore.js";
import type { AgentTranscriptStore } from "../agent-loop/transcriptStore.js";
import { createDbRecentTaskLister } from "../agent-loop/sessionSummaryMemoryManager.js";
import { createPipelineMemoryManager } from "./pipelineMemory.js";
import { noopMemoryManager, type MemoryManager } from "../agent-loop/memoryManager.js";
import type { Task } from "../../db/schema.js";
import {
  bestEffortManifestWrite,
  createDbAgentLoopLogManifestStore,
  type AgentLoopLogManifestStore,
  type AgentLoopLogMode,
} from "../observability/logManifestStore.js";

const DEMO_TURN_DELAY_MS = 5_000;
const DEMO_MAX_TURNS = 20;

export type ForcedSkillId = "border-defense-qa" | "border-defense-daily-report";
export type PipelineCreateTaskRequest = CreateTaskRequest & { forcedSkillId?: ForcedSkillId };

export interface AgentLoopRunMetadata {
  requestId?: string;
  clientRequestId?: string;
  sessionId?: string;
  userId?: string;
  scenarioId?: string;
  method?: string;
  path?: string;
  userAgent?: string;
  ipHash?: string;
  ipMasked?: string;
  receivedAt?: string;
}

export interface PipelineTaskService {
  updateTaskStatus(
    taskId: string,
    status: "pending" | "running" | "completed" | "failed",
    error?: string
  ): Promise<void>;
  updateTaskResult(
    taskId: string,
    result: Record<string, unknown>,
    status: "completed" | "failed"
  ): Promise<void>;
  getTaskById(taskId: string): Promise<Task | null>;
}

export interface RunAgentPipelineDependencies {
  taskService: PipelineTaskService;
  createFileLogger(input: {
    taskId: string;
    query: string;
    metadata: Record<string, unknown>;
  }): Promise<AgentLoopFileLogger>;
  runAgentLoop(options: RunAgentLoopOptions): Promise<Awaited<ReturnType<typeof runAgentLoop>>>;
  createTranscriptStore(): AgentTranscriptStore;
  createBestEffortTranscriptStore(
    store: AgentTranscriptStore,
    logger: Pick<Console, "warn">
  ): AgentTranscriptStore;
  createMemoryManager(input: Parameters<typeof createPipelineMemoryManager>[0]): MemoryManager;
  listRecentCompletedTasks: Parameters<
    typeof createPipelineMemoryManager
  >[0]["listRecentCompletedTasks"];
  manifestStore?: AgentLoopLogManifestStore;
  notifyTaskUpdate(taskId: string, event: unknown): void;
  logger: Pick<Console, "log" | "warn" | "error">;
}

function resolveAgentLoopLogMode(env: NodeJS.ProcessEnv): AgentLoopLogMode {
  return env.AGENT_LOOP_LOG_MODE === "operational" ? "operational" : "debug";
}

async function createDefaultRunAgentPipelineDependencies(): Promise<RunAgentPipelineDependencies> {
  const [{ db }, taskService] = await Promise.all([
    import("../../config/database.js"),
    import("./service.js"),
  ]);
  const transcriptStore = createDbTranscriptStore(db);
  return {
    taskService,
    createFileLogger: createAgentLoopFileLogger,
    runAgentLoop,
    createTranscriptStore: () => transcriptStore,
    createBestEffortTranscriptStore,
    createMemoryManager: createPipelineMemoryManager,
    listRecentCompletedTasks: createDbRecentTaskLister(db),
    manifestStore: createDbAgentLoopLogManifestStore(db),
    notifyTaskUpdate,
    logger: console,
  };
}

function isDemoQuery(query: string): boolean {
  return query.trim().startsWith("/演示:");
}

/**
 * Main task pipeline entry.
 *
 * Runs Agent Loop asynchronously and streams native Agent Loop events through SSE.
 */
export async function runAgentPipeline(
  taskId: string,
  body: PipelineCreateTaskRequest,
  metadata: AgentLoopRunMetadata = {}
) {
  return runAgentPipelineWithDependencies(
    taskId,
    body,
    metadata,
    await createDefaultRunAgentPipelineDependencies()
  );
}

export async function runAgentPipelineWithDependencies(
  taskId: string,
  body: PipelineCreateTaskRequest,
  metadata: AgentLoopRunMetadata = {},
  dependencies: RunAgentPipelineDependencies
) {
  let fileLogger: AgentLoopFileLogger | undefined;
  let runMetadata: AgentLoopRunMetadata = metadata;

  try {
    await dependencies.taskService.updateTaskStatus(taskId, "running");

    dependencies.logger.log(`[Pipeline] Task ${taskId} received query: "${body.query}"`);
    try {
      runMetadata = {
        ...metadata,
        userId: body.userId,
        sessionId: body.sessionId,
        clientRequestId: body.clientRequestId,
        scenarioId: body.scenarioId,
      };
      fileLogger = await dependencies.createFileLogger({
        taskId,
        query: body.query,
        metadata: runMetadata as Record<string, unknown>,
      });
      dependencies.logger.log(`[Pipeline] Agent Loop log file: ${fileLogger.filePath}`);
      if (dependencies.manifestStore) {
        await bestEffortManifestWrite(
          () =>
            dependencies.manifestStore!.recordStarted({
              taskId,
              sessionId: runMetadata.sessionId,
              requestId: runMetadata.requestId,
              userId: runMetadata.userId,
              filePath: fileLogger!.filePath,
              mode: resolveAgentLoopLogMode(process.env),
              startedAt: new Date(),
            }),
          dependencies.logger
        );
      }
    } catch (logError) {
      dependencies.logger.warn(
        `[Pipeline] Agent Loop file logging disabled for task ${taskId}:`,
        logError instanceof Error ? logError.message : String(logError)
      );
    }

    const transcriptStore = dependencies.createTranscriptStore();
    const currentTask = await dependencies.taskService.getTaskById(taskId);
    const loopResult = await dependencies.runAgentLoop({
      taskId,
      query: body.query,
      scenarioId: body.scenarioId,
      forcedSkillId: body.forcedSkillId,
      fileLogger,
      turnDelayMs: isDemoQuery(body.query) ? DEMO_TURN_DELAY_MS : undefined,
      maxTurns: isDemoQuery(body.query) ? DEMO_MAX_TURNS : undefined,
      transcriptStore: dependencies.createBestEffortTranscriptStore(
        transcriptStore,
        dependencies.logger
      ),
      memoryManager: body.forcedSkillId
        ? noopMemoryManager
        : dependencies.createMemoryManager({
            currentTaskId: taskId,
            currentTask,
            env: process.env,
            transcriptStore,
            listRecentCompletedTasks: dependencies.listRecentCompletedTasks,
            logger: dependencies.logger,
          }),
    });

    const result = buildAgentLoopTaskResult(loopResult);

    if (loopResult.stoppedBy === "model_error" || loopResult.stoppedBy === "aborted") {
      await dependencies.taskService.updateTaskResult(taskId, result, "failed");
      if (fileLogger && dependencies.manifestStore) {
        await bestEffortManifestWrite(
          () =>
            dependencies.manifestStore!.recordFailed({
              taskId,
              filePath: fileLogger!.filePath,
              endedAt: new Date(),
            }),
          dependencies.logger
        );
      }
      return;
    }

    await dependencies.taskService.updateTaskResult(taskId, result, "completed");
    if (fileLogger && dependencies.manifestStore) {
      await bestEffortManifestWrite(
        () =>
          dependencies.manifestStore!.recordCompleted({
            taskId,
            filePath: fileLogger!.filePath,
            endedAt: new Date(),
          }),
        dependencies.logger
      );
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    dependencies.logger.error(`[Pipeline] Error for task ${taskId}:`, errorMsg);
    await fileLogger?.fail(error);
    if (fileLogger && dependencies.manifestStore) {
      await bestEffortManifestWrite(
        () =>
          dependencies.manifestStore!.recordFailed({
            taskId,
            filePath: fileLogger!.filePath,
            endedAt: new Date(),
          }),
        dependencies.logger
      );
    }
    await dependencies.taskService.updateTaskStatus(taskId, "failed", errorMsg);
    dependencies.notifyTaskUpdate(
      taskId,
      buildLoopStopEventFromTaskResult({
        taskId,
        status: "failed",
        result: fileLogger?.filePath
          ? {
              mode: "agent_loop",
              message: errorMsg,
              turns: 0,
              stoppedBy: "model_error",
              logFilePath: fileLogger.filePath,
              observations: [],
            }
          : null,
        error: errorMsg,
      })
    );
  }
}
