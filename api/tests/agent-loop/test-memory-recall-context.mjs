import assert from "node:assert/strict";

const { MemoryRecallContext } = await import(
  "../../src/modules/agent-loop/memoryRecallContext.ts"
);

// ---------------------------------------------------------------------------
// Test 1: alreadySurfaced dedup — surfaced sections are filtered out
// ---------------------------------------------------------------------------

{
  const ctx = new MemoryRecallContext();
  const sections = [
    { id: "memory.session_summary.1", content: "A" },
    { id: "memory.session_summary.2", content: "B" },
    { id: "memory.session_summary.3", content: "C" },
  ];

  ctx.markSurfaced(["memory.session_summary.1"]);
  assert.ok(ctx.isAlreadySurfaced("memory.session_summary.1"));
  assert.ok(!ctx.isAlreadySurfaced("memory.session_summary.2"));

  const filtered = ctx.filterCandidates(sections);
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].id, "memory.session_summary.2");
  assert.equal(filtered[1].id, "memory.session_summary.3");

  console.log("Test 1 passed: alreadySurfaced dedup works");
}

// ---------------------------------------------------------------------------
// Test 2: recentTools tracking — tools are recorded after calls
// ---------------------------------------------------------------------------

{
  const ctx = new MemoryRecallContext();

  assert.deepEqual(ctx.getRecentTools(), []);

  ctx.addRecentTool("WeatherFetch");
  ctx.addRecentTool("SatelliteImage");
  ctx.addRecentTool("AisQuery");

  const tools = ctx.getRecentTools();
  assert.equal(tools.length, 3);
  assert.equal(tools[0], "WeatherFetch");
  assert.equal(tools[1], "SatelliteImage");
  assert.equal(tools[2], "AisQuery");

  console.log("Test 2 passed: recentTools tracking works");
}

// ---------------------------------------------------------------------------
// Test 3: maxSurfaced cap — exceeding 50 retains only most recent 30
// ---------------------------------------------------------------------------

{
  const ctx = new MemoryRecallContext({ maxSurfaced: 5, keepRecentN: 3 });

  // Mark 6 sections — exceeds cap of 5
  for (let i = 1; i <= 6; i++) {
    ctx.markSurfaced([`memory.session_summary.${i}`]);
  }

  // After eviction, only the 3 most recent should remain
  assert.ok(!ctx.isAlreadySurfaced("memory.session_summary.1"), "oldest should be evicted");
  assert.ok(!ctx.isAlreadySurfaced("memory.session_summary.2"), "second oldest evicted");
  assert.ok(!ctx.isAlreadySurfaced("memory.session_summary.3"), "third oldest evicted");
  assert.ok(ctx.isAlreadySurfaced("memory.session_summary.4"), "4th should remain");
  assert.ok(ctx.isAlreadySurfaced("memory.session_summary.5"), "5th should remain");
  assert.ok(ctx.isAlreadySurfaced("memory.session_summary.6"), "6th should remain");

  console.log("Test 3 passed: maxSurfaced cap retains most recent entries");
}

// ---------------------------------------------------------------------------
// Test 4: filterCandidates with no surfaced sections returns all
// ---------------------------------------------------------------------------

{
  const ctx = new MemoryRecallContext();
  const sections = [
    { id: "memory.session_summary.A", content: "AAA" },
    { id: "memory.vector.episodic_memories.B", content: "BBB" },
  ];

  const filtered = ctx.filterCandidates(sections);
  assert.equal(filtered.length, 2, "should return all when nothing surfaced");

  console.log("Test 4 passed: filterCandidates returns all when nothing surfaced");
}

// ---------------------------------------------------------------------------
// Test 5: recentTools keeps bounded list
// ---------------------------------------------------------------------------

{
  const ctx = new MemoryRecallContext({ keepRecentN: 3 });

  for (let i = 0; i < 10; i++) {
    ctx.addRecentTool(`Tool${i}`);
  }

  const tools = ctx.getRecentTools();
  assert.equal(tools.length, 3, "should keep only 3 most recent tools");
  assert.equal(tools[0], "Tool7");
  assert.equal(tools[1], "Tool8");
  assert.equal(tools[2], "Tool9");

  console.log("Test 5 passed: recentTools keeps bounded list");
}

console.log("All memory-recall-context tests passed");
