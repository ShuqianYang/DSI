import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const skill = await readFile(new URL("../../../skills/aircraft-region-query/SKILL.md", import.meta.url), "utf8");
const databaseDescription = await readFile(
  new URL("../../src/instructions/database-description.md", import.meta.url),
  "utf8"
);

const frontmatterMatch = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/);
assert(frontmatterMatch, "aircraft skill should have YAML frontmatter");
const frontmatter = frontmatterMatch[1];

assert.match(
  frontmatter,
  /^description:\s+Use when /m,
  "skill description should start with 'Use when' for reliable discovery"
);
assert.match(
  frontmatter,
  /^allowed-tools:\s+RegionResolve,\s*RegionMark,\s*Read,\s*SqlQuerySchema,\s*SqlQuery\s*$/m,
  "aircraft skill should allow RegionResolve, RegionMark, and the read-only SQL discovery and query tools"
);
assert.doesNotMatch(skill, /\bWebSearch\b/, "hourly OpenSky database queries should not require WebSearch");
assert.doesNotMatch(skill, /\bRunSqlReadOnly\b|\bQueryDatabase\b/, "skill should use current SqlQuery tools only");
assert.match(
  skill,
  /"database"\s*:\s*"default"\s*,\s*"schema"\s*:\s*"public"\s*,\s*"table"\s*:\s*"aircraft_current_states"/,
  "skill should instruct SqlQuerySchema against public.aircraft_current_states"
);
assert.match(skill, /\bbaro_altitude\b/, "skill should use current altitude column name");
assert.match(skill, /\bvelocity\b/, "skill should use current velocity column name");
assert.match(skill, /velocity[\s\S]*m\/s/, "skill should document OpenSky velocity as m/s");
assert.match(skill, /3\.6|km\/h/, "skill should tell the model to convert velocity when showing km/h");
assert.match(skill, /\blatitude\s+BETWEEN\b/i, "skill should include bounded bbox latitude filtering");
assert.match(skill, /\blongitude\s+BETWEEN\b/i, "skill should include bounded bbox longitude filtering");
assert.match(skill, /\bLIMIT\s+100\b/i, "detail query should be bounded");
assert.match(
  skill,
  /RegionResolve\.selected\.bbox/,
  "skill should require bbox reuse from RegionResolve for named regions"
);
assert.doesNotMatch(
  skill,
  /Supported Approximate Regions|Use these conservative bboxes|\|\s*台湾海峡\s*\|\s*22\.0/i,
  "skill should not keep hard-coded named-region bbox tables"
);

assert.match(
  databaseDescription,
  /\bpublic\b[\s\S]*\baircraft_current_states\b/,
  "database description should catalog public.aircraft_current_states"
);
assert.match(
  databaseDescription,
  /SqlQuerySchema[\s\S]*"schema"\s*:\s*"public"[\s\S]*"table"\s*:\s*"aircraft_current_states"/,
  "database description should show schema discovery for the aircraft table"
);
assert.match(
  databaseDescription,
  /RegionResolve\.selected\.bbox[\s\S]*aircraft_current_states/,
  "database description should tell aircraft SQL to reuse RegionResolve.selected.bbox"
);
assert.match(
  databaseDescription,
  /velocity[\s\S]*m\/s[\s\S]*km\/h[\s\S]*3\.6/,
  "database description should document OpenSky velocity units and km/h conversion"
);

console.log("aircraft skill doc test passed");
