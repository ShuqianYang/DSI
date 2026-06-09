import * as taskService from "./service.js";
import { notifyTaskUpdate } from "../../sse/sseManager.js";
import type { CreateTaskRequest } from "@datasourceintelligence/shared";
import { runAgentLoop } from "../agent-loop/runAgentLoop.js";
import { createLegacySseAdapter } from "./agentLoopEventAdapter.js";
import { buildAgentLoopTaskResult } from "./agentLoopResultProjection.js";
import { createAgentLoopFileLogger, type AgentLoopFileLogger } from "../agent-loop/fileLogger.js";

/**
 * Agent Pipeline 主入口。
 *
 * 接收用户查询后，异步执行 Agent Loop，并通过 SSE 实时推送进度。
 * 旧的 Planner / Router / Executor / Harness 已移除，这里是全新 Agent Loop 的挂载点。
 */
export async function runAgentPipeline(taskId: string, body: CreateTaskRequest) {
  let fileLogger: AgentLoopFileLogger | undefined;

  try {
    await taskService.updateTaskStatus(taskId, "running");

    notifyTaskUpdate(taskId, {
      type: "planning",
      stage: "planner",
      message: "正在分析用户意图并生成执行计划...",
    });

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

    const legacySseAdapter = createLegacySseAdapter({
      taskId,
      query: body.query,
      emit: (event) => {
        fileLogger?.logDerivedEvent("legacy_sse_event", event);
        notifyTaskUpdate(taskId, event);
      },
    });

    const loopResult = await runAgentLoop({
      taskId,
      query: body.query,
      fileLogger,
      onEvent: (event) => {
        legacySseAdapter.handle(event);
      },
    });

    const result = buildAgentLoopTaskResult(loopResult);

    if (loopResult.stoppedBy === "model_error" || loopResult.stoppedBy === "aborted") {
      await taskService.updateTaskResult(taskId, result, "failed");
      notifyTaskUpdate(taskId, {
        type: "failed",
        taskId,
        status: "failed",
        message: loopResult.finalAnswer,
        logFilePath: loopResult.logFilePath,
      });
      return;
    }

    await taskService.updateTaskResult(taskId, result, "completed");

    notifyTaskUpdate(taskId, {
      type: "completed",
      taskId,
      status: "completed",
      message: loopResult.finalAnswer,
      logFilePath: loopResult.logFilePath,
      result,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Pipeline] Error for task ${taskId}:`, errorMsg);
    await fileLogger?.fail(error);
    await taskService.updateTaskStatus(taskId, "failed", errorMsg);
    notifyTaskUpdate(taskId, {
      type: "failed",
      taskId,
      status: "failed",
      message: errorMsg,
      logFilePath: fileLogger?.filePath,
    });
  }
}
