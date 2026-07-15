/**
 * SessionMemoryTrigger (Part C) - 三阈值触发逻辑.
 *
 * Determines when to write mid-task checkpoints for long-running tasks.
 * Uses three thresholds:
 * 1. minTokensToInit — total tokens must exceed this to enable checkpointing
 * 2. minTokensBetweenUpdate — token increment since last checkpoint
 * 3. minToolCallsBetweenUpdate — tool call increment since last checkpoint
 *
 * Inspired by Claude Code's session memory strategy, adapted for DSI's
 * shorter tasks with higher thresholds (default 30K vs 10K).
 */

export interface SessionMemoryTriggerConfig {
  /** 会话 token 总量达到此值才启用中途提取。DSI 默认 30000 */
  minTokensToInit: number;
  /** 增量 token 达到此值才再次提取。默认 5000 */
  minTokensBetweenUpdate: number;
  /** 增量工具调用达到此值才再次提取。默认 3 */
  minToolCallsBetweenUpdate: number;
}

export interface SessionMemoryTriggerState {
  initialized: boolean;
  estimatedTotalTokens: number;
  tokensSinceLastCheckpoint: number;
  toolCallsSinceLastCheckpoint: number;
  lastCheckpointTurn: number;
  checkpointCount: number;
}

export interface CheckTriggerInput {
  currentTurn: number;
  isNaturalBreakpoint: boolean;
}

export interface SessionMemoryTrigger {
  /** Check if a mid-task checkpoint should be written. Returns true if so. */
  shouldTrigger(input: CheckTriggerInput): boolean;
  /** Mark that a checkpoint was written, resetting increment counters. */
  markCheckpoint(turn: number): void;
  /** Get current state (for diagnostics). */
  getState(): SessionMemoryTriggerState;
  /** Update the token estimate and compute increment (called each turn). */
  updateTokenEstimate(totalTokens: number): void;
  /** Record tool calls that happened since the last checkpoint. */
  recordToolCalls(count: number): void;
}

const DEFAULT_CONFIG: SessionMemoryTriggerConfig = {
  minTokensToInit: 30_000,
  minTokensBetweenUpdate: 5_000,
  minToolCallsBetweenUpdate: 3,
};

export function createSessionMemoryTrigger(
  config?: Partial<SessionMemoryTriggerConfig>
): SessionMemoryTrigger {
  const effectiveConfig: SessionMemoryTriggerConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  const state: SessionMemoryTriggerState = {
    initialized: false,
    estimatedTotalTokens: 0,
    tokensSinceLastCheckpoint: 0,
    toolCallsSinceLastCheckpoint: 0,
    lastCheckpointTurn: 0,
    checkpointCount: 0,
  };

  return {
    shouldTrigger(input: CheckTriggerInput): boolean {
      // 1. Must exceed the initialization threshold
      if (state.estimatedTotalTokens < effectiveConfig.minTokensToInit) {
        return false;
      }

      // 2. First time crossing the threshold — mark as initialized
      if (!state.initialized) {
        state.initialized = true;
      }

      // 3. Check trigger conditions:
      //    - token increment must be sufficient
      //    - AND (tool call increment sufficient OR natural breakpoint)
      const tokenThresholdMet =
        state.tokensSinceLastCheckpoint >= effectiveConfig.minTokensBetweenUpdate;

      const toolCallThresholdMet =
        state.toolCallsSinceLastCheckpoint >= effectiveConfig.minToolCallsBetweenUpdate;

      return tokenThresholdMet && (toolCallThresholdMet || input.isNaturalBreakpoint);
    },

    markCheckpoint(turn: number): void {
      state.tokensSinceLastCheckpoint = 0;
      state.toolCallsSinceLastCheckpoint = 0;
      state.lastCheckpointTurn = turn;
      state.checkpointCount += 1;
    },

    getState(): SessionMemoryTriggerState {
      return { ...state };
    },

    updateTokenEstimate(totalTokens: number): void {
      // Compute the increment from the last estimate
      if (state.estimatedTotalTokens > 0) {
        state.tokensSinceLastCheckpoint += Math.max(0, totalTokens - state.estimatedTotalTokens);
      }
      state.estimatedTotalTokens = totalTokens;
    },

    recordToolCalls(count: number): void {
      state.toolCallsSinceLastCheckpoint += count;
    },
  };
}

/**
 * Create a SessionMemoryTrigger from environment variables.
 * Returns undefined when AGENT_MEMORY_CHECKPOINT_ENABLED != "1".
 */
export function createSessionMemoryTriggerFromEnv(): SessionMemoryTrigger | undefined {
  const enabled = process.env.AGENT_MEMORY_CHECKPOINT_ENABLED;
  if (enabled !== "1" && enabled !== "true") return undefined;

  return createSessionMemoryTrigger({
    minTokensToInit: parsePositiveInt(
      process.env.AGENT_MEMORY_CHECKPOINT_MIN_TOKENS,
      30_000
    ),
    minTokensBetweenUpdate: parsePositiveInt(
      process.env.AGENT_MEMORY_CHECKPOINT_MIN_TOKENS_BETWEEN,
      5_000
    ),
    minToolCallsBetweenUpdate: parsePositiveInt(
      process.env.AGENT_MEMORY_CHECKPOINT_MIN_TOOL_CALLS_BETWEEN,
      3
    ),
  });
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
