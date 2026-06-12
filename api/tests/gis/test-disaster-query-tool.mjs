import assert from "node:assert/strict";
import "dotenv/config";

const { buildDisasterQueryTool } = await import("../../src/modules/agent-loop/tools/domain/disaster/disaster.ts");

function createContext(query = "disaster query") {
  return {
    taskId: "disaster-query-test-task",
    query,
    observations: [],
  };
}

// Test 1: Query earthquakes in Taiwan Strait area (30 days)
{
  const tool = buildDisasterQueryTool();
  const output = await tool.execute(
    {
      regionName: "台湾海峡",
      bbox: { west: 117, east: 122.5, south: 22, north: 26.5 },
      disasterType: "earthquake",
      timeRange: "30d",
      minMagnitude: 4.0,
    },
    createContext()
  );

  assert.equal(typeof output.summary, "string");
  assert.equal(typeof output.totalCount, "number");
  assert.ok(Array.isArray(output.events));
  assert.equal(output.dataSource, "usgs");
  assert.equal(output.query.disasterType, "earthquake");
  assert.equal(output.query.regionName, "台湾海峡");

  if (output.events.length > 0) {
    const first = output.events[0];
    assert.equal(first.type, "earthquake");
    assert.equal(typeof first.id, "string");
    assert.equal(typeof first.title, "string");
    assert.equal(typeof first.time, "string");
    assert.equal(typeof first.location.lat, "number");
    assert.equal(typeof first.location.lon, "number");
    assert.equal(typeof first.sourceUrl, "string");
    assert.equal(first.source, "usgs");
    if (first.magnitude !== undefined) {
      assert.equal(typeof first.magnitude, "number");
      assert.ok(first.magnitude >= 4.0);
    }
    if (first.severity !== undefined) {
      assert.ok(["微弱", "轻微", "中等", "重大", "严重"].includes(first.severity));
    }
  }

  console.log(`[Test 1] Taiwan Strait earthquakes (30d): ${output.totalCount} events`);
  if (output.events.length > 0) {
    console.log(`  Latest: ${output.events[0].title} | M${output.events[0].magnitude} | ${output.events[0].time}`);
  }

  // Verify gisData
  assert.equal(output.gisData.type, "entity");
  assert.ok(Array.isArray(output.gisData.entities));
  assert.equal(output.gisData.entities.length, output.events.length);
  if (output.gisData.entities.length > 0) {
    const firstEntity = output.gisData.entities[0];
    assert.equal(typeof firstEntity.id, "string");
    assert.equal(typeof firstEntity.name, "string");
    assert.equal(firstEntity.type, "earthquake");
    assert.equal(typeof firstEntity.coordinates[0], "number"); // lon
    assert.equal(typeof firstEntity.coordinates[1], "number"); // lat
    assert.ok(["high", "medium", "low"].includes(firstEntity.importance));
    assert.ok(["normal", "warning", "danger"].includes(firstEntity.status));
    console.log(`  gisData: ${output.gisData.entities.length} entities mapped`);
  }
}

// Test 2: Query global earthquakes (24h, high magnitude)
{
  const tool = buildDisasterQueryTool();
  const output = await tool.execute(
    {
      disasterType: "earthquake",
      timeRange: "24h",
      minMagnitude: 5.0,
    },
    createContext()
  );

  assert.equal(typeof output.totalCount, "number");
  assert.ok(Array.isArray(output.events));
  assert.equal(output.dataSource, "usgs");

  console.log(`[Test 2] Global earthquakes (24h, M>=5): ${output.totalCount} events`);
}

// Test 3: Query all disasters (should include USGS + attempt GDACS)
{
  const tool = buildDisasterQueryTool();
  const output = await tool.execute(
    {
      regionName: "菲律宾",
      bbox: { west: 116, east: 127, south: 4, north: 21 },
      disasterType: "all",
      timeRange: "7d",
    },
    createContext()
  );

  assert.equal(typeof output.totalCount, "number");
  assert.ok(Array.isArray(output.events));
  assert.ok(["usgs", "gdacs", "mixed"].includes(output.dataSource));

  console.log(`[Test 3] Philippines all disasters (7d): ${output.totalCount} events, source=${output.dataSource}`);
}

// Test 4: No results scenario (unlikely area + high magnitude)
{
  const tool = buildDisasterQueryTool();
  const output = await tool.execute(
    {
      bbox: { west: 0, east: 1, south: 0, north: 1 },  // Small area in Atlantic
      disasterType: "earthquake",
      timeRange: "24h",
      minMagnitude: 8.0,
    },
    createContext()
  );

  assert.ok(output.summary.includes("未查询到") || output.summary.includes("未在"));
  assert.equal(output.totalCount, 0);

  console.log(`[Test 4] No results (small area, M>=8): ${output.summary}`);
}

// Test 5: Tool registry registration
{
  const { buildDefaultToolRegistry } = await import("../../src/modules/agent-loop/tools/_shared/toolRegistry.ts");
  const registry = buildDefaultToolRegistry();
  assert(registry.get("DisasterQuery"));
  assert(registry.get("disaster-query"));
  console.log("[Test 5] Registry registration: OK");
}

console.log("\ndisaster query tool test passed");
