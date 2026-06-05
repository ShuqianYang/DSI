import type {
  AgentLoopToolUseContext,
  AgentMessage,
  PreparedModelMessages,
} from "./types.js";

export interface PrepareMessagesInput {
  /** Fully rendered model messages before context-window governance. */
  messages: AgentMessage[];
  /** Current loop runtime context, including messages, tool state, and caches. */
  toolUseContext: AgentLoopToolUseContext;
}

export interface ContextWindowManager {
  /**
   * Prepare the exact messages for a model request on every loop iteration.
   * Implement token budget, tool-result budgeting, truncation, compaction,
   * and post-compact reinjection here.
   *
   * Return format:
   * - `messages`: required; this exact array is sent to ModelClient.
   * - `contextSections`: optional diagnostics/future data; runAgentLoop currently ignores it.
   */
  prepareMessages(input: PrepareMessagesInput): Promise<PreparedModelMessages>;
}

type MessageRole = AgentMessage["role"];

type ContextWindowGroupKind =
  | "system"
  | "latest_user"
  | "user_turn"
  | "assistant_tool_group"
  | "assistant"
  | "tool_orphan";

interface ContextWindowMessageGroup {
  id: string;
  kind: ContextWindowGroupKind;
  messages: AgentMessage[];
  startIndex: number;
  priority: number;
  removable: boolean;
  reason: string;
  chars: number;
  approxTokens: number;
}

export interface ContextWindowTrimmedMessage {
  role: MessageRole;
  toolName?: string;
  toolCallId?: string;
  originalChars: number;
  keptChars: number;
  omittedChars: number;
}

export interface ContextWindowRemovedGroup {
  id: string;
  kind: ContextWindowGroupKind;
  reason: string;
  messageCount: number;
  chars: number;
  approxTokens: number;
}

export interface ContextCompactionCandidate {
  id: string;
  kind: ContextWindowGroupKind;
  reason: string;
  messageCount: number;
  chars: number;
  approxTokens: number;
}

export interface ContextWindowDiagnostics {
  estimateMethods: ["json-chars", "approx-tokens"];
  approxTokenMethod: string;
  originalChars: number;
  preparedChars: number;
  originalApproxTokens: number;
  preparedApproxTokens: number;
  effectiveBudgetChars: number;
  effectiveBudgetApproxTokensLatinBaseline: number;
  overBudgetAfterTrim: boolean;
  removedMessages: number;
  removedTurns: number;
  removedGroups: ContextWindowRemovedGroup[];
  trimmedMessages: ContextWindowTrimmedMessage[];
  preservedGroups: Array<{
    id: string;
    kind: ContextWindowGroupKind;
    messageCount: number;
    chars: number;
    approxTokens: number;
  }>;
}

export const noopContextWindowManager: ContextWindowManager = {
  async prepareMessages(input) {
    return { messages: input.messages };
  },
};

const FALLBACK_CONTEXT_WINDOW_CHARS = 120_000;
const FALLBACK_SUMMARY_RESERVE_CHARS = 12_000;
const FALLBACK_TOOL_MESSAGE_MAX_CHARS = 16_000;
const MIN_MESSAGES_TO_KEEP = 2;
const DEFAULT_TOOL_BUDGETS: Record<string, number> = {
  Bash: 12_000,
  Read: 18_000,
  Grep: 14_000,
  Glob: 10_000,
  WebSearch: 16_000,
  WebFetch: 18_000,
  default: 16_000,
};

export const defaultContextWindowManager: ContextWindowManager = {
  async prepareMessages(input) {
    const effectiveBudget = Math.max(
      20_000,
      getContextWindowChars() - getSummaryReserveChars(),
    );
    const toolTrim = truncateToolMessages(input.messages);
    const trimResult = trimToBudgetPreservingToolGroups(toolTrim.messages, effectiveBudget);
    const diagnostics = buildContextWindowDiagnostics({
      originalMessages: input.messages,
      preparedMessages: trimResult.messages,
      effectiveBudget,
      removedGroups: trimResult.removedGroups,
      trimmedMessages: [...toolTrim.trimmedMessages, ...trimResult.trimmedMessages],
    });
    return {
      messages: trimResult.messages,
      contextSections: [
        {
          id: "context_window.diagnostics",
          content: JSON.stringify(diagnostics),
        },
        {
          id: "context_window.compaction_candidates",
          content: JSON.stringify(buildCompactionCandidates(trimResult.preservedGroups)),
        },
      ],
    };
  },
};

