import type { z } from "zod";
import type {
  AgentLoopEvent,
  AgentLoopResult,
  AgentMessage,
  AgentRole,
  GatewayToolCall,
  ToolObservation,
  ToolProgressEvent,
} from "@datasourceintelligence/shared";

export type {
  AgentLoopEvent,
  AgentLoopEventType,
  AgentLoopResult,
  AgentMessage,
  AgentRole,
  GatewayToolCall,
  ToolObservation,
  ToolProgressEvent,
} from "@datasourceintelligence/shared";

export interface AgentRuntimeContext {
  taskId: string;
  query: string;
  turn: number;
  maxTurns: number;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  observations: ToolObservation[];
  signal?: AbortSignal;
  toolUseContext: AgentLoopToolUseContext;
}

export interface ToolExecutionContext {
  taskId: string;
  query: string;
  observations: ToolObservation[];
  signal?: AbortSignal;
  onProgress?: (event: ToolProgressEvent) => void;
  toolUseContext?: AgentLoopToolUseContext;
  permissionHandler?: ToolPermissionHandler;
  sandbox?: {
    enabled: boolean;
    kind: "portable";
    reason?: string;
  };
}

export type ToolKind = "system" | "domain" | "skill" | "mcp";
export type ToolRiskLevel = "low" | "medium" | "high";
export type ToolPermissionBehavior = "allow" | "deny" | "ask" | "sandbox";

export interface ToolPermissionDecision<Input = unknown> {
  behavior: ToolPermissionBehavior;
  message?: string;
  updatedInput?: Input;
}

export interface ToolPermissionRequest<Input = unknown> {
  toolName: string;
  input: Input;
  behavior: "ask";
  message: string;
}

export type ToolPermissionAnswer = "allow" | "deny";

export type ToolPermissionHandler = <Input = unknown>(
  request: ToolPermissionRequest<Input>
) => Promise<ToolPermissionAnswer> | ToolPermissionAnswer;

export interface ToolDefinition<Input = unknown, Output = unknown> {
  name: string;
  displayName?: string;
  description: string;
  kind?: ToolKind;
  aliases?: string[];
  inputSchema: z.ZodType<Input>;
  isReadOnly?: (input: Input) => boolean;
  isDestructive?: (input: Input) => boolean;
  isConcurrencySafe?: (input: Input) => boolean;
  riskLevel?: ToolRiskLevel | ((input: Input) => ToolRiskLevel);
  requiresUserInteraction?: boolean | ((input: Input) => boolean);
  maxResultSizeChars?: number;
  validateInput?: (input: Input, context: ToolExecutionContext) => Promise<void> | void;
  checkPermissions?: (
    input: Input,
    context: ToolExecutionContext
  ) => Promise<ToolPermissionDecision<Input>> | ToolPermissionDecision<Input>;
  execute(input: Input, context: ToolExecutionContext): Promise<Output>;
}

export type NormalizedAgentDecision =
  | {
      type: "tool_calls";
      toolCalls: GatewayToolCall[];
      content?: string;
    }
  | {
      type: "final_answer";
      content: string;
    };

export interface PromptSection {
  /**
   * Stable section identifier rendered as a heading by PromptManager.
   * Prefer namespaced ids such as "memory.project.foo" or "skill.listing".
   */
  id: string;
  /**
   * Plain text content to inject into the system prompt's additional context.
   * Keep it model-safe and already-truncated; PromptManager does not parse JSON.
   */
  content: string;
}

export interface AgentLoopToolUseContext {
  taskId: string;
  query: string;
  messages: AgentMessage[];
  observations: ToolObservation[];
  options: {
    tools: ToolDefinition[];
    mainLoopModel?: string;
    refreshTools?: () => ToolDefinition[];
  };
  signal?: AbortSignal;
  readFileState: Map<string, unknown>;
  todoState: AgentTodoItem[];
  planModeState?: {
    enabled: boolean;
    plan?: string;
    updatedAt: string;
  };
  nestedMemoryAttachmentTriggers: Set<string>;
  dynamicSkillDirTriggers: Set<string>;
  discoveredSkillNames: Set<string>;
  invokedSkillSections: PromptSection[];
  skillAllowedToolNames?: Set<string>;
  skillAllowedToolsExpiresOnTurn?: number;
  skillManager?: {
    discoverSkillDirsForPaths?(filePaths: string[], cwd: string): Promise<string[]>;
    activateConditionalSkillsForPaths?(filePaths: string[], cwd: string): string[];
  };
}

export interface AgentTodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

export interface PreparedModelMessages {
  /**
   * The exact messages sent to ModelClient. This must preserve valid tool-call
   * adjacency: assistant toolCalls must remain followed by matching tool messages.
   */
  messages: AgentMessage[];
  /**
   * Reserved for diagnostics/future callers. runAgentLoop currently ignores this field;
   * put actual model-visible context into `messages`.
   */
  contextSections?: PromptSection[];
}

export interface AgentLoopPrefetch {
  /**
   * Async work result. Resolve to sections to inject on a later turn; resolve to []
   * when nothing should be injected. Reject only for unrecoverable implementation bugs.
   */
  promise: Promise<PromptSection[]>;
  /**
   * null while pending; set to Date.now() when settled. The loop only consumes
   * memory prefetches when this is non-null.
   */
  settledAt: number | null;
  /**
   * -1 until consumed. The loop sets this to the zero-based iteration where it
   * consumed the result to avoid duplicate injection.
   */
  consumedOnIteration: number;
  /** Optional cleanup hook for aborting side work or releasing handles. */
  dispose?: () => void;
}

