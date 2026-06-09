import { z } from "zod";
import type { ToolDefinition } from "../_shared/types.js";

const MAX_TOOL_OUTPUT_CHARS = 60_000;

export function buildSleepTool(): ToolDefinition {
  return {
    name: "Sleep",
    description:
      'Wait for a short duration without holding a shell process. Input: {"duration_ms":1000}.',
    kind: "system",
    inputSchema: z.strictObject({
      duration_ms: z.number().int().min(0).max(30_000),
      reason: z.string().optional(),
    }),
    isReadOnly: () => false,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    maxResultSizeChars: MAX_TOOL_OUTPUT_CHARS,
    async execute(input, context) {
      const parsed = input as { duration_ms: number; reason?: string };
      const startedAt = Date.now();
      await sleep(parsed.duration_ms, context.signal);
      return {
        sleptMs: Date.now() - startedAt,
        requestedMs: parsed.duration_ms,
        reason: parsed.reason,
      };
    },
  };
}

function sleep(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new Error(formatAbortReason(signal.reason)));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, durationMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error(formatAbortReason(signal.reason)));
      },
      { once: true },
    );
  });
}

function formatAbortReason(reason: unknown): string {
  return typeof reason === "string" && reason.trim()
    ? `Tool execution aborted: ${reason}`
    : "Tool execution aborted.";
}
