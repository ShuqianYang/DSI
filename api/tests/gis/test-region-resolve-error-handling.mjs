import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const tempRoot = await mkdtemp(path.join(tmpdir(), "region-resolve-missing-"));
const originalWorkspaceRoot = process.env.AGENT_WORKSPACE_ROOT;
process.env.AGENT_WORKSPACE_ROOT = path.join(tempRoot, "missing-workspace");

try {
  const { buildRegionResolveTool } = await import("../../src/modules/agent-loop/regionResolveTool.ts");
  const tool = buildRegionResolveTool();
  const output = await tool.execute(
    { regionName: "\u4e1c\u6d77" },
    {
      taskId: "region-resolve-error-test-task",
      query: "resolve missing region assets",
      observations: [],
    }
  );

  assert.equal(output.resolved, false);
  assert.equal(output.candidates.length, 0);
  assert.equal(output.requirement.type, "region_geometry_missing");
  assert.match(output.requirement.message, /GeoJSON|asset|bbox|polygon/);
} finally {
  if (originalWorkspaceRoot === undefined) {
    delete process.env.AGENT_WORKSPACE_ROOT;
  } else {
    process.env.AGENT_WORKSPACE_ROOT = originalWorkspaceRoot;
  }
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("region resolve error handling test passed");
