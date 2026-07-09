import assert from "node:assert/strict";

const {
  buildMemoryRecallDecision,
  buildMemoryRecallDecisionSection,
} = await import("../../src/modules/agent-loop/memoryRecallDecision.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMemorySection(id, content) {
  return { id, content };
}

function createSessionSummarySection(taskId, query, summaryText) {
  return createMemorySection(
    `memory.session_summary.${taskId}`,
    JSON.stringify({ taskId, query, summary: { finalAnswerPreview: summaryText } })
  );
}

function createVectorSection(source, id, query, summary, taskId) {
  return createMemorySection(
    `memory.vector.${source}.${id}`,
    JSON.stringify({ source, taskId: taskId ?? id, query, summary, hybridScore: 0.5 })
  );
}

// ---------------------------------------------------------------------------
// Test 1: Vector + keyword hybrid scoring — high vector score boosts result
// ---------------------------------------------------------------------------

{
  const section = createSessionSummarySection(
    "task-weather",
    "北京天气查询",
    "北京未来一周天气：6月18日多云转小雨，气温22到30度"
  );

  // With high vector score, the decision should be answer_from_memory
  // (keyword overlap + vector boost pushes score above threshold)
  const vectorScores = new Map();
  vectorScores.set("memory.session_summary.task-weather", 0.85);

  const decision = buildMemoryRecallDecision({
    query: "明天北京天气如何？",
    memorySections: [section],
    vectorScores,
  });

  assert.equal(
    decision.decision,
    "answer_from_memory",
    "high vector score should boost decision to answer_from_memory"
  );
  assert.ok(decision.confidence >= 0.6, "confidence should be boosted by vector score");

  console.log("Test 1 passed: vector + keyword hybrid scoring works");
}

// ---------------------------------------------------------------------------
// Test 2: No vector scores → falls back to pure keyword scoring
// ---------------------------------------------------------------------------

{
  const section = createSessionSummarySection(
    "task-weather",
    "北京天气查询",
    "北京未来一周天气：6月18日多云转小雨，气温22到30度"
  );

  // Without vector scores, should still work with pure keyword scoring
  const decision = buildMemoryRecallDecision({
    query: "明天北京天气如何？",
    memorySections: [section],
    // no vectorScores
  });

  // Pure keyword should still produce answer_from_memory due to high overlap
  assert.equal(
    decision.decision,
    "answer_from_memory",
    "pure keyword scoring should still work without vector scores"
  );

  console.log("Test 2 passed: no vector scores → pure keyword fallback works");
}

// ---------------------------------------------------------------------------
// Test 3: Entity matching adds to score
// ---------------------------------------------------------------------------

{
  const section = createVectorSection(
    "episodic_memories",
    "ep-1",
    "追踪东海海域溢油源头",
    "溢油源头疑为油轮MMSI:412000001"
  );

  const vectorScores = new Map();
  vectorScores.set("memory.vector.episodic_memories.ep-1", 0.5);

  // With entity matching, score should be higher than without
  const decisionWithEntities = buildMemoryRecallDecision({
    query: "追踪东海溢油源头",
    memorySections: [section],
    vectorScores,
    queryEntities: ["东海", "溢油"],
  });

  const decisionWithoutEntities = buildMemoryRecallDecision({
    query: "追踪东海溢油源头",
    memorySections: [section],
    vectorScores,
    // no queryEntities
  });

  // The decision with entity matching should have >= confidence
  assert.ok(
    decisionWithEntities.confidence >= decisionWithoutEntities.confidence,
    "entity matching should not decrease confidence"
  );

  console.log("Test 3 passed: entity matching adds to score");
}

// ---------------------------------------------------------------------------
// Test 4: buildMemoryRecallDecisionSection passes vectorScores and queryEntities
// ---------------------------------------------------------------------------

{
  const section = createSessionSummarySection(
    "task-eq",
    "花莲地震评估",
    "花莲7.2级地震，影响半径50km"
  );

  const vectorScores = new Map();
  vectorScores.set("memory.session_summary.task-eq", 0.9);

  const result = buildMemoryRecallDecisionSection({
    query: "花莲地震影响范围",
    memorySections: [section],
    vectorScores,
    queryEntities: ["花莲", "地震"],
  });

  assert.ok(result, "section should be defined");
  assert.equal(result.id, "memory.recall_decision");

  const parsed = JSON.parse(result.content);
  assert.ok(parsed.coveredBy.includes("task-eq"), "should cover task-eq");

  console.log("Test 4 passed: buildMemoryRecallDecisionSection with vectorScores works");
}

// ---------------------------------------------------------------------------
// Test 5: Low vector score + low keyword → insufficient
// ---------------------------------------------------------------------------

{
  const section = createVectorSection(
    "episodic_memories",
    "ep-unrelated",
    "查询北京天气",
    "北京今天晴，25度"
  );

  const vectorScores = new Map();
  vectorScores.set("memory.vector.episodic_memories.ep-unrelated", 0.1);

  const decision = buildMemoryRecallDecision({
    query: "台湾海峡船舶位置",
    memorySections: [section],
    vectorScores,
  });

  assert.equal(
    decision.decision,
    "insufficient",
    "low vector + low keyword should be insufficient"
  );

  console.log("Test 5 passed: low scores → insufficient decision");
}

// ---------------------------------------------------------------------------
// Test 6: Vector section IDs are included in recallable sections
// ---------------------------------------------------------------------------

{
  const sessionSection = createSessionSummarySection(
    "task-1",
    "北京天气",
    "北京未来一周天气"
  );
  const vectorSection = createVectorSection(
    "task_conversation_snapshot",
    "snap-1",
    "台湾海峡风场",
    "风速15m/s"
  );

  const vectorScores = new Map();
  vectorScores.set("memory.vector.task_conversation_snapshot.snap-1", 0.8);

  const decision = buildMemoryRecallDecision({
    query: "台湾海峡风场数据",
    memorySections: [sessionSection, vectorSection],
    vectorScores,
  });

  // The vector section should be covered (high vector score + keyword match)
  assert.ok(
    decision.coveredBy.includes("snap-1"),
    "vector section should be covered"
  );

  console.log("Test 6 passed: vector section IDs included in recallable sections");
}

console.log("All memory-recall-decision-upgraded tests passed");
