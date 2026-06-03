import type {
  GatewayToolCall,
  ToolExecutionContext,
  ToolObservation,
} from "./types.js";
import type { ToolRegistry } from "./toolRegistry.js";

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

  try {
    const output = await tool.execute(parsed.data, context);
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.toolName,
      ok: true,
      output,
    };
  } catch (error) {
    const errorWithOutput = error as Error & { toolOutput?: unknown };
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.toolName,
      ok: false,
      output: errorWithOutput.toolOutput,
      error: {
        code: "tool_execution_error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
