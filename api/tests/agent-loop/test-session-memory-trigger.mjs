import assert from "node:assert/strict";

const { createSessionMemoryTrigger } = await import(
  "../../src/modules/agent-loop/sessionMemoryTrigger.ts"
);

// ---------------------------------------------------------------------------
// Test 1: Below minTokensToInit → never triggers
// ---------------------------------------------------------------------------

{
  const trigger = createSessionMemoryTrigger({
    minTokensToInit: 30_000,
    minTokensBetweenUpdate: 5_000,
    minToolCallsBetweenUpdate: 3,
  });

  // Simulate being below the init threshold
  trigger.updateTokenEstimate(10_000);
  trigger.recordToolCalls(5);

  const shouldTrigger = trigger.shouldTrigger({
    currentTurn: 3,
    isNaturalBreakpoint: true,
  });

  assert.equal(shouldTrigger, false, "should not trigger below minTokensToInit");

  const state = trigger.getState();
  assert.equal(state.initialized, false, "should not be initialized");

  console.log("Test 1 passed: below minTokensToInit → no trigger");
}

// ---------------------------------------------------------------------------
// Test 2: Above minTokensToInit but increment insufficient → no trigger
// ---------------------------------------------------------------------------

{
  const trigger = createSessionMemoryTrigger({
    minTokensToInit: 30_000,
    minTokensBetweenUpdate: 5_000,
    minToolCallsBetweenUpdate: 3,
  });

  // First update to set baseline
  trigger.updateTokenEstimate(35_000);

  // Small increment (only 1000 tokens, threshold is 5000)
  trigger.updateTokenEstimate(36_000);
  trigger.recordToolCalls(1);

  const shouldTrigger = trigger.shouldTrigger({
    currentTurn: 2,
    isNaturalBreakpoint: true,
  });

  assert.equal(shouldTrigger, false, "should not trigger with insufficient token increment");

  const state = trigger.getState();
  assert.equal(state.initialized, true, "should be initialized after crossing threshold");

  console.log("Test 2 passed: above init but insufficient increment → no trigger");
}

// ---------------------------------------------------------------------------
// Test 3: Above init + sufficient token increment + sufficient tool calls → trigger
// ---------------------------------------------------------------------------

{
  const trigger = createSessionMemoryTrigger({
    minTokensToInit: 30_000,
    minTokensBetweenUpdate: 5_000,
    minToolCallsBetweenUpdate: 3,
  });

  trigger.updateTokenEstimate(35_000);
  // Increment by 6000 tokens (above 5000 threshold)
  trigger.updateTokenEstimate(41_000);
  trigger.recordToolCalls(4); // above 3 threshold

  const shouldTrigger = trigger.shouldTrigger({
    currentTurn: 3,
    isNaturalBreakpoint: false,
  });

  assert.equal(shouldTrigger, true, "should trigger with sufficient increments + tool calls");

  console.log("Test 3 passed: sufficient increments + tool calls → trigger");
}

// ---------------------------------------------------------------------------
// Test 4: Above init + sufficient tokens + natural breakpoint (but insufficient tool calls) → trigger
// ---------------------------------------------------------------------------

{
  const trigger = createSessionMemoryTrigger({
    minTokensToInit: 30_000,
    minTokensBetweenUpdate: 5_000,
    minToolCallsBetweenUpdate: 3,
  });

  trigger.updateTokenEstimate(35_000);
  trigger.updateTokenEstimate(41_000); // +6000 tokens
  trigger.recordToolCalls(1); // only 1 tool call, below threshold of 3

  const shouldTrigger = trigger.shouldTrigger({
    currentTurn: 2,
    isNaturalBreakpoint: true, // natural breakpoint overrides tool call threshold
  });

  assert.equal(shouldTrigger, true, "should trigger with natural breakpoint even with few tool calls");

  console.log("Test 4 passed: natural breakpoint + sufficient tokens → trigger");
}

