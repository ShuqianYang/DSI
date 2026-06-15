import * as taskService from "./service.js";
import { notifyTaskUpdate } from "../../sse/sseManager.js";
import type { CreateTaskRequest } from "@datasourceintelligence/shared";
import { db } from "../../config/database.js";
import { runAgentLoop } from "../agent-loop/runAgentLoop.js";
import { buildAgentLoopTaskResult } from "./agentLoopResultProjection.js";
import { buildLoopStopEventFromTaskResult } from "./agentLoopSseMode.js";
import { createAgentLoopFileLogger, type AgentLoopFileLogger } from "../agent-loop/fileLogger.js";
import {
  createBestEffortTranscriptStore,
  createDbTranscriptStore,
} from "../agent-loop/transcriptStore.js";

/**
 * Main task pipeline entry.
 *
 * Runs Agent Loop asynchronously and streams native Agent Loop events through SSE.
 */
export async function runAgentPipeline(taskId: string, body: CreateTaskRequest) {
  let fileLogger: AgentLoopFileLogger | undefined;

  try {
    await taskService.updateTaskStatus(taskId, "running");

    console.log(`[Pipeline] Task ${taskId} received query: "${body.query}"`);
    try {
      fileLogger = await createAgentLoopFileLogger({ taskId, query: body.query });
      console.log(`[Pipeline] Agent Loop log file: ${fileLogger.filePath}`);
    } catch (logError) {
      console.warn(
        `[Pipeline] Agent Loop file logging disabled for task ${taskId}:`,
        logError instanceof Error ? logError.message : String(logError)
      );
    }

    const loopResult = await runAgentLoop({
      taskId,
      query: body.query,
      fileLogger,
      transcriptStore: createBestEffortTranscriptStore(createDbTranscriptStore(db), console),
    });

    const result = buildAgentLoopTaskResult(loopResult);

    if (loopResult.stoppedBy === "model_error" || loopResult.stoppedBy === "aborted") {
      await taskService.updateTaskResult(taskId, result, "failed");
      return;
    }

    await taskService.updateTaskResult(taskId, result, "completed");
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Pipeline] Error for task ${taskId}:`, errorMsg);
    await fileLogger?.fail(error);
    await taskService.updateTaskStatus(taskId, "failed", errorMsg);
    notifyTaskUpdate(
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