function trimToBudgetPreservingToolGroups(messages: AgentMessage[], budgetChars: number): {
  messages: AgentMessage[];
  removedGroups: ContextWindowRemovedGroup[];
  trimmedMessages: ContextWindowTrimmedMessage[];
  preservedGroups: ContextWindowMessageGroup[];
} {
  const groups = groupMessages(messages);
  const removedGroups: ContextWindowRemovedGroup[] = [];
  const trimmedMessages: ContextWindowTrimmedMessage[] = [];

  for (let index = groups.length - 1; index >= 0; index -= 1) {
    if (groups[index]?.kind === "tool_orphan") {
      const [removed] = groups.splice(index, 1);
      removedGroups.push(toRemovedGroup(removed, "orphan tool result removed"));
    }
  }

  while (
    groups.length > MIN_MESSAGES_TO_KEEP &&
    estimateMessagesChars(groups.flatMap((group) => group.messages)) > budgetChars
  ) {
    const removableIndex = chooseGroupToRemove(groups);
    if (removableIndex === -1) break;
    const [removed] = groups.splice(removableIndex, 1);
    removedGroups.push(toRemovedGroup(removed, removed.reason));
  }

  let preparedMessages = groups.flatMap((group) => group.messages);
  if (estimateMessagesChars(preparedMessages) > budgetChars) {
    const singleTrim = trimSingleLargeMessages(preparedMessages, budgetChars);
    preparedMessages = singleTrim.messages;
    trimmedMessages.push(...singleTrim.trimmedMessages);
  }

  return {
    messages: preparedMessages,
    removedGroups,
    trimmedMessages,
    preservedGroups: groupMessages(preparedMessages),
  };
}

function groupMessages(messages: AgentMessage[]): ContextWindowMessageGroup[] {
  const latestUserIndex = findLatestUserIndex(messages);
  const groups: ContextWindowMessageGroup[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "assistant" && message.toolCalls?.length) {
      const toolCallIds = new Set(message.toolCalls.map((toolCall) => toolCall.id));
      const groupMessagesForCall = [message];
      let cursor = index + 1;
      while (cursor < messages.length && messages[cursor].role === "tool") {
        const toolMessage = messages[cursor];
        if (!toolMessage.toolCallId || !toolCallIds.has(toolMessage.toolCallId)) break;
        groupMessagesForCall.push(toolMessage);
        cursor += 1;
      }
      groups.push(buildGroup({
        messages: groupMessagesForCall,
        startIndex: index,
        kind: "assistant_tool_group",
        priority: 60 + Math.min(index, 20),
        removable: index !== 0 && index < messages.length - 1,
        reason: "older assistant/tool group",
      }));
      index = cursor - 1;
      continue;
    }

    if (message.role === "tool") {
      groups.push(buildGroup({
        messages: [message],
        startIndex: index,
        kind: "tool_orphan",
        priority: 5,
        removable: true,
        reason: "orphan tool result",
      }));
      continue;
    }

    if (message.role === "system") {
      groups.push(buildGroup({
        messages: [message],
        startIndex: index,
        kind: "system",
        priority: 1000,
        removable: false,
        reason: "system message must be preserved",
      }));
      continue;
    }

    if (message.role === "user" && index === latestUserIndex) {
      groups.push(buildGroup({
        messages: [message],
        startIndex: index,
        kind: "latest_user",
        priority: 1000,
        removable: false,
        reason: "latest user request must be preserved",
      }));
      continue;
    }

    groups.push(buildGroup({
      messages: [message],
      startIndex: index,
      kind: message.role === "user" ? "user_turn" : "assistant",
      priority: 50 + Math.min(index, 20),
      removable: index > 0 && index < messages.length - 1,
      reason: "older conversation group",
    }));
  }

  return groups;
}

