import assert from "node:assert/strict";

const data = await import("../../src/modules/agent-loop/tools/domain/oilSpillMock/mockData.ts");
const helpers = await import("../../src/modules/agent-loop/tools/domain/oilSpillMock/gisHelpers.ts");

assert.deepEqual(data.OIL_FILM_CENTER, { lng: 123.0125, lat: 30.2561 });
assert.deepEqual(data.POLLUTION_ORIGIN, [123.0375, 30.2761]);
assert.equal(data.SUSPECT_VESSELS.length, 5);
assert.equal(data.TOTAL_VESSEL_COUNT, 157);
assert.equal(data.TOTAL_RECORD_COUNT, 2863);

const ring = helpers.buildCircle(123.0375, 30.2761, 0.002, 16);
assert.equal(ring.length, 17);
assert.deepEqual(ring[0], ring.at(-1));
assert.equal(helpers.toDMS(123.0375, true), "东经123°02′15″");
assert.equal(helpers.toDMS(30.2761, false), "北纬30°16′34″");
assert.equal(helpers.toDMS(123.999999, true), "东经124°00′00″");

const wind = helpers.buildMockWindField(data.OIL_FILM_CENTER);
assert.equal(wind.grid.rows, 10);
assert.equal(wind.grid.cols, 10);
assert.equal(wind.u.length, 100);
assert.equal(wind.v.length, 100);
assert.equal(wind.speed.every((value) => value === 3.2), true);

const { buildDefaultToolRegistry } = await import("../../src/modules/agent-loop/tools/_shared/toolRegistry.js");
const { callTool } = await import("../../src/modules/agent-loop/tools/_shared/toolGateway.js");

const registry = buildDefaultToolRegistry();

assert.ok(registry.get("OilSpillDetectMock"), "OilSpillDetectMock should be registered");
assert.ok(registry.get("WeatherFetchMock"), "WeatherFetchMock should be registered");
assert.ok(registry.get("OilDriftTraceMock"), "OilDriftTraceMock should be registered");
assert.ok(registry.get("satellite"), "satellite alias should resolve to OilSpillDetectMock");
assert.ok(registry.get("oil-drift"), "oil-drift alias should resolve to OilDriftTraceMock");
assert.equal(
  registry.get("weather-fetch")?.name,
  "WeatherFetch",
  "weather-fetch alias remains owned by real WeatherFetch",
);

const toolContext = { taskId: "oil-spill-mock-tools", query: "查询东海漏油", observations: [] };
const fetchCalls = [];
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), body: String(init?.body ?? "") });
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    async json() {
      return { state: true, value: { records: [] } };
    },
  };
};

const detectObservation = await callTool(
  registry,
  { id: "detect", toolName: "OilSpillDetectMock", input: { region: "中国东海" } },
  toolContext,
);
assert.equal(detectObservation.ok, true);
assert.equal(fetchCalls.length, 1);
assert.equal(detectObservation.output.oilSpill.centerLng, 123.0125);
assert.equal(detectObservation.output.shouldContinue, true);
assert.equal(detectObservation.output.imageSource, "local-fallback");
assert.equal(detectObservation.output.gisData.type, "region");
assert.equal(detectObservation.output.gisData.imageOverlays.length, 1);

const otherRegionObservation = await callTool(
  registry,
  { id: "detect-other", toolName: "OilSpillDetectMock", input: { region: "南海" } },
  toolContext,
);
assert.equal(otherRegionObservation.ok, true);
assert.equal(otherRegionObservation.output.shouldContinue, false);
assert.equal(otherRegionObservation.output.reason, "queryData_no_valid_oil_spill_result");
assert.equal("gisData" in otherRegionObservation.output, false);

const weatherObservation = await callTool(
  registry,
  { id: "weather", toolName: "WeatherFetchMock", input: { region: "东海油膜片区" } },
  toolContext,
);
assert.equal(weatherObservation.ok, true);
assert.equal(weatherObservation.output.windSpeed, 3.2);
assert.equal(weatherObservation.output.windDirection, "东北");
assert.equal(weatherObservation.output.gisData.type, "wind-field");

const driftObservation = await callTool(
  registry,
  { id: "drift", toolName: "OilDriftTraceMock", input: {} },
  {
    ...toolContext,
    observations: [
      { toolCallId: "detect", toolName: "OilSpillDetectMock", ok: true, output: detectObservation.output },
      { toolCallId: "weather", toolName: "WeatherFetchMock", ok: true, output: weatherObservation.output },
    ],
  },
);
assert.equal(driftObservation.ok, true);
assert.equal(driftObservation.output.pollutionOrigin.lng, 123.0375);
assert.equal(driftObservation.output.gisData.trajectories[0].id, "drift-path");
assert.equal(driftObservation.output.gisData.regions[0].id, "pollution-origin-area");

console.log("oil spill mock data/helper assertions passed");
