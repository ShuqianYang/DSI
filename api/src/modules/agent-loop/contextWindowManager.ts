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

export const noopContextWindowManager: ContextWindowManager = {
  async prepareMessages(input) {
    return { messages: input.messages };
  },
};

const DEFAULT_CONTEXT_WINDOW_CHARS = parsePositiveIntegerEnv(
  process.env.AGENT_CONTEXT_WINDOW_CHARS,
  120_000,
);
const DEFAULT_SUMMARY_RESERVE_CHARS = parsePositiveIntegerEnv(
  process.env.AGENT_CONTEXT_SUMMARY_RESERVE_CHARS,
  12_000,
);
const DEFAULT_TOOL_MESSAGE_MAX_CHARS = parsePositiveIntegerEnv(
  process.env.AGENT_TOOL_MESSAGE_MAX_CHARS,
  16_000,
);
const MIN_MESSAGES_TO_KEEP = 2;

export const defaultContextWindowManager: ContextWindowManager = {
  async prepareMessages(input) {
    const effectiveBudget = Math.max(
      20_000,
      DEFAULT_CONTEXT_WINDOW_CHARS - DEFAULT_SUMMARY_RESERVE_CHARS,
    );
    const compressedToolMessages = input.messages.map((message) =>
      message.role === "tool" ? truncateMessageContent(message, DEFAULT_TOOL_MESSAGE_MAX_CHARS) : message
    );
    const messages = trimToBudgetPreservingToolGroups(compressedToolMessages, effectiveBudget);
    const diagnostics = buildContextWindowDiagnostics(input.messages, messages, effectiveBudget);
    return {
      messages,
      contextSections: [
        {
          id: "context_window.diagnostics",
          content: JSON.stringify(diagnostics),
        },
      ],
    };
  },
};

function trimToBudgetPreservingToolGroups(messages: AgentMessage[], budgetChars: number): AgentMessage[] {
  if (estimateMessagesChars(messages) <= budgetChars) return messages;
  const groups = groupMessages(messages);
  while (groups.length > MIN_MESSAGES_TO_KEEP && estimateMessagesChars(groups.flat()) > budgetChars) {
    const removableIndex = chooseGroupToRemove(groups);
    if (removableIndex === -1) break;
    groups.splice(removableIndex, 1);
  }
  const trimmed = groups.flat();
  if (estimateMessagesChars(trimmed) <= budgetChars) return trimmed;
  return trimSingleLargeMessages(trimmed, budgetChars);
}

function groupMessages(messages: AgentMessage[]): AgentMessage[][] {
  const groups: AgentMessage[][] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "assistant" && message.toolCalls?.length) {
      const toolCallIds = new Set(message.toolCalls.map((toolCall) => toolCall.id));
      const group = [message];
      let cursor = index + 1;
      while (cursor < messages.length && messages[cursor].role === "tool") {
        const toolMessage = messages[cursor];
        if (!toolMessage.toolCallId || !toolCallIds.has(toolMessage.toolCallId)) break;
        group.push(toolMessage);
        cursor += 1;
      }
      groups.push(group);
      index = cursor - 1;
      continue;
    }
    groups.push([message]);
  }
  return groups;
}

function chooseGroupToRemove(groups: AgentMessage[][]): number {
  const candidates = groups
    .map((group, index) => ({ group, index, chars: estimateMessagesChars(group) }))
    .filter((candidate) => candidate.index > 0 && candidate.index < groups.length - 1);
  if (candidates.length === 0) return -1;

  const toolHeavy = candidates
    .filter((candidate) => candidate.group.some((message) => message.role === "tool"))
    .sort((left, right) => right.chars - left.chars || left.index - right.index);
  if (toolHeavy.length > 0) return toolHeavy[0].index;

  return candidates.sort((left, right) => left.index - right.index)[0].index;
}

function trimSingleLargeMessages(messages: AgentMessage[], budgetChars: number): AgentMessage[] {
  let next = messages.map((message) =>
    message.role === "tool" ? truncateMessageContent(message, DEFAULT_TOOL_MESSAGE_MAX_CHARS) : message
  );
  if (estimateMessagesChars(next) <= budgetChars) return next;

  const nonToolBudget = Math.max(2_000, Math.floor(budgetChars / Math.max(next.length, 1)));
  next = next.map((message) =>
    message.role === "tool" ? message : truncateMessageContent(message, nonToolBudget)
  );
  return next;
}

function truncateMessageContent(message: AgentMessage, maxChars: number): AgentMessage {
  if (message.content.length <= maxChars) return message;
  return {
    ...message,
    content: `${message.content.slice(0, maxChars)}\n\n[truncated ${message.content.length - maxChars} chars by ContextWindowManager]`,
  };
}

function estimateMessagesChars(messages: AgentMessage[]): number {
  return JSON.stringify(messages).length;
}

function buildContextWindowDiagnostics(
  originalMessages: AgentMessage[],
  preparedMessages: AgentMessage[],
  effectiveBudget: number,
): Record<string, unknown> {
  return {
    estimateMethod: "json-chars",
    originalChars: estimateMessagesChars(originalMessages),
    preparedChars: estimateMessagesChars(preparedMessages),
    effectiveBudget,
    removedMessages: originalMessages.length - preparedMessages.length,
    removedTurns: countUserMessages(originalMessages) - countUserMessages(preparedMessages),
  };
}

function countUserMessages(messages: AgentMessage[]): number {
  return messages.filter((message) => message.role === "user").length;
}

function parsePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