function buildGroup(input: {
  messages: AgentMessage[];
  startIndex: number;
  kind: ContextWindowGroupKind;
  priority: number;
  removable: boolean;
  reason: string;
}): ContextWindowMessageGroup {
  return {
    id: `${input.kind}:${input.startIndex}`,
    kind: input.kind,
    messages: input.messages,
    startIndex: input.startIndex,
    priority: input.priority,
    removable: input.removable,
    reason: input.reason,
    chars: estimateMessagesChars(input.messages),
    approxTokens: estimateMessagesApproxTokens(input.messages),
  };
}

function findLatestUserIndex(messages: AgentMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

function toRemovedGroup(group: ContextWindowMessageGroup, reason: string): ContextWindowRemovedGroup {
  return {
    id: group.id,
    kind: group.kind,
    reason,
    messageCount: group.messages.length,
    chars: group.chars,
    approxTokens: group.approxTokens,
  };
}

function chooseGroupToRemove(groups: ContextWindowMessageGroup[]): number {
  const candidates = groups.filter((group) => group.removable);
  if (candidates.length === 0) return -1;

  const [selected] = candidates.sort((left, right) => {
    const priorityDelta = left.priority - right.priority;
    if (priorityDelta !== 0) return priorityDelta;
    const charsDelta = right.chars - left.chars;
    if (charsDelta !== 0) return charsDelta;
    return left.startIndex - right.startIndex;
  });

  return groups.findIndex((group) => group.id === selected.id);
}

function trimSingleLargeMessages(messages: AgentMessage[], budgetChars: number): {
  messages: AgentMessage[];
  trimmedMessages: ContextWindowTrimmedMessage[];
} {
  const trimmedMessages: ContextWindowTrimmedMessage[] = [];
  let next = [...messages];
  if (estimateMessagesChars(next) <= budgetChars) return { messages: next, trimmedMessages };

  const nonToolBudget = Math.max(2_000, Math.floor(budgetChars / Math.max(next.length, 1)));
  next = next.map((message) => {
    if (message.role === "tool") return message;
    if (message.role === "system" || message.role === "user") return message;
    const result = truncateMessageContent(message, nonToolBudget);
    if (result.trimmed) trimmedMessages.push(result.trimmed);
    return result.message;
  });

  return { messages: next, trimmedMessages };
}

function getToolMessageMaxChars(message: AgentMessage): number {
  if (message.role !== "tool") return Number.POSITIVE_INFINITY;
  const envKey = message.toolName
    ? `AGENT_TOOL_${message.toolName.toUpperCase()}_MAX_CHARS`
    : undefined;
  if (envKey) {
    return parsePositiveIntegerEnv(
      process.env[envKey],
      DEFAULT_TOOL_BUDGETS[message.toolName ?? "default"] ?? getDefaultToolMessageMaxChars(),
    );
  }
  return DEFAULT_TOOL_BUDGETS[message.toolName ?? "default"] ?? getDefaultToolMessageMaxChars();
}

function truncateMessageContent(
  message: AgentMessage,
  maxChars: number,
): { message: AgentMessage; trimmed?: ContextWindowTrimmedMessage } {
  if (message.content.length <= maxChars) return { message };

  const headerLines =
    message.role === "tool"
      ? [
          "[ContextWindowManager truncated tool result]",
          `toolName=${message.toolName ?? "unknown"}`,
          `toolCallId=${message.toolCallId ?? "unknown"}`,
          `originalChars=${message.content.length}`,
          `keptChars=${maxChars}`,
          `omittedChars=${message.content.length - maxChars}`,
          "",
        ]
      : [
          "[ContextWindowManager truncated message]",
          `role=${message.role}`,
          `originalChars=${message.content.length}`,
          `keptChars=${maxChars}`,
          `omittedChars=${message.content.length - maxChars}`,
          "",
        ];

  const nextMessage = {
    ...message,
    content: `${message.content.slice(0, maxChars)}\n\n${headerLines.join("\n")}`,
  };

  return {
    message: nextMessage,
    trimmed: {
      role: message.role,
      toolName: message.toolName,
      toolCallId: message.toolCallId,
      originalChars: message.content.length,
      keptChars: maxChars,
      omittedChars: message.content.length - maxChars,
    },
  };
}

function truncateToolMessages(messages: AgentMessage[]): {
  messages: AgentMessage[];
  trimmedMessages: ContextWindowTrimmedMessage[];
} {
  const trimmedMessages: ContextWindowTrimmedMessage[] = [];
  const nextMessages = messages.map((message) => {
    if (message.role !== "tool") return message;
    const result = truncateMessageContent(message, getToolMessageMaxChars(message));
    if (result.trimmed) trimmedMessages.push(result.trimmed);
    return result.message;
  });
  return { messages: nextMessages, trimmedMessages };
}

function estimateMessagesChars(messages: AgentMessage[]): number {
  return JSON.stringify(messages).length;
}

function estimateTextApproxTokens(text: string): number {
  let latinChars = 0;
  let denseUnicodeChars = 0;
  let otherChars = 0;
  for (const char of text) {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char)) {
      denseUnicodeChars += 1;
    } else if (/[\x00-\x7f]/u.test(char)) {
      latinChars += 1;
    } else {
      otherChars += 1;
    }
  }
  return Math.ceil(latinChars / 4 + denseUnicodeChars * 1.8 + otherChars);
}

