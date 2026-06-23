import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const content = await readFile(
  new URL("../../../skills/oil-spill-tracing/SKILL.md", import.meta.url),
  "utf8",
);

assert.match(content, /^name: oil-spill-tracing/m);
assert.match(content, /allowed-tools:[\s\S]*RegionResolve[\s\S]*RegionMark/);
assert.match(content, /RegionResolve/);
assert.match(content, /RegionMark/);
assert.match(content, /OilSpillDetectMock/);
assert.match(content, /WeatherFetchMock/);
assert.match(content, /OilDriftTraceMock/);
assert.match(content, /AisFetchMock/);
assert.match(content, /AisMatchSuspectsMock/);
assert.match(content, /AisSuspectRankingMock/);
assert.match(content, /multi-step GIS replay/i);
assert.match(content, /Do \*\*not\*\* call `SatelliteImageSearch`/);
assert.match(content, /Do \*\*not\*\* call real `WeatherFetch`/);
assert.match(content, /shouldContinue:false/);
assert.match(content, /deterministic mock replay/i);

console.log("oil spill tracing skill doc test passed");
