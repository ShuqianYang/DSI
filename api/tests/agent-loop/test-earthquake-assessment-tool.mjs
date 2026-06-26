import assert from "node:assert/strict";

const {
  buildEarthquakeAssessmentMockTools,
} = await import("../../src/modules/agent-loop/tools/domain/disasterAssessmentMock/index.js");
const {
  buildEarthquakePreImageMockTool,
} = await import("../../src/modules/agent-loop/tools/domain/disasterAssessmentMock/earthquakePreImage.js");
const {
  buildEarthquakePostImageMockTool,
} = await import("../../src/modules/agent-loop/tools/domain/disasterAssessmentMock/earthquakePostImage.js");
const {
  buildEarthquakeAssessmentMockTool,
} = await import("../../src/modules/agent-loop/tools/domain/disasterAssessmentMock/earthquakeAssessment.js");
const { buildDefaultToolRegistry } = await import(
  "../../src/modules/agent-loop/tools/_shared/toolRegistry.js"
);

const MOCK_TOOL_NAMES = [
  "EarthquakePreImageMock",
  "EarthquakePostImageMock",
  "EarthquakeAssessmentMock",
];
const DEFAULT_REGION = "广西柳州市柳南区";

function createContext() {
  return {
    taskId: "earthquake-assessment-test-task",
    query: "/演示:地震灾后评估",
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

// Tool registration is scoped to the skill and not visible in the default registry.
{
  const defaultRegistry = buildDefaultToolRegistry();
  const defaultToolNames = new Set(defaultRegistry.list().map((tool) => tool.name));
  for (const toolName of MOCK_TOOL_NAMES) {
    assert.equal(defaultToolNames.has(toolName), false, `${toolName} should not be visible by default`);
    assert.equal(defaultRegistry.get(toolName), undefined, `${toolName} should not be executable before skill load`);
  }

  const scopedTools = buildEarthquakeAssessmentMockTools();
  assert.equal(scopedTools.length, 3);
  assert.deepEqual(scopedTools.map((tool) => tool.name), MOCK_TOOL_NAMES);
}

// Input schema validation: valid, default, invalid.
{
  for (const buildTool of [
    buildEarthquakePreImageMockTool,
    buildEarthquakePostImageMockTool,
    buildEarthquakeAssessmentMockTool,
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

// Pre-earthquake image uses legacy queryData when it returns a preview URL.
{
  let requestBody;
  const restore = installFetch(async (url, init) => {
    assert.match(String(url), /\/agent\/queryData$/);
    requestBody = JSON.parse(String(init?.body ?? "{}"));
    return jsonResponse({
      state: true,
      value: {
        records: [{ previewUrl: "https://example.test/pre-earthquake.png" }],
      },
    });
  });

  try {
    const output = await buildEarthquakePreImageMockTool().execute({}, createContext());
    assert.equal(output.region, DEFAULT_REGION);
    assert.equal(output.phase, "pre");
    assert.equal(output.imageSource, "queryData");
    assert.equal(output.imageUrl, "https://example.test/pre-earthquake.png");
    assert.equal(requestBody.dataType, "地震前");
    assert.equal(requestBody.targetType, "地震前");
    assert.equal(requestBody.satelliteName, "高分五号A星");
    assert.deepEqual(requestBody.payloadType, ["可见光"]);
    assert.ok(output.gisData, "EarthquakePreImageMock should return top-level gisData");
  } finally {
    restore();
  }
}

// Pre-earthquake image falls back to the deterministic local asset when queryData has no preview.
{
  const restore = installFetch(async () =>
    jsonResponse({ state: true, value: { records: [] } })
  );

  try {
    const output = await buildEarthquakePreImageMockTool().execute({}, createContext());
    assert.equal(output.imageSource, "local-fallback");
    assert.equal(output.imageUrl, "/local-tiles/pre_earthquake.png");
    assert.ok(output.fallbackReason);
  } finally {
    restore();
  }
}

// Post-earthquake demand uses the old demand payload, and failed submission does not block fallback imagery.
{
  let requestBody;
  const restore = installFetch(async (url, init) => {
    assert.match(String(url), /\/agent\/zh\/demand$/);
    requestBody = JSON.parse(String(init?.body ?? "{}"));
    return jsonResponse({ state: false, message: "service disabled" }, 503);
  });

  try {
    const output = await buildEarthquakePostImageMockTool().execute(
      { callbackTimeoutMs: 1 },
      createContext(),
    );
    assert.equal(output.phase, "post");
    assert.equal(output.imageSource, "local-fallback");
    assert.equal(output.imageUrl, "/local-tiles/post_earthquake.png");
    assert.match(requestBody.requirementName, /广西柳州市柳南区 5\.2级地震震后应急成像需求/);
    assert.equal(requestBody.targetType, "地震后");
    assert.equal(requestBody.targetName, "地震后");
    assert.equal(requestBody.algorithm, "灾后评估");
    assert.equal(requestBody.payloadMode, "可见光");
    assert.deepEqual(requestBody.areaBounds, {
      type: "Point",
      coordinates: [109.25982181039833, 24.366071571884453],
    });
    assert.ok(output.gisData, "EarthquakePostImageMock should return top-level gisData");
  } finally {
    restore();
  }
}

// Damage assessment returns deterministic GIS output for the replay.
{
  const output = await buildEarthquakeAssessmentMockTool().execute({}, createContext());
  assert.equal(output.region, DEFAULT_REGION);
  assert.equal(output.earthquakeMagnitude, 5.2);
  assert.equal(output.riskLevel, "medium");
  assert.ok(output.gisData, "EarthquakeAssessmentMock should return top-level gisData");
  assert.equal(output.gisData.compareMode, undefined);
  assert.equal(output.gisData.compareConfig, undefined);
  assert.deepEqual(
    output.gisData.imageOverlays.map((overlay) => overlay.url),
    ["/local-tiles/pre_earthquake.png", "/local-tiles/post_earthquake.png"],
  );
  assert.deepEqual(
    output.gisData.imageOverlays.map((overlay) => overlay.alpha),
    [1, 1],
  );
  assert.deepEqual(
    output.gisData.imageOverlays[1].rectangle,
    output.gisData.imageOverlays[0].rectangle,
  );
  assert.ok(Array.isArray(output.assessment.affectedObjects));
}

console.log("earthquake assessment tool tests passed");