// ---------------------------------------------------------------------------
// Test 5: Above init + sufficient tokens + no natural breakpoint + insufficient tool calls → no trigger
// ---------------------------------------------------------------------------

{
  const trigger = createSessionMemoryTrigger({
    minTokensToInit: 30_000,
    minTokensBetweenUpdate: 5_000,
    minToolCallsBetweenUpdate: 3,
  });

  trigger.updateTokenEstimate(35_000);
  trigger.updateTokenEstimate(41_000); // +6000 tokens
  trigger.recordToolCalls(1); // only 1 tool call

  const shouldTrigger = trigger.shouldTrigger({
    currentTurn: 2,
    isNaturalBreakpoint: false, // no natural breakpoint
  });

  assert.equal(shouldTrigger, false, "should not trigger without natural breakpoint or sufficient tool calls");

  console.log("Test 5 passed: no breakpoint + insufficient tool calls → no trigger");
}

// ---------------------------------------------------------------------------
// Test 6: markCheckpoint resets increment counters
// ---------------------------------------------------------------------------

{
  const trigger = createSessionMemoryTrigger({
    minTokensToInit: 30_000,
    minTokensBetweenUpdate: 5_000,
    minToolCallsBetweenUpdate: 3,
  });

  trigger.updateTokenEstimate(35_000);
  trigger.updateTokenEstimate(41_000);
  trigger.recordToolCalls(5);

  // Trigger and mark checkpoint
  trigger.shouldTrigger({ currentTurn: 3, isNaturalBreakpoint: true });
  trigger.markCheckpoint(3);

  const state = trigger.getState();
  assert.equal(state.tokensSinceLastCheckpoint, 0, "tokens should be reset");
  assert.equal(state.toolCallsSinceLastCheckpoint, 0, "tool calls should be reset");
  assert.equal(state.lastCheckpointTurn, 3);
  assert.equal(state.checkpointCount, 1);

  console.log("Test 6 passed: markCheckpoint resets increment counters");
}

// ---------------------------------------------------------------------------
// Test 7: Multiple checkpoints accumulate correctly
// ---------------------------------------------------------------------------

{
  const trigger = createSessionMemoryTrigger({
    minTokensToInit: 30_000,
    minTokensBetweenUpdate: 5_000,
    minToolCallsBetweenUpdate: 3,
  });

  // First checkpoint
  trigger.updateTokenEstimate(35_000);
  trigger.updateTokenEstimate(41_000);
  trigger.recordToolCalls(4);
  assert.ok(trigger.shouldTrigger({ currentTurn: 3, isNaturalBreakpoint: false }));
  trigger.markCheckpoint(3);

  // Second checkpoint
  trigger.updateTokenEstimate(47_000); // +6000 from last
  trigger.recordToolCalls(4);
  assert.ok(trigger.shouldTrigger({ currentTurn: 5, isNaturalBreakpoint: false }));
  trigger.markCheckpoint(5);

  const state = trigger.getState();
  assert.equal(state.checkpointCount, 2, "should have 2 checkpoints");
  assert.equal(state.lastCheckpointTurn, 5);

  console.log("Test 7 passed: multiple checkpoints accumulate correctly");
}

// ---------------------------------------------------------------------------
// Test 8: Default config values
// ---------------------------------------------------------------------------

{
  const trigger = createSessionMemoryTrigger(); // no config, use defaults

  trigger.updateTokenEstimate(31_000);
  // Need 5000 token increment
  trigger.updateTokenEstimate(36_001);
  trigger.recordToolCalls(3);

  const shouldTrigger = trigger.shouldTrigger({
    currentTurn: 1,
    isNaturalBreakpoint: false,
  });

  assert.equal(shouldTrigger, true, "default config should trigger with 30K+ tokens and 5K+ increment");

  console.log("Test 8 passed: default config values work");
}

console.log("All session-memory-trigger tests passed");
