import assert from "node:assert/strict";

const {
  buildMemoryRecallDecision,
  buildMemoryRecallDecisionSection,
} = await import("../../src/modules/agent-loop/memoryRecallDecision.ts");

const weeklyWeatherMemory = {
  id: "memory.session_summary.prior-weather",
  content: JSON.stringify({
    source: "recent_completed_task",
    taskId: "prior-weather",
    query: "未来一周北京天气",
    completedAt: "2026-06-17T02:16:58.000Z",
    summary: {
      finalAnswerPreview:
        "北京未来一周天气：6月18日多云转小雨，气温22到30度；6月19日晴。",
      recentTools: [{ toolName: "WebSearch", ok: true }],
    },
  }),
};

const answerFromMemory = buildMemoryRecallDecision({
  query: "明天北京天气如何？",
  memorySections: [weeklyWeatherMemory],
});

assert.equal(answerFromMemory.decision, "answer_from_memory");
assert.equal(answerFromMemory.coveredBy[0], "prior-weather");
assert(answerFromMemory.confidence >= 0.6);
assert.match(answerFromMemory.instructions, /answer from memory/i);

const refreshRequired = buildMemoryRecallDecision({
  query: "现在北京实时天气如何？",
  memorySections: [weeklyWeatherMemory],
});

assert.equal(refreshRequired.decision, "use_tools");
assert.equal(refreshRequired.freshnessPolicy, "refresh_required");
assert.match(refreshRequired.reason, /fresh|实时|current|最新/i);

const noMemory = buildMemoryRecallDecision({
  query: "台湾海峡当前有哪些飞机？",
  memorySections: [],
});

assert.equal(noMemory.decision, "insufficient");
assert.equal(noMemory.coveredBy.length, 0);

const section = buildMemoryRecallDecisionSection({
  query: "明天北京天气如何？",
  memorySections: [weeklyWeatherMemory],
});

assert(section);
assert.equal(section.id, "memory.recall_decision");
assert.match(section.content, /"decision":"answer_from_memory"/);
assert.match(section.content, /prior-weather/);

console.log("memory recall decision test passed");
