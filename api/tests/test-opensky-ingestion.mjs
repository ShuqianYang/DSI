import assert from "node:assert/strict";
import {
  ingestOpenSkySnapshotOnce,
  normalizeOpenSkyStates,
} from "../src/modules/opensky/ingestion.js";

const sourceTime = 1_710_000_000;

function state(overrides = {}) {
  const row = [
    "abc123",
    " TEST123 ",
    "China",
    sourceTime - 5,
    sourceTime,
    121.5,
    24.5,
    10_000,
    false,
    230,
    90,
    0,
    null,
    10_200,
    null,
    false,
    0,
    4,
  ];
  for (const [index, value] of Object.entries(overrides)) {
    row[Number(index)] = value;
  }
  return row;
}

{
  let replaceCalled = false;
  await assert.rejects(
    () =>
      ingestOpenSkySnapshotOnce({
        getToken: async () => "token",
        fetchStates: async () => ({ time: sourceTime, states: [] }),
        replaceAll: async () => {
          replaceCalled = true;
          return { deleted: 0, inserted: 0 };
        },
      }),
    /empty OpenSky states/i
  );
  assert.equal(replaceCalled, false, "empty OpenSky responses must not replace the current table");
}

{
  const rows = normalizeOpenSkyStates({
    time: sourceTime,
    states: [
      state(),
      state({ 0: "" }),
      state({ 0: "   " }),
      state({ 4: null }),
      state({ 4: "bad" }),
    ],
  });

  assert.equal(rows.length, 1, "normalization should keep only rows with valid icao24 and last_contact");
  assert.equal(rows[0].icao24, "abc123");
  assert.equal(rows[0].callsign, "TEST123");
  assert.equal(rows[0].sourceTime.toISOString(), "2024-03-09T16:00:00.000Z");
}

console.log("opensky ingestion test passed");