function estimateMessagesApproxTokens(messages: AgentMessage[]): number {
  return estimateTextApproxTokens(JSON.stringify(messages));
}

function buildContextWindowDiagnostics(input: {
  originalMessages: AgentMessage[];
  preparedMessages: AgentMessage[];
  effectiveBudget: number;
  removedGroups: ContextWindowRemovedGroup[];
  trimmedMessages: ContextWindowTrimmedMessage[];
}): ContextWindowDiagnostics {
  const preservedGroups = groupMessages(input.preparedMessages).map((group) => ({
    id: group.id,
    kind: group.kind,
    messageCount: group.messages.length,
    chars: group.chars,
    approxTokens: group.approxTokens,
  }));

  return {
    estimateMethods: ["json-chars", "approx-tokens"],
    approxTokenMethod:
      "latin chars/4, Han/Hiragana/Katakana/Hangul chars*1.8, other non-latin chars*1, json overhead included",
    originalChars: estimateMessagesChars(input.originalMessages),
    preparedChars: estimateMessagesChars(input.preparedMessages),
    originalApproxTokens: estimateMessagesApproxTokens(input.originalMessages),
    preparedApproxTokens: estimateMessagesApproxTokens(input.preparedMessages),
    effectiveBudgetChars: input.effectiveBudget,
    effectiveBudgetApproxTokensLatinBaseline: estimateTextApproxTokens("x".repeat(input.effectiveBudget)),
    overBudgetAfterTrim: estimateMessagesChars(input.preparedMessages) > input.effectiveBudget,
    removedMessages: input.originalMessages.length - input.preparedMessages.length,
    removedTurns: countUserMessages(input.originalMessages) - countUserMessages(input.preparedMessages),
    removedGroups: input.removedGroups,
    trimmedMessages: input.trimmedMessages,
    preservedGroups,
  };
}

function buildCompactionCandidates(groups: ContextWindowMessageGroup[]): ContextCompactionCandidate[] {
  return groups
    .filter((group) => group.removable && group.kind !== "latest_user" && group.kind !== "system")
    .sort((left, right) => right.chars - left.chars)
    .slice(0, 8)
    .map((group) => ({
      id: group.id,
      kind: group.kind,
      reason: group.reason,
      messageCount: group.messages.length,
      chars: group.chars,
      approxTokens: group.approxTokens,
    }));
}

function countUserMessages(messages: AgentMessage[]): number {
  return messages.filter((message) => message.role === "user").length;
}

function getContextWindowChars(): number {
  return parsePositiveIntegerEnv(process.env.AGENT_CONTEXT_WINDOW_CHARS, FALLBACK_CONTEXT_WINDOW_CHARS);
}

function getSummaryReserveChars(): number {
  return parsePositiveIntegerEnv(process.env.AGENT_CONTEXT_SUMMARY_RESERVE_CHARS, FALLBACK_SUMMARY_RESERVE_CHARS);
}

function getDefaultToolMessageMaxChars(): number {
  return parsePositiveIntegerEnv(process.env.AGENT_TOOL_MESSAGE_MAX_CHARS, FALLBACK_TOOL_MESSAGE_MAX_CHARS);
}

function parsePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
