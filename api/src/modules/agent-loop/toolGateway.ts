import type {
  GatewayToolCall,
  ToolExecutionContext,
  ToolObservation,
} from "./types.js";
import type { ToolRegistry } from "./toolRegistry.js";

const DEFAULT_MAX_RESULT_SIZE_CHARS = 60_000;

export async function callTool(
  registry: ToolRegistry,
  toolCall: GatewayToolCall,
  context: ToolExecutionContext
): Promise<ToolObservation> {
  const tool = registry.get(toolCall.toolName);
  if (!tool) {
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.toolName,
      ok: false,
      error: {
        code: "unknown_tool",
        message: `Unknown tool: ${toolCall.toolName}`,
      },
    };
  }

  const parsed = tool.inputSchema.safeParse(toolCall.input);
  if (!parsed.success) {
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.toolName,
      ok: false,
      error: {
        code: "invalid_tool_input",
        message: parsed.error.message,
      },
    };
  }

  let input = parsed.data;
  try {
    if (tool.validateInput) {
      await tool.validateInput(input, context);
    }
  } catch (error) {
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.toolName,
      ok: false,
      error: {
        code: "tool_input_validation_error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  if (context.signal?.aborted) {
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.toolName,
      ok: false,
      error: {
        code: "tool_aborted",
        message: formatAbortReason(context.signal.reason),
      },
    };
  }

  try {
    if (tool.checkPermissions) {
      const decision = await tool.checkPermissions(input, context);
      if (decision.updatedInput !== undefined) {
        input = decision.updatedInput;
      }
      if (decision.behavior !== "allow") {
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.toolName,
          ok: false,
          error: {
            code: decision.behavior === "ask" ? "permission_required" : "permission_denied",
            message:
              decision.message ??
              (decision.behavior === "ask"
                ? "Tool requires user permission before execution."
                : "Tool execution was denied by permission policy."),
          },
        };
      }
    }

    const output = await tool.execute(input, {
      ...context,
      onProgress: (event) =>
        context.onProgress?.({
          ...event,
          toolCallId: event.toolCallId || toolCall.id,
          toolName: event.toolName || toolCall.toolName,
        }),
    });
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.toolName,
      ok: true,
      output: applyResultBudget(output, tool.maxResultSizeChars),
    };
  } catch (error) {
    const errorWithOutput = error as Error & { toolOutput?: unknown };
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.toolName,
      ok: false,
      output: applyResultBudget(errorWithOutput.toolOutput, tool.maxResultSizeChars),
      error: {
        code: context.signal?.aborted ? "tool_aborted" : "tool_execution_error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function applyResultBudget(output: unknown, maxChars = DEFAULT_MAX_RESULT_SIZE_CHARS): unknown {
  if (!Number.isFinite(maxChars) || maxChars <= 0 || output === undefined) {
    return output;
  }

  let serialized: string | undefined;
  try {
    serialized = typeof output === "string" ? output : JSON.stringify(output);
  } catch {
    serialized = String(output);
  }
  if (serialized === undefined) {
    return output;
  }
  if (serialized.length <= maxChars) {
    return output;
  }

  return {
    truncated: true,
    originalChars: serialized.length,
    maxChars,
    preview: serialized.slice(0, maxChars),
    note: "Tool output exceeded this tool's result budget and was truncated before storage/model feedback.",
  };
}

function formatAbortReason(reason: unknown): string {
  if (typeof reason === "string" && reason.trim()) {
    return `Tool execution aborted: ${reason}`;
  }
  return "Tool execution aborted.";
}
