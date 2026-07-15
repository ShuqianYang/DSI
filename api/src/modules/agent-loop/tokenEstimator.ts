/**
 * TokenEstimator (Part C) - 轻量 token 估算工具.
 *
 * Provides a lightweight token count estimation for AgentMessage arrays,
 * consistent with ContextWindowManager's approxTokens approach.
 * Used by SessionMemoryTrigger to decide when to write mid-task checkpoints.
 */

import type { AgentMessage } from "./tools/_shared/types.js";

export interface TokenEstimate {
  totalTokens: number;
  messageCount: number;
  charCount: number;
}

/**
 * Estimate the token count for an array of AgentMessages.
 *
 * Uses the same approach as ContextWindowManager:
 * - latin chars / 4
 * - Han/Hiragana/Katakana/Hangul chars * 1.8
 * - other non-latin chars * 1
 * - JSON serialization overhead included
 */
export function estimateMessagesTokens(messages: AgentMessage[]): TokenEstimate {
  const jsonStr = JSON.stringify(messages);
  const charCount = jsonStr.length;
  const totalTokens = estimateTextApproxTokens(jsonStr);

  return {
    totalTokens,
    messageCount: messages.length,
    charCount,
  };
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
