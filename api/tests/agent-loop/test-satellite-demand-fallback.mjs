import assert from "node:assert/strict";

process.env.CDSE_CLIENT_ID = "";
process.env.CDSE_CLIENT_SECRET = "";
process.env.SATELLITE_DEMAND_CALLBACK_TIMEOUT_MS = "40";
process.env.SATELLITE_DEMAND_SUBMIT_TIMEOUT_MS = "40";

const {
  buildSatelliteImageSearchTool,
} = await import("../../src/modules/agent-loop/tools/domain/satellite/satellite.ts");
const {
  registerSatelliteSliceCallback,
  resolveSatelliteSliceCallback,
  cleanupSatelliteSliceCallback,
} = await import("../../src/modules/agent-loop/tools/domain/satellite/satelliteCallbackStore.ts");
const express = (await import("express")).default;
const { default: satelliteCallbackRoutes } = await import("../../src/modules/agent-loop/satelliteCallbackRoutes.ts");

const DEMAND_URL = "http://192.168.0.129:5000/agent/zh/demand";
const STAC_URL = "https://stac.dataspace.copernicus.eu/v1/search";

function createContext() {
  return {
    taskId: "satellite-demand-fallback-test",
    query: "查询指定区域卫星图",
    observations: [],
  };
}

function createInput() {
  return {
    regionName: "东海",
    bbox: { west: 122.9, east: 123.1, south: 30.2, north: 30.3 },
    startDate: "2026-06-01",
    endDate: "2026-06-10",
    maxCloudCoverage: 30,
    source: "sentinel-2",
    maxResults: 3,
  };
}

function createStacResponse(id = "S2_TEST_001") {
  return {
    features: [
      {
        id,
        collection: "sentinel-2-l2a",
        bbox: [122.91, 30.21, 123.09, 30.29],
        properties: {
          datetime: "2026-06-08T02:30:00.000Z",
          "eo:cloud_cover": 12.5,
        },
        assets: {
          thumbnail: { href: "https://example.test/s2-thumb.jpg" },
        },
      },
    ],
  };
}

function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.000001, `${message}: expected ${expected}, got ${actual}`);
}

async function withMockedFetch(mockFetch, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const calls = [];
  await withMockedFetch(async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url) === DEMAND_URL) {
      return new Response(JSON.stringify({ state: false, message: "disabled" }), { status: 503 });
    }
    if (String(url) === STAC_URL) {
      return new Response(JSON.stringify(createStacResponse("S2_FOCUSED_POINT")), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, async () => {
    const output = await buildSatelliteImageSearchTool().execute(
      {
        regionName: "东海灾害点",
        bbox: { west: 122.95, east: 123.05, south: 30, north: 30.5 },
        targetPoint: { lon: 123, lat: 30.25 },
        searchRadiusKm: 20,
        startDate: "2026-06-01",
        endDate: "2026-06-10",
        maxCloudCoverage: 30,
        source: "sentinel-2",
        maxResults: 3,
      },
      createContext()
    );

    assert.equal(calls[0].url, DEMAND_URL);
    assert.equal(calls[1].url, STAC_URL);

    const demandBbox = calls[0].body.rawPayload.bbox;
    assert.deepEqual(demandBbox, output.query.bbox);
    assertClose(demandBbox.west, 122.95, "focused bbox west should be clipped to region");
    assertClose(demandBbox.east, 123.05, "focused bbox east should be clipped to region");
    assert.ok(demandBbox.south > 30.07 && demandBbox.south < 30.08, "focused bbox south should use radius");
    assert.ok(demandBbox.north > 30.42 && demandBbox.north < 30.43, "focused bbox north should use radius");

    const stacBbox = calls[1].body.bbox;
    assert.deepEqual(stacBbox, [demandBbox.west, demandBbox.south, demandBbox.east, demandBbox.north]);
    assert.equal(output.images[0].id, "S2_FOCUSED_POINT");
  });
}

