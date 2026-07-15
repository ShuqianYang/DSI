import assert from "node:assert/strict";

const {
  entriesToConversationMessages,
  summarizeTranscriptForContext,
} = await import("../../src/modules/agent-loop/transcriptStore.ts");

const taskId = "11111111-1111-1111-1111-111111111111";
const longFinalAnswer = `Final answer: ${"Taiwan Strait status ".repeat(40)}`;
const entries = [
  {
    taskId,
    turn: 1,
    sequence: 1,
    kind: "model_request",
    messages: [
      { role: "system", content: "system prompt" },
      { role: "user", content: "mark Taiwan Strait and fetch weather" },
    ],
  },
  {
    taskId,
    turn: 1,
    sequence: 2,
    kind: "assistant_message",
    message: {
      role: "assistant",
      content: "I will resolve and mark the region.",
      toolCalls: [
        {
          id: "call-region-1",
          toolName: "RegionMark",
          input: { bbox: { west: 118, south: 22, east: 122, north: 26 } },
        },
      ],
    },
  },
  {
    taskId,
    turn: 1,
    sequence: 3,
    kind: "tool_message",
    message: {
      role: "tool",
      toolCallId: "call-region-1",
      toolName: "RegionMark",
      content: JSON.stringify({
        toolCallId: "call-region-1",
        toolName: "RegionMark",
        ok: true,
        output: { gisData: { cameraView: { type: "fit-bbox" } } },
      }),
    },
  },
  {
    taskId,
    turn: 2,
    sequence: 4,
    kind: "tool_message",
    message: {
      role: "tool",
      toolCallId: "call-weather-1",
      toolName: "WeatherFetch",
      content: JSON.stringify({
        toolCallId: "call-weather-1",
        toolName: "WeatherFetch",
        ok: false,
        error: { code: "upstream_unavailable", message: "weather API unavailable" },
      }),
    },
  },
  {
    taskId,
    turn: 2,
    sequence: 5,
    kind: "assistant_message",
    message: {
      role: "assistant",
      content: longFinalAnswer,
    },
  },
  {
    taskId,
    turn: 2,
    sequence: 6,
    kind: "loop_stop",
    stoppedBy: "final_answer",
    finalAnswer: longFinalAnswer,
  },
];

{
  const messages = entriesToConversationMessages(entries);

  assert.equal(messages.length, 4);
  assert.deepEqual(
    messages.map((message) => message.role),
    ["assistant", "tool", "tool", "assistant"]
  );
  assert.equal(messages[0].toolCalls[0].toolName, "RegionMark");
  assert.equal(messages[1].toolName, "RegionMark");
  assert.equal(messages[2].toolName, "WeatherFetch");
  assert.equal(messages[3].content, longFinalAnswer);
  assert(!messages.some((message) => message.role === "user"));
}

{
  const messages = entriesToConversationMessages([
    ...entries,
    {
      taskId,
      turn: 3,
      sequence: 7,
      kind: "assistant_message",
      message: { role: "user", content: "invalid replay role" },
    },
  ]);

  assert.equal(messages.length, 4);
}

{
  const section = summarizeTranscriptForContext(entries);

  assert(section);
  assert.equal(section.id, "transcript.resume_context");
  assert(section.content.length < 4000);
  assert(!section.content.includes("system prompt"));

  const summary = JSON.parse(section.content);
  assert.equal(summary.taskId, taskId);
  assert.equal(summary.totalEntries, entries.length);
  assert.equal(summary.stoppedBy, "final_answer");
  assert(summary.finalAnswerPreview.startsWith("Final answer:"));
  assert(summary.lastAssistantAnswerPreview.startsWith("Final answer:"));
  assert(summary.finalAnswerPreview.length < longFinalAnswer.length);
  assert.deepEqual(summary.recentTools, [
    {
      toolName: "RegionMark",
      toolCallId: "call-region-1",
      ok: true,
      error: null,
    },
    {
      toolName: "WeatherFetch",
      toolCallId: "call-weather-1",
      ok: false,
      error: "weather API unavailable",
    },
  ]);
}

assert.equal(summarizeTranscriptForContext([]), undefined);

{
  const hugeText = "x".repeat(20_000);
  const section = summarizeTranscriptForContext([
    {
      taskId,
      turn: 1,
      sequence: 1,
      kind: "assistant_message",
      message: {
        role: "assistant",
        content: hugeText,
      },
    },
    {
      taskId,
      turn: 1,
      sequence: 2,
      kind: "loop_stop",
      stoppedBy: "model_error",
      finalAnswer: hugeText,
      error: hugeText,
    },
  ]);

  assert(section);
  assert(section.content.length < 4000);

  const summary = JSON.parse(section.content);
  assert.equal(summary.taskId, taskId);
  assert.equal(summary.stoppedBy, "model_error");
  assert(summary.error.length < hugeText.length);
  assert(summary.error.endsWith("..."));
  assert(summary.finalAnswerPreview.length < hugeText.length);
  assert(summary.lastAssistantAnswerPreview.length < hugeText.length);
}

{
  const hugeError = "tool failure ".repeat(1_000);
  const section = summarizeTranscriptForContext([
    ...Array.from({ length: 20 }, (_, index) => ({
      taskId,
      turn: index + 1,
      sequence: index + 1,
      kind: "tool_message",
      message: {
        role: "tool",
        toolCallId: `call-${index}`,
        toolName: `Tool${index}`,
        content: JSON.stringify({
          toolCallId: `call-${index}`,
          toolName: `Tool${index}`,
          ok: false,
          error: { message: hugeError },
        }),
      },
    })),
    {
      taskId,
      turn: 21,
      sequence: 21,
      kind: "loop_stop",
      stoppedBy: "max_turns",
      finalAnswer: "Maximum turns reached.",
    },
  ]);

  assert(section);
  assert(section.content.length < 4000);

  const summary = JSON.parse(section.content);
  assert.equal(summary.stoppedBy, "max_turns");
  assert(summary.recentTools.length <= 5);
  assert(summary.recentTools.every((tool) => tool.error.length < hugeError.length));
}

console.log("transcript read model test passed");
