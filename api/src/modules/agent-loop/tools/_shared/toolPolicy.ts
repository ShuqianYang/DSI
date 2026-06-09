import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolPermissionDecision,
  ToolRiskLevel,
} from "./types.js";

export function decideDefaultToolPolicy<Input>(
  tool: ToolDefinition<Input>,
  input: Input,
  _context: ToolExecutionContext,
): ToolPermissionDecision<Input> {
  if (tool.name === "Bash") {
    return {
      behavior: "sandbox",
      message:
        "Bash commands run in the portable workspace sandbox by default. This MVP enforces workspace cwd, restricted env, timeout/output limits, and command policy checks.",
    };
  }

  const destructive = safeBooleanCall(tool.isDestructive, input);
  if (destructive || tool.name === "Write" || tool.name === "Edit") {
    return {
      behavior: "ask",
      message: `${tool.name} may modify workspace files. Allow this tool call?`,
    };
  }

  const requiresUserInteraction =
    typeof tool.requiresUserInteraction === "function"
      ? safeBooleanCall(tool.requiresUserInteraction, input)
      : tool.requiresUserInteraction === true;
  if (requiresUserInteraction) {
    return {
      behavior: "ask",
      message: `${tool.name} requires user interaction. Allow this tool call?`,
    };
  }

  const riskLevel = resolveRiskLevel(tool.riskLevel, input);
  if (riskLevel === "high") {
    return {
      behavior: "ask",
      message: `${tool.name} is a high-risk tool call. Allow execution?`,
    };
  }

  return { behavior: "allow" };
}

function resolveRiskLevel<Input>(
  riskLevel: ToolRiskLevel | ((input: Input) => ToolRiskLevel) | undefined,
  input: Input,
): ToolRiskLevel | undefined {
  if (typeof riskLevel === "function") {
    return riskLevel(input);
  }
  return riskLevel;
}

function safeBooleanCall<Input>(
  callback: ((input: Input) => boolean) | undefined,
  input: Input,
): boolean {
  if (!callback) return false;
  try {
    return callback(input);
  } catch {
    return false;
  }
}
