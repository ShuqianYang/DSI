import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const skill = await readFile(new URL("../../../skills/ais-region-query/SKILL.md", import.meta.url), "utf8");
const databaseDescription = await readFile(
  new URL("../../src/instructions/database-description.md", import.meta.url),
  "utf8"
);

const frontmatterMatch = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/);
assert(frontmatterMatch, "AIS skill should have YAML frontmatter");
const frontmatter = frontmatterMatch[1];

assert.match(
  frontmatter,
  /^description:\s+Use when /m,
  "AIS skill description should start with 'Use when' for reliable discovery"
);
assert.match(
  frontmatter,
  /^allowed-tools:\s+Read,\s*SqlQuerySchema,\s*SqlQuery\s*$/m,
  "AIS skill should only allow the tools needed for read-only SQL discovery and query"
);
assert.doesNotMatch(skill, /\bWebSearch\b/, "hourly AIS database queries should not require WebSearch");
assert.match(
  skill,
  /"database"\s*:\s*"default"\s*,\s*"schema"\s*:\s*"public"\s*,\s*"table"\s*:\s*"ais_current_states"/,
  "AIS skill should instruct SqlQuerySchema against public.ais_current_states"
);
assert.match(skill, /\blatitude\s+BETWEEN\b/i, "AIS skill should include bounded bbox latitude filtering");
assert.match(skill, /\blongitude\s+BETWEEN\b/i, "AIS skill should include bounded bbox longitude filtering");
assert.match(skill, /\bLIMIT\s+100\b/i, "AIS detail query should be bounded");
assert.match(
  skill,
  /RegionResolve\.selected\.bbox/,
  "AIS skill should require bbox reuse from RegionResolve for named regions"
);
assert.doesNotMatch(
  skill,
  /Supported Approximate Regions|Use these conservative bboxes|\|\s*台湾海峡\s*\|\s*22\.0/i,
  "AIS skill should not keep hard-coded named-region bbox tables"
);

assert.match(
  databaseDescription,
  /\bpublic\b[\s\S]*\bais_current_states\b/,
  "database description should catalog public.ais_current_states"
);
assert.match(
  databaseDescription,
  /RegionResolve\.selected\.bbox[\s\S]*ais_current_states/,
  "database description should tell AIS SQL to reuse RegionResolve.selected.bbox"
);

console.log("AIS skill doc test passed");
