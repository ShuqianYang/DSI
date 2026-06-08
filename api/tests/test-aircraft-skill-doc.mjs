import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const skill = await readFile(new URL("../../skills/aircraft-region-query/SKILL.md", import.meta.url), "utf8");
const databaseDescription = await readFile(
  new URL("../src/instructions/database-description.md", import.meta.url),
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
  /^allowed-tools:\s+Read,\s*SqlQuerySchema,\s*SqlQuery\s*$/m,
  "aircraft skill should only allow the tools needed for read-only SQL discovery and query"
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
assert.match(skill, /\blatitude\s+BETWEEN\b/i, "skill should include bounded bbox latitude filtering");
assert.match(skill, /\blongitude\s+BETWEEN\b/i, "skill should include bounded bbox longitude filtering");
assert.match(skill, /\bLIMIT\s+100\b/i, "detail query should be bounded");

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

console.log("aircraft skill doc test passed");
