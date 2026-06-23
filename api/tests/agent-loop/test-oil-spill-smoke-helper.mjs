import assert from "node:assert/strict";

const {
  createOilSpillMockSmokeModelClient,
  installMockOilSpillMockFetch,
  OIL_SPILL_MOCK_QUERY,
  OIL_SPILL_MOCK_SCENARIO,
  OIL_SPILL_MOCK_TOOLS,
  validateOilSpillMockSmoke,
} = await import("../../scripts/agent-loop/agent-loop-smoke-oil-spill-mock.ts");

const MOCK_TOOL_ORDER = [
  "Skill",
  "OilSpillDetectMock",
  "WeatherFetchMock",
  "OilDriftTraceMock",
  "AisFetchMock",
  "AisMatchSuspectsMock",
  "AisSuspectRankingMock",
];

assert.equal(OIL_SPILL_MOCK_SCENARIO, "oil-spill-mock");
assert.equal(OIL_SPILL_MOCK_QUERY, "查询东海漏油并匹配疑似肇事船");
assert.deepEqual([...OIL_SPILL_MOCK_TOOLS], MOCK_TOOL_ORDER.slice(1));

{
  const client = createOilSpillMockSmokeModelClient();
  const firstDecision = await client.decide({
    messages: [],
    tools: [],
    query: OIL_SPILL_MOCK_QUERY,
    observations: [],
    callId: "call-1",
  });

  assert.equal(firstDecision.type, "tool_calls");
  assert.equal(firstDecision.toolCalls[0].toolName, "Skill");
  assert.equal(firstDecision.toolCalls[0].input.skill, "oil-spill-tracing");
}

{
  const client = createOilSpillMockSmokeModelClient();
  const secondDecision = await client.decide({
    messages: [],
    tools: [],
    query: OIL_SPILL_MOCK_QUERY,
    observations: [observation("Skill", { success: true })],
    callId: "call-2",
  });

  assert.equal(secondDecision.type, "tool_calls");
  assert.equal(secondDecision.toolCalls[0].toolName, "OilSpillDetectMock");
  assert.equal(secondDecision.toolCalls[0].input.region, "中国东海");
}

{
  const client = createOilSpillMockSmokeModelClient();
  const nextDecision = await client.decide({
    messages: [],
    tools: [],
    query: OIL_SPILL_MOCK_QUERY,
    observations: [
      observation("Skill", { success: true }),
      observation("OilSpillDetectMock", { shouldContinue: true, gisData: {} }),
      observation("WeatherFetchMock", { gisData: {} }),
    ],
    callId: "call-3",
  });

  assert.equal(nextDecision.type, "tool_calls");
  assert.equal(nextDecision.toolCalls[0].toolName, "OilDriftTraceMock");
}

{
  const restore = installMockOilSpillMockFetch();
  try {
    const response = await fetch("http://example.test/agent/queryData", { method: "POST", body: "{}" });
    assert.equal(response.ok, true);
    assert.deepEqual(await response.json(), { state: true, value: { records: [] } });
  } finally {
    restore();
  }
}

{
  const report = validateOilSpillMockSmoke({
    rawEvents: [
      toolObservationEvent("Skill", { success: true }),
      toolObservationEvent("OilSpillDetectMock", {
        shouldContinue: true,
        imageSource: "local-fallback",
        gisData: { type: "region" },
      }),
      toolObservationEvent("WeatherFetchMock", { gisData: { type: "wind-field" } }),
      toolObservationEvent("OilDriftTraceMock", { gisData: { type: "trajectory" } }),
      toolObservationEvent("AisFetchMock", { gisData: { type: "entity" } }),
      toolObservationEvent("AisMatchSuspectsMock", { gisData: { type: "entity" } }),
      toolObservationEvent("AisSuspectRankingMock", {
        primary: [{ mmsi: "413567890", score: 86 }],
        gisData: { type: "entity" },
      }),
      {
        type: "loop_stop",
        taskId: "task",
        turn: 8,
        result: {
          stoppedBy: "final_answer",
          turns: 8,
          finalAnswer: "ok",
          observations: [],
        },
      },
    ],
    projectedResult: {
      message: "ok",
      mode: "agent_loop",
      turns: 8,
      stoppedBy: "final_answer",
      observations: [],
    },
  });

  assert.deepEqual(report.toolOrder, MOCK_TOOL_ORDER);
  assert.equal(report.gisOutputs, 6);
  assert.equal(report.primarySuspectMmsi, "413567890");
  assert.equal(report.finalAnswerReceived, true);
}

{
  assert.throws(
    () =>
      validateOilSpillMockSmoke({
        rawEvents: [
          toolObservationEvent("Skill", { success: true }),
          toolObservationEvent("WeatherFetchMock", { gisData: { type: "wind-field" } }),
        ],
        projectedResult: {
          message: "ok",
          mode: "agent_loop",
          turns: 2,
          stoppedBy: "final_answer",
          observations: [],
        },
      }),
    /Missing OilSpillDetectMock/,
  );
}

function observation(toolName, output, ok = true) {
  return {
    toolCallId: `${toolName}-call`,
    toolName,
    ok,
    ...(ok ? { output } : { error: { code: "tool_execution_error", message: "failed" } }),
  };
}

function toolObservationEvent(toolName, output, ok = true) {
  return {
    type: "tool_observation",
    taskId: "task",
    turn: 1,
    toolCallId: `${toolName}-call`,
    toolName,
    ok,
    observation: observation(toolName, output, ok),
  };
}

console.log("oil spill smoke helper tests passed");
