import assert from "node:assert/strict";

const {
  FLOOD_ASSESSMENT_QUERY,
  FLOOD_ASSESSMENT_SCENARIO,
  FLOOD_ASSESSMENT_TOOLS,
  createFloodAssessmentSmokeModelClient,
  installMockFloodAssessmentFetch,
  validateFloodAssessmentSmoke,
} = await import("../../scripts/agent-loop/agent-loop-smoke-flood-assessment.ts");

assert.equal(FLOOD_ASSESSMENT_SCENARIO, "flood-assessment");
assert.equal(FLOOD_ASSESSMENT_QUERY, "/演示:洪水灾后评估");
assert.deepEqual(FLOOD_ASSESSMENT_TOOLS, [
  "FloodPreImageMock",
  "FloodPostImageMock",
  "FloodAssessmentMock",
]);

// Mock fetch helper intercepts legacy queryData and demand APIs without network access.
{
  const restore = installMockFloodAssessmentFetch();
  try {
    const pre = await fetch("http://legacy.example/agent/queryData", { method: "POST" });
    assert.equal(pre.status, 200);
    const preBody = await pre.json();
    assert.deepEqual(preBody.value.records, []);

    const post = await fetch("http://legacy.example/agent/zh/demand", { method: "POST" });
    assert.equal(post.status, 503);
  } finally {
    restore();
  }
}

// Fake model client: first decision loads the skill.
{
  const client = createFloodAssessmentSmokeModelClient();
  const firstDecision = await client.decide({
    messages: [],
    tools: [],
    query: "/演示:洪水灾后评估",
    observations: [],
    callId: "call-1",
  });

  assert.equal(firstDecision.type, "tool_calls");
  assert.equal(firstDecision.toolCalls.length, 1);
  assert.equal(firstDecision.toolCalls[0].toolName, "Skill");
  assert.equal(firstDecision.toolCalls[0].input.skill, "flood-assessment");
}

// Fake model client: after skill observation the next decision calls RegionResolve.
{
  const client = createFloodAssessmentSmokeModelClient();
  const secondDecision = await client.decide({
    messages: [],
    tools: [],
    query: "/演示:洪水灾后评估",
    observations: [
      {
        toolCallId: "flood-skill-1",
        toolName: "Skill",
        ok: true,
        output: { skill: "flood-assessment", loaded: true },
      },
    ],
    callId: "call-2",
  });

  assert.equal(secondDecision.type, "tool_calls");
  assert.equal(secondDecision.toolCalls[0].toolName, "RegionResolve");
  assert.equal(secondDecision.toolCalls[0].input.regionName, "湖南石门县");
}

// Fake model client: final answer after the full tool sequence.
{
  const client = createFloodAssessmentSmokeModelClient();
  const observations = [
    { toolCallId: "flood-skill-1", toolName: "Skill", ok: true, output: {} },
    { toolCallId: "flood-region-resolve-1", toolName: "RegionResolve", ok: true, output: {} },
    { toolCallId: "flood-region-mark-1", toolName: "RegionMark", ok: true, output: { gisData: {} } },
    { toolCallId: "flood-pre-1", toolName: "FloodPreImageMock", ok: true, output: { gisData: {} } },
    { toolCallId: "flood-post-1", toolName: "FloodPostImageMock", ok: true, output: { gisData: {} } },
    { toolCallId: "flood-assessment-1", toolName: "FloodAssessmentMock", ok: true, output: { gisData: {} } },
  ];

  const finalDecision = await client.decide({
    messages: [],
    tools: [],
    query: "/演示:洪水灾后评估",
    observations,
    callId: "call-7",
  });

  assert.equal(finalDecision.type, "final_answer");
  assert.match(finalDecision.content, /湖南石门县/);
}

// Smoke validation: accepts a valid full observation sequence.
{
  const report = validateFloodAssessmentSmoke({
    rawEvents: [
      { type: "tool_observation", taskId: "task", turn: 1, toolCallId: "s1", toolName: "Skill", ok: true, observation: { ok: true, output: {} } },
      { type: "tool_observation", taskId: "task", turn: 2, toolCallId: "rr1", toolName: "RegionResolve", ok: true, observation: { ok: true, output: {} } },
      { type: "tool_observation", taskId: "task", turn: 3, toolCallId: "rm1", toolName: "RegionMark", ok: true, observation: { ok: true, output: { gisData: { type: "region" } } } },
      { type: "tool_observation", taskId: "task", turn: 4, toolCallId: "pre1", toolName: "FloodPreImageMock", ok: true, observation: { ok: true, output: { imageSource: "local-fallback", imageUrl: "/local-tiles/pre_flood.png", gisData: {} } } },
      { type: "tool_observation", taskId: "task", turn: 5, toolCallId: "post1", toolName: "FloodPostImageMock", ok: true, observation: { ok: true, output: { imageSource: "local-fallback", imageUrl: "/local-tiles/post_flood.png", gisData: {} } } },
      { type: "tool_observation", taskId: "task", turn: 6, toolCallId: "assess1", toolName: "FloodAssessmentMock", ok: true, observation: { ok: true, output: { summary: { floodedAreaKm2: 0.032 }, gisData: { imageOverlays: [{ id: "pre-flood-imagery", alpha: 1, rectangle: [110.89, 29.88, 110.90, 29.88] }, { id: "post-flood-imagery", alpha: 1, rectangle: [110.89, 29.88, 110.90, 29.88] }] } } } },
      { type: "loop_stop", taskId: "task", turn: 7, result: { stoppedBy: "final_answer", turns: 7, finalAnswer: "done" } },
    ],
    projectedResult: {
      message: "ok",
      mode: "agent_loop",
      turns: 7,
      stoppedBy: "final_answer",
      observations: [],
    },
  });

  assert.deepEqual(report.toolOrder, ["Skill", "RegionResolve", "RegionMark", "FloodPreImageMock", "FloodPostImageMock", "FloodAssessmentMock"]);
  assert.equal(report.gisOutputs, 4);
  assert.equal(report.floodedAreaKm2, 0.032);
  assert.equal(report.finalAnswerReceived, true);
}

// Smoke validation: rejects a missing tool.
{
  assert.throws(
    () =>
      validateFloodAssessmentSmoke({
        rawEvents: [
          { type: "tool_observation", taskId: "task", turn: 1, toolCallId: "s1", toolName: "Skill", ok: true, observation: { ok: true, output: {} } },
        ],
        projectedResult: {
          message: "ok",
          mode: "agent_loop",
          turns: 2,
          stoppedBy: "final_answer",
          observations: [],
        },
      }),
    /Missing RegionResolve/,
  );
}

console.log("flood assessment smoke helper assertions passed");
