import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const content = await readFile(
  new URL("../../../skills/earthquake-assessment/SKILL.md", import.meta.url),
  "utf8",
);

assert.match(content, /^name: earthquake-assessment/m);
assert.match(content, /\/演示:地震灾后评估/);
assert.match(content, /allowed-tools: RegionResolve, RegionMark, EarthquakePreImageMock, EarthquakePostImageMock, EarthquakeAssessmentMock/);
assert.match(content, /RegionResolve/);
assert.match(content, /RegionMark/);
assert.match(content, /EarthquakePreImageMock/);
assert.match(content, /EarthquakePostImageMock/);
assert.match(content, /EarthquakeAssessmentMock/);
assert.match(content, /queryData/);
assert.match(content, /demand/);
assert.match(content, /do not activate this skill for general earthquake questions/i);

console.log("earthquake assessment skill doc assertions passed");
