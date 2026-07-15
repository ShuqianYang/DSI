import assert from "node:assert/strict";

const {
  buildFloodAssessmentMockTools,
} = await import("../../src/modules/agent-loop/tools/domain/disasterAssessmentMock/index.js");
const {
  buildFloodPreImageMockTool,
} = await import("../../src/modules/agent-loop/tools/domain/disasterAssessmentMock/floodPreImage.js");
const {
  buildFloodPostImageMockTool,
} = await import("../../src/modules/agent-loop/tools/domain/disasterAssessmentMock/floodPostImage.js");
const {
  buildFloodAssessmentMockTool,
} = await import("../../src/modules/agent-loop/tools/domain/disasterAssessmentMock/floodAssessment.js");
const { buildDefaultToolRegistry } = await import(
  "../../src/modules/agent-loop/tools/_shared/toolRegistry.js"
);

const MOCK_TOOL_NAMES = [
  "FloodPreImageMock",
  "FloodPostImageMock",
  "FloodAssessmentMock",
];
const DEFAULT_REGION = "湖南石门县";

function createContext() {
  return {
    taskId: "flood-assessment-test-task",
    query: "/演示:洪水灾后评估",
    observations: [],
  };
}

function installFetch(handler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Flood mock tools are scoped to the skill and not visible by default.
{
  const defaultRegistry = buildDefaultToolRegistry();
  const defaultToolNames = new Set(defaultRegistry.list().map((tool) => tool.name));
  for (const toolName of MOCK_TOOL_NAMES) {
    assert.equal(defaultToolNames.has(toolName), false, `${toolName} should not be visible by default`);
    assert.equal(defaultRegistry.get(toolName), undefined, `${toolName} should not be executable before skill load`);
  }

  const scopedTools = buildFloodAssessmentMockTools();
  assert.equal(scopedTools.length, 3);
  assert.deepEqual(scopedTools.map((tool) => tool.name), MOCK_TOOL_NAMES);
}

// Input schema validation.
{
  for (const buildTool of [
    buildFloodPreImageMockTool,
    buildFloodPostImageMockTool,
    buildFloodAssessmentMockTool,
  ]) {
    const tool = buildTool();

    const valid = tool.inputSchema.safeParse({ region: DEFAULT_REGION });
    assert.equal(valid.success, true, `${tool.name} should accept valid input`);

    const defaulted = tool.inputSchema.safeParse({});
    assert.equal(defaulted.success, true, `${tool.name} should default region`);
    assert.equal(defaulted.data.region, DEFAULT_REGION);

    const invalid = tool.inputSchema.safeParse({ region: "" });
    assert.equal(invalid.success, false, `${tool.name} should reject empty region`);
  }
}

// Pre-flood image uses legacy queryData when it returns a preview URL.
{
  let requestBody;
  const restore = installFetch(async (url, init) => {
    assert.match(String(url), /\/agent\/queryData$/);
    requestBody = JSON.parse(String(init?.body ?? "{}"));
    return jsonResponse({
      state: true,
      value: {
        records: [{ previewUrl: "https://example.test/pre-flood.png" }],
      },
    });
  });

  try {
    const output = await buildFloodPreImageMockTool().execute({}, createContext());
    assert.equal(output.region, DEFAULT_REGION);
    assert.equal(output.phase, "pre");
    assert.equal(output.imageSource, "queryData");
    assert.equal(output.imageUrl, "https://example.test/pre-flood.png");
    assert.equal(requestBody.dataType, "洪水前");
    assert.equal(requestBody.targetType, "洪水前");
    assert.equal(requestBody.satelliteName, "高分五号A星");
    assert.deepEqual(requestBody.payloadType, ["可见光"]);
    assert.ok(output.gisData, "FloodPreImageMock should return top-level gisData");
  } finally {
    restore();
  }
}

// Pre-flood image falls back to the deterministic local asset when queryData has no preview.
{
  const restore = installFetch(async () =>
    jsonResponse({ state: true, value: { records: [] } })
  );

  try {
    const output = await buildFloodPreImageMockTool().execute({}, createContext());
    assert.equal(output.imageSource, "local-fallback");
    assert.equal(output.imageUrl, "/local-tiles/pre_flood.png");
    assert.ok(output.fallbackReason);
  } finally {
    restore();
  }
}

// Post-flood demand uses the old demand payload, and failed submission does not block fallback imagery.
{
  let requestBody;
  const restore = installFetch(async (url, init) => {
    assert.match(String(url), /\/agent\/zh\/demand$/);
    requestBody = JSON.parse(String(init?.body ?? "{}"));
    return jsonResponse({ state: false, message: "service disabled" }, 503);
  });

  try {
    const output = await buildFloodPostImageMockTool().execute(
      { callbackTimeoutMs: 1 },
      createContext(),
    );
    assert.equal(output.phase, "post");
    assert.equal(output.imageSource, "local-fallback");
    assert.equal(output.imageUrl, "/local-tiles/post_flood.png");
    assert.match(requestBody.requirementName, /湖南石门县 暴雨洪涝灾后应急成像需求/);
    assert.equal(requestBody.targetType, "洪水后");
    assert.equal(requestBody.targetName, "洪水后");
    assert.equal(requestBody.algorithm, "洪涝评估");
    assert.equal(requestBody.payloadMode, "可见光");
    assert.deepEqual(requestBody.areaBounds, {
      type: "Point",
      coordinates: [110.894662, 29.881476],
    });
    assert.ok(output.gisData, "FloodPostImageMock should return top-level gisData");
  } finally {
    restore();
  }
}

// Flood assessment loads the deterministic geojson and returns comparison GIS data.
{
  const output = await buildFloodAssessmentMockTool().execute({}, createContext());
  assert.equal(output.region, DEFAULT_REGION);
  assert.equal(output.summary.location, DEFAULT_REGION);
  assert.equal(output.summary.bridgesDamaged, 2);
  assert.equal(output.summary.roadsInterrupted, 2);
  assert.equal(output.summary.housesFlooded, 1);
  assert.equal(output.damageZones.length, 8);
  assert.equal(output.gisData.compareMode, undefined);
  assert.equal(output.gisData.compareConfig, undefined);
  assert.deepEqual(
    output.gisData.imageOverlays.map((overlay) => overlay.alpha),
    [1, 1],
  );
  assert.deepEqual(
    output.gisData.imageOverlays[1].rectangle,
    output.gisData.imageOverlays[0].rectangle,
  );
  assert.ok(output.gisData.regions.length >= 8);
  assert.ok(output.gisData.entities.some((entity) => entity.id === "zhangjiadu-bridge"));
}

console.log("flood assessment tool tests passed");
