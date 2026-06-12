import assert from "node:assert/strict";
import "dotenv/config";

const { buildSatelliteImageSearchTool } = await import("../../src/modules/agent-loop/tools/domain/satellite/satellite.ts");
const { buildDefaultToolRegistry } = await import("../../src/modules/agent-loop/tools/_shared/toolRegistry.ts");

function createContext(query = "satellite search") {
  return {
    taskId: "satellite-search-test-task",
    query,
    observations: [],
  };
}

// Test 1: Search Sentinel-2 around Taiwan Strait
{
  const tool = buildSatelliteImageSearchTool();
  const output = await tool.execute(
    {
      regionName: "台湾海峡",
      bbox: { west: 117, east: 122.5, south: 22, north: 26.5 },
      startDate: "2024-01-01",
      endDate: "2024-06-01",
      maxCloudCoverage: 30,
      source: "sentinel-2",
      maxResults: 5,
    },
    createContext()
  );

  assert.equal(typeof output.summary, "string");
  assert.equal(typeof output.totalCount, "number");
  assert.ok(Array.isArray(output.images));
  assert.equal(output.query.source, "sentinel-2");

  console.log(`[Test 1] Taiwan Strait Sentinel-2: ${output.totalCount} images`);
  console.log(`  Summary: ${output.summary}`);

  if (output.images.length > 0) {
    const first = output.images[0];
    assert.equal(typeof first.id, "string");
    assert.equal(typeof first.name, "string");
    assert.equal(first.source, "sentinel-2");
    assert.equal(typeof first.acquisitionDate, "string");
    assert.equal(typeof first.browserUrl, "string");
    assert.equal(typeof first.bbox.west, "number");
    assert.equal(typeof first.bbox.east, "number");
    assert.equal(typeof first.bbox.south, "number");
    assert.equal(typeof first.bbox.north, "number");
    if (first.cloudCoverage !== null) {
      assert.ok(first.cloudCoverage >= 0 && first.cloudCoverage <= 100);
    }
    console.log(`  First: ${first.name} | ${first.acquisitionDate.slice(0, 10)} | cloud=${first.cloudCoverage}%`);
  }
}

// Test 2: Search any source (Sentinel-2 + Landsat) around Fujian
{
  const tool = buildSatelliteImageSearchTool();
  const output = await tool.execute(
    {
      regionName: "福建省",
      bbox: { west: 115.5, east: 120.5, south: 23, north: 28.5 },
      startDate: "2024-03-01",
      endDate: "2024-04-01",
      maxCloudCoverage: 50,
      source: "any",
      maxResults: 10,
    },
    createContext()
  );

  assert.equal(typeof output.totalCount, "number");
  assert.ok(Array.isArray(output.images));

  console.log(`[Test 2] Fujian any source: ${output.totalCount} images`);
  console.log(`  Summary: ${output.summary}`);
}

// Test 3: High cloud coverage filter (should return fewer or zero)
{
  const tool = buildSatelliteImageSearchTool();
  const output = await tool.execute(
    {
      bbox: { west: 117, east: 122.5, south: 22, north: 26.5 },
      startDate: "2024-01-01",
      endDate: "2024-06-01",
      maxCloudCoverage: 5, // Very strict
      source: "sentinel-2",
      maxResults: 10,
    },
    createContext()
  );

  assert.ok(output.images.length <= 10);
  if (output.images.length > 0) {
    for (const img of output.images) {
      if (img.cloudCoverage !== null) {
        assert.ok(img.cloudCoverage <= 5, `Cloud coverage ${img.cloudCoverage} should be <= 5`);
      }
    }
  }

  console.log(`[Test 3] Strict cloud filter (<=5%): ${output.totalCount} images`);
}

// Test 4: Small bbox + recent date (likely zero results for very recent)
{
  const tool = buildSatelliteImageSearchTool();
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const output = await tool.execute(
    {
      bbox: { west: 0, east: 0.1, south: 0, north: 0.1 },
      startDate: yesterday.toISOString().slice(0, 10),
      endDate: now.toISOString().slice(0, 10),
      maxCloudCoverage: 100,
      source: "sentinel-2",
      maxResults: 5,
    },
    createContext()
  );

  assert.ok(output.summary.includes("未在") || output.summary.includes("查询到"));
  console.log(`[Test 4] Small bbox recent: ${output.summary}`);
}

// Test 5: Registry registration
{
  const registry = buildDefaultToolRegistry();
  assert(registry.get("SatelliteImageSearch"));
  assert(registry.get("satellite-image-search"));
  console.log("[Test 5] Registry registration: OK");
}

console.log("\nsatellite image search tool test passed");
