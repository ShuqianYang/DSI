import assert from "node:assert/strict";

const {
  createGisToolchainSmokeModelClient,
  installMockOpenMeteoFetch,
  validateGisToolchainSmoke,
} = await import("../../scripts/agent-loop-smoke-gis.ts");

const modelClient = createGisToolchainSmokeModelClient();

const firstDecision = await modelClient.decide({
  messages: [],
  tools: [],
  query: "圈选东海并查询这个区域的风场。",
  observations: [],
  callId: "call-1",
});
assert.equal(firstDecision.type, "tool_calls");
assert.equal(firstDecision.toolCalls[0].toolName, "RegionResolve");
assert.deepEqual(firstDecision.toolCalls[0].input, { regionName: "东海" });

const bbox = { west: 120, east: 130, south: 24, north: 32 };
const secondDecision = await modelClient.decide({
  messages: [],
  tools: [],
  query: "圈选东海并查询这个区域的风场。",
  observations: [
    {
      toolCallId: "gis-resolve-1",
      toolName: "RegionResolve",
      ok: true,
      output: {
        resolved: true,
        selected: { name: "中国东海", bbox },
      },
    },
  ],
  callId: "call-2",
});
assert.equal(secondDecision.type, "tool_calls");
assert.equal(secondDecision.toolCalls[0].toolName, "RegionMark");
assert.deepEqual(secondDecision.toolCalls[0].input.bbox, bbox);

const thirdDecision = await modelClient.decide({
  messages: [],
  tools: [],
  query: "圈选东海并查询这个区域的风场。",
  observations: [
    {
      toolCallId: "gis-resolve-1",
      toolName: "RegionResolve",
      ok: true,
      output: {
        resolved: true,
        selected: { name: "中国东海", bbox },
      },
    },
    {
      toolCallId: "gis-mark-1",
      toolName: "RegionMark",
      ok: true,
      output: {
        gisData: { type: "region" },
      },
    },
  ],
  callId: "call-3",
});
assert.equal(thirdDecision.type, "tool_calls");
assert.equal(thirdDecision.toolCalls[0].toolName, "WeatherFetch");
assert.deepEqual(thirdDecision.toolCalls[0].input.bbox, bbox);
assert.deepEqual(thirdDecision.toolCalls[0].input.grid, { rows: 2, cols: 2 });

const restoreFetch = installMockOpenMeteoFetch();
try {
  const forecast = await fetch("https://api.open-meteo.com/v1/forecast?latitude=1,2,3,4");
  const forecastJson = await forecast.json();
  assert.equal(forecastJson.length, 4);

  const marine = await fetch("https://marine-api.open-meteo.com/v1/marine?latitude=1");
  const marineJson = await marine.json();
  assert.equal(marineJson.hourly.ocean_current_velocity.at(-1), 0.4);
} finally {
  restoreFetch();
}

validateGisToolchainSmoke({
  rawEvents: [
    {
      type: "tool_observation",
      taskId: "task",
      turn: 1,
      toolCallId: "gis-resolve-1",
      toolName: "RegionResolve",
      ok: true,
      observation: {
        toolCallId: "gis-resolve-1",
        toolName: "RegionResolve",
        ok: true,
        output: { resolved: true, selected: { bbox } },
      },
    },
    {
      type: "tool_observation",
      taskId: "task",
      turn: 2,
      toolCallId: "gis-mark-1",
      toolName: "RegionMark",
      ok: true,
      observation: {
        toolCallId: "gis-mark-1",
        toolName: "RegionMark",
        ok: true,
        output: {
          gisData: { type: "region" },
          cameraView: { type: "fit-bbox", bbox },
        },
      },
    },
    {
      type: "tool_observation",
      taskId: "task",
      turn: 3,
      toolCallId: "gis-weather-1",
      toolName: "WeatherFetch",
      ok: true,
      observation: {
        toolCallId: "gis-weather-1",
        toolName: "WeatherFetch",
        ok: true,
        output: {
          gisData: {
            type: "wind-field",
            windField: { speed: [1, 2, 3, 4] },
          },
        },
      },
    },
  ],
  legacyEvents: [
    {
      type: "step_update",
      actionId: "gis-mark-1",
      actionType: "RegionMark",
      status: "completed",
      name: "RegionMark",
      gisData: { type: "region" },
    },
    {
      type: "step_update",
      actionId: "gis-weather-1",
      actionType: "WeatherFetch",
      status: "completed",
      name: "WeatherFetch",
      gisData: { type: "wind-field" },
    },
  ],
  projectedResult: {
    message: "ok",
    mode: "agent_loop",
    turns: 4,
    stoppedBy: "final_answer",
    observations: [],
    "gis-mark-1": { success: true, gisData: { type: "region" } },
    "gis-weather-1": { success: true, gisData: { type: "wind-field" } },
  },
});

console.log("agent-loop-smoke GIS helper tests passed");
