import assert from "node:assert/strict";

const {
  createFireInvestigationSmokeModelClient,
  installMockFireInvestigationFetch,
  validateFireInvestigationSmoke,
} = await import("../../scripts/agent-loop/agent-loop-smoke-fire-investigation.ts");
const {
  buildFireInvestigationMockTools,
} = await import("../../src/modules/agent-loop/tools/domain/fireInvestigation/index.js");
const {
  buildBorderPushMockTool,
} = await import("../../src/modules/agent-loop/tools/domain/fireInvestigation/borderPush.js");
const {
  buildFireDetectMockTool,
} = await import("../../src/modules/agent-loop/tools/domain/fireInvestigation/fireDetect.js");
const {
  buildFireSatelliteMockTool,
} = await import("../../src/modules/agent-loop/tools/domain/fireInvestigation/fireSatellite.js");
const {
  buildFireAssessmentMockTool,
} = await import("../../src/modules/agent-loop/tools/domain/fireInvestigation/fireAssessment.js");
const {
  buildFireReportMockTool,
} = await import("../../src/modules/agent-loop/tools/domain/fireInvestigation/fireReport.js");
const { buildDefaultToolRegistry } = await import(
  "../../src/modules/agent-loop/tools/_shared/toolRegistry.js"
);

const MOCK_TOOL_NAMES = [
  "FireDetectMock",
  "FireSatelliteMock",
  "FireAssessmentMock",
  "FireReportMock",
  "BorderPushMock",
];

function createContext() {
  return {
    taskId: "fire-investigation-test-task",
    query: "/演示:火情研判",
    observations: [],
  };
}

// Tool registration in the default registry
{
  const defaultRegistry = buildDefaultToolRegistry();
  const defaultToolNames = new Set(defaultRegistry.list().map((tool) => tool.name));
  for (const toolName of MOCK_TOOL_NAMES) {
    assert.ok(defaultToolNames.has(toolName), `${toolName} should be registered in the default registry`);
  }

  const domainRegistry = buildFireInvestigationMockTools();
  assert.equal(domainRegistry.length, 5);
  for (const tool of domainRegistry) {
    assert.equal(defaultRegistry.get(tool.name)?.name, tool.name);
  }
}

// Input schema validation: valid, default, invalid
{
  for (const buildTool of [
    buildFireDetectMockTool,
    buildFireSatelliteMockTool,
    buildFireAssessmentMockTool,
    buildFireReportMockTool,
    buildBorderPushMockTool,
  ]) {
    const tool = buildTool();

    const valid = tool.inputSchema.safeParse({ region: "Kensai" });
    assert.equal(valid.success, true, `${tool.name} should accept valid input`);

    const defaulted = tool.inputSchema.safeParse({});
    assert.equal(defaulted.success, true, `${tool.name} should default region`);
    assert.equal(defaulted.data.region, "Kensai");

    const invalid = tool.inputSchema.safeParse({ region: "" });
    assert.equal(invalid.success, false, `${tool.name} should reject empty region`);
  }
}

// Successful execution with deterministic mock data
{
  for (const buildTool of [
    buildFireDetectMockTool,
    buildFireSatelliteMockTool,
    buildFireAssessmentMockTool,
    buildFireReportMockTool,
    buildBorderPushMockTool,
  ]) {
    const tool = buildTool();
    const output = await tool.execute({ region: "Kensai" }, createContext());
    assert.equal(output.region, "Kensai");
    assert.ok(output.gisData, `${tool.name} should return top-level gisData`);
  }

  const detect = await buildFireDetectMockTool().execute({ region: "Kensai" }, createContext());
  assert.equal(detect.fireDetected, true);
  assert.equal(detect.confidence, "high");
  assert.equal(detect.burnedAreaHectares, 1200);
  assert.deepEqual(detect.centerCoordinates, [76.998, 43.2635]);
  assert.equal(detect.overlayMeta.maskImageUrl, undefined);

  const satellite = await buildFireSatelliteMockTool().execute({ region: "Kensai" }, createContext());
  assert.equal(satellite.imageCount, 1);
  assert.deepEqual(
    satellite.gisData.imageOverlays.map((overlay) => overlay.id),
    ["fire-post-image"],
  );
  assert.equal(satellite.gisData.imageOverlays[0].alpha, 1);

  const report = await buildFireReportMockTool().execute({ region: "Kensai" }, createContext());
  assert.equal(report.report.detection.burnedAreaHectares, 1200);
  assert.equal(report.report.assessment.riskLevel, "high");

  const restore = installMockFireInvestigationFetch();
  const borderPush = await buildBorderPushMockTool().execute({ region: "Kensai" }, createContext());
  restore();
  assert.equal(borderPush.pushed, true);
  assert.equal(borderPush.fallback, false, "Mock fetch should return 200 so fallback is not used in default test");
  assert.ok(borderPush.payload.emergencyPayload, "BorderPushMock should return emergency payload");
  assert.ok(borderPush.gisData, "BorderPushMock should return top-level gisData");
}

// Mock fetch helper intercepts the emergency/border push endpoint and returns a callable restore function
{
  const restore = installMockFireInvestigationFetch();
  assert.equal(typeof restore, "function");
  restore();
}

