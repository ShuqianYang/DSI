import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const skill = await readFile(
  new URL("../../../skills/disaster-satellite-query/SKILL.md", import.meta.url),
  "utf8"
);

const frontmatterMatch = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/);
assert(frontmatterMatch, "disaster satellite skill should have YAML frontmatter");
const frontmatter = frontmatterMatch[1];

assert.match(frontmatter, /^name:\s+disaster-satellite-query\s*$/m);
assert.match(
  frontmatter,
  /^description:\s+Use when /m,
  "skill description should start with 'Use when' for reliable discovery"
);
assert.match(
  frontmatter,
  /^allowed-tools:\s+RegionResolve,\s*RegionMark,\s*DisasterQuery,\s*SatelliteImageSearch,\s*ImageAnalysis\s*$/m,
  "skill should declare all registered domain tools including ImageAnalysis"
);

assert.match(skill, /RegionResolve\.selected\.bbox/);
assert.match(skill, /RegionResolve\.selected\.geometryRef/);
assert.match(skill, /\bDisasterQuery\b/);
assert.match(skill, /\bSatelliteImageSearch\b/);
assert.match(skill, /\bRegionMark\b/);
assert.match(skill, /Do not invent a bbox/);
assert.match(skill, /do not fabricate/i);
assert.match(skill, /metadata and browser links/i);
assert.match(skill, /ImageAnalysis[\s\S]*available/i);
assert.match(skill, /not available[\s\S]*metadata/i);
assert.doesNotMatch(skill, /must call ImageAnalysis|always call ImageAnalysis|必须.*ImageAnalysis/i);

console.log("disaster satellite skill doc test passed");