{
  const calls = [];
  await withMockedFetch(async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url) === DEMAND_URL) {
      return new Response(JSON.stringify({ state: false, message: "disabled" }), { status: 503 });
    }
    if (String(url) === STAC_URL) {
      return new Response(JSON.stringify(createStacResponse()), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, async () => {
    const output = await buildSatelliteImageSearchTool().execute(createInput(), createContext());

    assert.equal(calls[0].url, DEMAND_URL);
    assert.equal(calls[1].url, STAC_URL);
    assert.equal(calls[0].body.targetType, "卫星影像");
    assert.deepEqual(calls[0].body.areaBounds, {
      type: "Polygon",
      coordinates: [[
        [122.9, 30.2],
        [123.1, 30.2],
        [123.1, 30.3],
        [122.9, 30.3],
        [122.9, 30.2],
      ]],
    });
    assert.equal(output.provider, "open-stac");
    assert.equal(output.images[0].id, "S2_TEST_001");
    assert.match(output.fallbackReason, /HTTP 503/);
  });
}

{
  const calls = [];
  await withMockedFetch(async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url) === DEMAND_URL) {
      return new Response(JSON.stringify({ state: true, value: "REQ-ACTUAL-001" }), { status: 200 });
    }
    if (String(url) === STAC_URL) {
      return new Response(JSON.stringify(createStacResponse("S2_TIMEOUT_FALLBACK")), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, async () => {
    const output = await buildSatelliteImageSearchTool().execute(createInput(), createContext());

    assert.equal(calls[0].url, DEMAND_URL);
    assert.equal(calls[1].url, STAC_URL);
    assert.equal(output.provider, "open-stac");
    assert.equal(output.images[0].id, "S2_TIMEOUT_FALLBACK");
    assert.match(output.fallbackReason, /callback timeout/i);
  });
}

{
  const calls = [];
  await withMockedFetch(async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url) === DEMAND_URL) {
      return new Response(JSON.stringify({ state: true, value: "REQ-ACTUAL-002" }), { status: 200 });
    }
    if (String(url) === STAC_URL) {
      throw new Error("STAC should not be called after a valid callback");
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, async () => {
    const pending = buildSatelliteImageSearchTool().execute(createInput(), createContext());
    setTimeout(() => {
      resolveSatelliteSliceCallback("REQ-ACTUAL-002", {
        id: "slice-1",
        satellite: "高分五号A星",
        acquisition_time: "2026-06-08T03:00:00.000Z",
        resolution: 1,
        source_image_id: "GF5A-001",
        center_longitude: 123,
        center_latitude: 30.25,
        target_type: "卫星影像",
        confidence: 0.91,
        width: 1402,
        height: 1122,
        path: "/slice/GF5A-001.png",
        url: "https://example.test/GF5A-001.png",
        requirementId: "REQ-ACTUAL-002",
        lon_ul: 122.9,
        lat_ul: 30.3,
        lon_ur: 123.1,
        lat_ur: 30.3,
      });
    }, 5);

    const output = await pending;

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, DEMAND_URL);
    assert.equal(output.provider, "legacy-demand");
    assert.equal(output.images[0].id, "GF5A-001");
    assert.equal(output.images[0].thumbnailUrl, "https://example.test/GF5A-001.png");
    assert.equal(output.gisData.imageOverlays[0].url, "https://example.test/GF5A-001.png");
    cleanupSatelliteSliceCallback("REQ-ACTUAL-002");
  });
}

{
  const app = express();
  app.use(express.json());
  app.use("/", satelliteCallbackRoutes);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const pending = registerSatelliteSliceCallback("REQ-ROUTE-001");
    const response = await fetch(`http://127.0.0.1:${address.port}/agent/callback/slice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requirementId: "REQ-ROUTE-001",
        url: "https://example.test/route-slice.png",
      }),
    });

    assert.equal(response.status, 200);
    const responseBody = await response.json();
    assert.equal(responseBody.state, true);
    assert.equal(responseBody.message, "已接收");

    const payload = await pending;
    assert.equal(payload.url, "https://example.test/route-slice.png");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

console.log("satellite demand fallback test passed");
