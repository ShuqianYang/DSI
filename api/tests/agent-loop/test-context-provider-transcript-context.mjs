import assert from "node:assert/strict";

const { getTranscriptContextSections } = await import(
  "../../src/modules/agent-loop/contextProvider.ts"
);
const {
  buildContextProviderDiagnostics,
  loadTranscriptContextSections,
} = await import("../../src/modules/agent-loop/contextProvider.ts");

const taskId = "11111111-1111-1111-1111-111111111111";
const otherTaskId = "22222222-2222-2222-2222-222222222222";

{
  const loadedTaskIds = [];
  const store = {
    async append() {
      throw new Error("append should not be called");
    },
    async load(requestedTaskId) {
      loadedTaskIds.push(requestedTaskId);
      return [
        {
          taskId: requestedTaskId,
          turn: 1,
          sequence: 1,
          kind: "model_request",
          messages: [
            { role: "system", content: "full system prompt should stay out" },
            { role: "user", content: "full user prompt should stay out" },
          ],
        },
        {
          taskId: requestedTaskId,
          turn: 1,
          sequence: 2,
          kind: "tool_message",
          message: {
            role: "tool",
            toolCallId: "call-weather-1",
            toolName: "WeatherFetch",
            content: JSON.stringify({
              toolCallId: "call-weather-1",
              toolName: "WeatherFetch",
              ok: true,
            }),
          },
        },
        {
          taskId: requestedTaskId,
          turn: 2,
          sequence: 3,
          kind: "assistant_message",
          message: {
            role: "assistant",
            content: "Weather context is ready.",
          },
        },
        {
          taskId: requestedTaskId,
          turn: 2,
          sequence: 4,
          kind: "loop_stop",
          stoppedBy: "final_answer",
          finalAnswer: "Weather context is ready.",
        },
      ];
    },
  };

  const result = await loadTranscriptContextSections(taskId, { transcriptStore: store });
  const sections = result.sections;

  assert.equal(result.status, "loaded");
  assert.deepEqual(loadedTaskIds, [taskId]);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].id, "transcript.resume_context");
  assert(sections[0].content.length < 4000);
  assert(!sections[0].content.includes("full system prompt"));
  assert(!sections[0].content.includes("full user prompt"));

  const summary = JSON.parse(sections[0].content);
  assert.equal(summary.taskId, taskId);
  assert.equal(summary.stoppedBy, "final_answer");
  assert.equal(summary.totalEntries, 4);
  assert.deepEqual(summary.recentTools, [
    {
      toolName: "WeatherFetch",
      toolCallId: "call-weather-1",
      ok: true,
      error: null,
    },
  ]);

  const otherSections = await getTranscriptContextSections(otherTaskId, store);
  assert.equal(JSON.parse(otherSections[0].content).taskId, otherTaskId);
  assert.deepEqual(loadedTaskIds, [taskId, otherTaskId]);
}

{
  const warnings = [];
  const store = {
    async append() {
      throw new Error("append should not be called");
    },
    async load() {
      throw new Error("transcript table unavailable");
    },
  };

  const result = await loadTranscriptContextSections(taskId, {
    transcriptStore: store,
    logger: { warn: (...args) => warnings.push(args) },
  });

  assert.deepEqual(result.sections, []);
  assert.equal(result.status, "failed");
  assert.equal(result.error, "transcript table unavailable");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], "[ContextProvider] transcript context load failed:");
}

{
  const store = {
    async append() {
      throw new Error("append should not be called");
    },
    async load() {
      return [];
    },
  };

  const result = await loadTranscriptContextSections(taskId, { transcriptStore: store });

  assert.deepEqual(result.sections, []);
  assert.equal(result.status, "empty");
}

{
  let factoryCalls = 0;
  const result = await loadTranscriptContextSections(taskId, {
    async createTranscriptStore() {
      factoryCalls += 1;
      return {
        async append() {
          throw new Error("append should not be called");
        },
        async load(requestedTaskId) {
          return [
            {
              taskId: requestedTaskId,
              turn: 1,
              sequence: 1,
              kind: "loop_stop",
              stoppedBy: "final_answer",
              finalAnswer: "Loaded through factory.",
            },
          ];
        },
      };
    },
  });

  assert.equal(factoryCalls, 1);
  assert.equal(result.status, "loaded");
  assert.equal(JSON.parse(result.sections[0].content).finalAnswerPreview, "Loaded through factory.");
}

{
  const warnings = [];
  const result = await loadTranscriptContextSections(taskId, {
    async createTranscriptStore() {
      throw new Error("factory failed");
    },
    logger: { warn: (...args) => warnings.push(args) },
  });

  assert.deepEqual(result.sections, []);
  assert.equal(result.status, "failed");
  assert.equal(result.error, "factory failed");
  assert.equal(warnings.length, 1);
}

{
  const loadedDiagnostics = buildContextProviderDiagnostics({
    sections: [{ id: "transcript.resume_context", content: "{}" }],
    domainLoaded: true,
    databaseDescriptionLoaded: true,
    adrIndexLoaded: true,
    taskSectionCount: 1,
    transcriptContextStatus: "loaded",
  });
  assert.equal(loadedDiagnostics.transcriptContextStatus, "loaded");
  assert(!loadedDiagnostics.skippedSources.includes("transcript.resume_context.empty"));
  assert(!loadedDiagnostics.skippedSources.includes("transcript.resume_context.failed"));

  const emptyDiagnostics = buildContextProviderDiagnostics({
    sections: [],
    domainLoaded: true,
    databaseDescriptionLoaded: true,
    adrIndexLoaded: true,
    taskSectionCount: 1,
    transcriptContextStatus: "empty",
  });
  assert(emptyDiagnostics.skippedSources.includes("transcript.resume_context.empty"));

  const failedDiagnostics = buildContextProviderDiagnostics({
    sections: [],
    domainLoaded: true,
    databaseDescriptionLoaded: true,
    adrIndexLoaded: true,
    taskSectionCount: 1,
    transcriptContextStatus: "failed",
  });
  assert(failedDiagnostics.skippedSources.includes("transcript.resume_context.failed"));
}

console.log("context provider transcript context test passed");
