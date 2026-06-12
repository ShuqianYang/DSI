const MAX_CLOSING_ONLY_CONTENT_CHARS = 160;
const MIN_SUBSTANTIVE_CONTENT_CHARS = 80;

export function chooseAgentLoopDisplayContent(existingContent: string | undefined, incomingContent: string | undefined): string {
  const existing = existingContent?.trim() ?? '';
  const incoming = incomingContent?.trim() ?? '';

  if (!incoming) return existingContent ?? '';
  if (!existing) return incomingContent ?? incoming;
  if (shouldKeepExistingAgentLoopContent(existing, incoming)) return existingContent ?? existing;
  return incomingContent ?? incoming;
}

function shouldKeepExistingAgentLoopContent(existing: string, incoming: string): boolean {
  if (existing.length < MIN_SUBSTANTIVE_CONTENT_CHARS) return false;
  if (incoming.length > MAX_CLOSING_ONLY_CONTENT_CHARS) return false;
  if (incoming.length * 3 >= existing.length && !isClosingOnlyContent(incoming)) return false;
  return isClosingOnlyContent(incoming) || incoming.length < existing.length / 4;
}

function isClosingOnlyContent(content: string): boolean {
  const compact = content.replace(/\s+/g, ' ').trim();
  if (!compact) return false;
  if (/^#{1,6}\s|\|.+\||```/.test(compact)) return false;
  return /以上就是|完整的查询结果|如果您希望|可以告诉我|进一步了解|let me know|hope this helps/i.test(compact);
}