// Fake model client: first decision loads the skill
{
  const client = createFireInvestigationSmokeModelClient();
  const firstDecision = await client.decide({
    messages: [],
    tools: [],
    query: "/演示:火情研判",
    observations: [],
    callId: "call-1",
  });

  assert.equal(firstDecision.type, "tool_calls");
  assert.equal(firstDecision.toolCalls.length, 1);
  assert.equal(firstDecision.toolCalls[0].toolName, "Skill");
  assert.equal(firstDecision.toolCalls[0].input.skill, "fire-investigation");
}

// Fake model client: after skill observation the next decision calls RegionResolve
{
  const client = createFireInvestigationSmokeModelClient();
  const secondDecision = await client.decide({
    messages: [],
    tools: [],
    query: "/演示:火情研判",
    observations: [
      {
        toolCallId: "fire-skill-1",
        toolName: "Skill",
        ok: true,
        output: { skill: "fire-investigation", loaded: true },
      },
    ],
    callId: "call-2",
  });

  assert.equal(secondDecision.type, "tool_calls");
  assert.equal(secondDecision.toolCalls[0].toolName, "RegionResolve");
  assert.equal(secondDecision.toolCalls[0].input.regionName, "Kensai");
}

// Fake model client: final answer after the full tool sequence
{
  const client = createFireInvestigationSmokeModelClient();
  const observations = [
    { toolCallId: "fire-skill-1", toolName: "Skill", ok: true, output: {} },
    { toolCallId: "fire-region-resolve-1", toolName: "RegionResolve", ok: true, output: {} },
    { toolCallId: "fire-region-mark-1", toolName: "RegionMark", ok: true, output: { gisData: {} } },
    { toolCallId: "fire-detect-1", toolName: "FireDetectMock", ok: true, output: { gisData: {} } },
    { toolCallId: "fire-satellite-1", toolName: "FireSatelliteMock", ok: true, output: { gisData: {} } },
    { toolCallId: "fire-assessment-1", toolName: "FireAssessmentMock", ok: true, output: { gisData: {} } },
    { toolCallId: "fire-report-1", toolName: "FireReportMock", ok: true, output: { gisData: {} } },
    { toolCallId: "fire-border-push-1", toolName: "BorderPushMock", ok: true, output: { gisData: {} } },
  ];

  const finalDecision = await client.decide({
    messages: [],
    tools: [],
    query: "/演示:火情研判",
    observations,
    callId: "call-9",
  });

  assert.equal(finalDecision.type, "final_answer");
  assert.match(finalDecision.content, /Kensai/);
}

// Smoke validation: accepts a valid full observation sequence
{
  const report = validateFireInvestigationSmoke({
    rawEvents: [
      { type: "tool_observation", taskId: "task", turn: 1, toolCallId: "s1", toolName: "Skill", ok: true, observation: { ok: true, output: {} } },
      { type: "tool_observation", taskId: "task", turn: 2, toolCallId: "rr1", toolName: "RegionResolve", ok: true, observation: { ok: true, output: {} } },
      { type: "tool_observation", taskId: "task", turn: 3, toolCallId: "rm1", toolName: "RegionMark", ok: true, observation: { ok: true, output: { gisData: { type: "region" } } } },
      { type: "tool_observation", taskId: "task", turn: 4, toolCallId: "fd1", toolName: "FireDetectMock", ok: true, observation: { ok: true, output: { fireDetected: true, burnedAreaHectares: 1200, gisData: {} } } },
      { type: "tool_observation", taskId: "task", turn: 5, toolCallId: "fs1", toolName: "FireSatelliteMock", ok: true, observation: { ok: true, output: { gisData: { imageOverlays: [{ id: "fire-post-image", alpha: 1 }] } } } },
      { type: "tool_observation", taskId: "task", turn: 6, toolCallId: "fa1", toolName: "FireAssessmentMock", ok: true, observation: { ok: true, output: { gisData: {} } } },
      { type: "tool_observation", taskId: "task", turn: 7, toolCallId: "fr1", toolName: "FireReportMock", ok: true, observation: { ok: true, output: { gisData: {} } } },
      { type: "tool_observation", taskId: "task", turn: 8, toolCallId: "fbp1", toolName: "BorderPushMock", ok: true, observation: { ok: true, output: { pushed: true, fallback: false, gisData: {} } } },
      { type: "loop_stop", taskId: "task", turn: 9, result: { stoppedBy: "final_answer", turns: 9, finalAnswer: "done" } },
    ],
    projectedResult: {
      message: "ok",
      mode: "agent_loop",
      turns: 9,
      stoppedBy: "final_answer",
      observations: [],
    },
  });

  assert.deepEqual(report.toolOrder, ["Skill", "RegionResolve", "RegionMark", "FireDetectMock", "FireSatelliteMock", "FireAssessmentMock", "FireReportMock", "BorderPushMock"]);
  assert.equal(report.gisOutputs, 6);
  assert.equal(report.burnedAreaHectares, 1200);
  assert.equal(report.finalAnswerReceived, true);
}

// Smoke validation: rejects a missing tool
{
  assert.throws(
    () =>
      validateFireInvestigationSmoke({
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
    /Missing RegionResolve/
  );
}

console.log("fire investigation tool and smoke model client tests passed");
