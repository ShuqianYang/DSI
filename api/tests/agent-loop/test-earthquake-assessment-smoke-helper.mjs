import assert from "node:assert/strict";

const {
  EARTHQUAKE_ASSESSMENT_QUERY,
  EARTHQUAKE_ASSESSMENT_SCENARIO,
  EARTHQUAKE_ASSESSMENT_TOOLS,
  createEarthquakeAssessmentSmokeModelClient,
  installMockEarthquakeAssessmentFetch,
  validateEarthquakeAssessmentSmoke,
} = await import("../../scripts/agent-loop/agent-loop-smoke-earthquake-assessment.ts");

assert.equal(EARTHQUAKE_ASSESSMENT_SCENARIO, "earthquake-assessment");
assert.equal(EARTHQUAKE_ASSESSMENT_QUERY, "/演示:地震灾后评估");
assert.deepEqual(EARTHQUAKE_ASSESSMENT_TOOLS, [
  "EarthquakePreImageMock",
  "EarthquakePostImageMock",
  "EarthquakeAssessmentMock",
]);

// Mock fetch helper intercepts legacy queryData and demand APIs without network access.
{
  const restore = installMockEarthquakeAssessmentFetch();
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
  const client = createEarthquakeAssessmentSmokeModelClient();
  const firstDecision = await client.decide({
    messages: [],
    tools: [],
    query: "/演示:地震灾后评估",
    observations: [],
    callId: "call-1",
  });

  assert.equal(firstDecision.type, "tool_calls");
  assert.equal(firstDecision.toolCalls.length, 1);
  assert.equal(firstDecision.toolCalls[0].toolName, "Skill");
  assert.equal(firstDecision.toolCalls[0].input.skill, "earthquake-assessment");
}

// Fake model client: after skill observation the next decision calls RegionResolve.
{
  const client = createEarthquakeAssessmentSmokeModelClient();
  const secondDecision = await client.decide({
    messages: [],
    tools: [],
    query: "/演示:地震灾后评估",
    observations: [
      {
        toolCallId: "earthquake-skill-1",
        toolName: "Skill",
        ok: true,
        output: { skill: "earthquake-assessment", loaded: true },
      },
    ],
    callId: "call-2",
  });

  assert.equal(secondDecision.type, "tool_calls");
  assert.equal(secondDecision.toolCalls[0].toolName, "RegionResolve");
  assert.equal(secondDecision.toolCalls[0].input.regionName, "广西柳州市柳南区");
}

// Fake model client: final answer after the full tool sequence.
{
  const client = createEarthquakeAssessmentSmokeModelClient();
  const observations = [
    { toolCallId: "earthquake-skill-1", toolName: "Skill", ok: true, output: {} },
    { toolCallId: "earthquake-region-resolve-1", toolName: "RegionResolve", ok: true, output: {} },
    { toolCallId: "earthquake-region-mark-1", toolName: "RegionMark", ok: true, output: { gisData: {} } },
    { toolCallId: "earthquake-pre-1", toolName: "EarthquakePreImageMock", ok: true, output: { gisData: {} } },
    { toolCallId: "earthquake-post-1", toolName: "EarthquakePostImageMock", ok: true, output: { gisData: {} } },
    { toolCallId: "earthquake-assessment-1", toolName: "EarthquakeAssessmentMock", ok: true, output: { gisData: {} } },
  ];

  const finalDecision = await client.decide({
    messages: [],
    tools: [],
    query: "/演示:地震灾后评估",
    observations,
    callId: "call-7",
  });

  assert.equal(finalDecision.type, "final_answer");
  assert.match(finalDecision.content, /广西柳州市柳南区/);
}

// Smoke validation: accepts a valid full observation sequence.
{
  const report = validateEarthquakeAssessmentSmoke({
    rawEvents: [
      { type: "tool_observation", taskId: "task", turn: 1, toolCallId: "s1", toolName: "Skill", ok: true, observation: { ok: true, output: {} } },
      { type: "tool_observation", taskId: "task", turn: 2, toolCallId: "rr1", toolName: "RegionResolve", ok: true, observation: { ok: true, output: {} } },
      { type: "tool_observation", taskId: "task", turn: 3, toolCallId: "rm1", toolName: "RegionMark", ok: true, observation: { ok: true, output: { gisData: { type: "region" } } } },
      { type: "tool_observation", taskId: "task", turn: 4, toolCallId: "pre1", toolName: "EarthquakePreImageMock", ok: true, observation: { ok: true, output: { imageSource: "local-fallback", imageUrl: "/local-tiles/pre_earthquake.png", gisData: {} } } },
      { type: "tool_observation", taskId: "task", turn: 5, toolCallId: "post1", toolName: "EarthquakePostImageMock", ok: true, observation: { ok: true, output: { imageSource: "local-fallback", imageUrl: "/local-tiles/wenchuan_post.png", gisData: {} } } },
      { type: "tool_observation", taskId: "task", turn: 6, toolCallId: "assess1", toolName: "EarthquakeAssessmentMock", ok: true, observation: { ok: true, output: { earthquakeMagnitude: 5.2, gisData: { imageOverlays: [{ id: "earthquake-pre-image", alpha: 1, rectangle: [109.25, 24.36, 109.26, 24.37] }, { id: "earthquake-post-image", alpha: 1, rectangle: [109.25, 24.36, 109.26, 24.37] }] } } } },
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

  assert.deepEqual(report.toolOrder, ["Skill", "RegionResolve", "RegionMark", "EarthquakePreImageMock", "EarthquakePostImageMock", "EarthquakeAssessmentMock"]);
  assert.equal(report.gisOutputs, 4);
  assert.equal(report.earthquakeMagnitude, 5.2);
  assert.equal(report.finalAnswerReceived, true);
}

// Smoke validation: rejects a missing tool.
{
  assert.throws(
    () =>
      validateEarthquakeAssessmentSmoke({
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

console.log("earthquake assessment smoke helper assertions passed");
