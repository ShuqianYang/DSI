import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const content = await readFile(
  new URL("../../../skills/flood-assessment/SKILL.md", import.meta.url),
  "utf8",
);

assert.match(content, /^name: flood-assessment/m);
assert.match(content, /\/演示:洪水灾后评估/);
assert.match(content, /allowed-tools: RegionResolve, RegionMark, FloodPreImageMock, FloodPostImageMock, FloodAssessmentMock/);
assert.match(content, /湖南石门县/);
assert.match(content, /RegionResolve/);
assert.match(content, /RegionMark/);
assert.match(content, /FloodPreImageMock/);
assert.match(content, /FloodPostImageMock/);
assert.match(content, /FloodAssessmentMock/);
assert.match(content, /queryData/);
assert.match(content, /demand/);
assert.match(content, /flood.geojson/);
assert.match(content, /do not activate this skill for general flood questions/i);

console.log("flood assessment skill doc assertions passed");
