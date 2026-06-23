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

const wind = helpers.buildMockWindField(data.OIL_FILM_CENTER);
assert.equal(wind.grid.rows, 10);
assert.equal(wind.grid.cols, 10);
assert.equal(wind.u.length, 100);
assert.equal(wind.v.length, 100);
assert.equal(wind.speed.every((value) => value === 3.2), true);

console.log("oil spill mock data/helper assertions passed");
