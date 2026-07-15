import type {
  GatewayToolCall,
  ToolExecutionContext,
  ToolPermissionDecision,
  ToolObservation,
} from "./types.js";
import { decideDefaultToolPolicy } from "./toolPolicy.js";
import type { ToolRegistry } from "./toolRegistry.js";
import { safeJsonStringify, sanitizeForJson } from "./serialization.js";

const DEFAULT_MAX_RESULT_SIZE_CHARS = 60_000;

export async function callTool(
  registry: ToolRegistry,
  toolCall: GatewayToolCall,
  context: ToolExecutionContext
): Promise<ToolObservation> {
  const tool = registry.get(toolCall.toolName);
  const displayName = tool?.displayName;
  if (!tool) {
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.toolName,
      displayName,
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
      displayName,
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
      displayName,
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
      displayName,
      ok: false,
      error: {
        code: "tool_aborted",
        message: formatAbortReason(context.signal.reason),
      },
    };
  }

  try {
    let sandboxReason: string | undefined;
    if (tool.checkPermissions) {
      const decision = await tool.checkPermissions(input, context);
      if (decision.updatedInput !== undefined) {
        input = decision.updatedInput;
      }
      const observation = await handlePermissionDecision({
        toolCall,
        input,
        decision,
        context,
        displayName,
      });
      if (observation) return observation;
      if (decision.behavior === "sandbox") {
        sandboxReason = decision.message;
      }
    } else {
      const defaultDecision = decideDefaultToolPolicy(tool, input, context);
      if (defaultDecision.updatedInput !== undefined) {
        input = defaultDecision.updatedInput;
      }
      const defaultObservation = await handlePermissionDecision({
        toolCall,
        input,
        decision: defaultDecision,
        context,
        displayName,
      });
      if (defaultObservation) return defaultObservation;
      if (defaultDecision.behavior === "sandbox") {
        sandboxReason = defaultDecision.message;
      }
    }

    const output = await tool.execute(input, {
      ...context,
      sandbox: sandboxReason
        ? {
            enabled: true,
            kind: "portable",
            reason: sandboxReason,
          }
        : context.sandbox,
      onProgress: (event) =>
        context.onProgress?.({
          ...event,
          toolCallId: event.toolCallId || toolCall.id,
          toolName: event.toolName || toolCall.toolName,
          displayName: event.displayName || displayName,
        }),
    });
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.toolName,
      displayName,
      ok: true,
      output: applyResultBudget(output, tool.maxResultSizeChars),
    };
  } catch (error) {
    const errorWithOutput = error as Error & { toolOutput?: unknown };
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.toolName,
      displayName,
      ok: false,
      output: applyResultBudget(errorWithOutput.toolOutput, tool.maxResultSizeChars),
      error: {
        code: context.signal?.aborted ? "tool_aborted" : "tool_execution_error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function handlePermissionDecision(input: {
  toolCall: GatewayToolCall;
  input: unknown;
  decision: ToolPermissionDecision;
  context: ToolExecutionContext;
  displayName?: string;
}): Promise<ToolObservation | undefined> {
  const { decision, toolCall, context, displayName } = input;
  if (decision.behavior === "allow" || decision.behavior === "sandbox") {
    return undefined;
  }

  if (decision.behavior === "ask" && context.permissionHandler) {
    let answer;
    try {
      answer = await context.permissionHandler({
        toolName: toolCall.toolName,
        input: input.input,
        behavior: "ask",
        message: decision.message ?? "Tool requires user permission before execution.",
      });
    } catch (error) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.toolName,
        displayName,
        ok: false,
        error: {
          code: "permission_handler_error",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
    if (answer === "allow") return undefined;
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.toolName,
      displayName,
      ok: false,
      error: {
        code: "permission_denied",
        message: decision.message ?? "Tool execution was denied by user.",
      },
    };
  }

  return {
    toolCallId: toolCall.id,
    toolName: toolCall.toolName,
    displayName,
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

function applyResultBudget(output: unknown, maxChars = DEFAULT_MAX_RESULT_SIZE_CHARS): unknown {
  if (!Number.isFinite(maxChars) || maxChars <= 0 || output === undefined) {
    return output;
  }

  const serialized = typeof output === "string" ? output : safeJsonStringify(output);
  if (serialized.length <= maxChars) {
    return typeof output === "string" ? output : sanitizeForJson(output);
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
