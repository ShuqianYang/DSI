import assert from "node:assert/strict";

process.env.CDSE_CLIENT_ID = "";
process.env.CDSE_CLIENT_SECRET = "";
process.env.SATELLITE_QUERY_DATA_TIMEOUT_MS = "40";

const { buildDomainTools } = await import("../../src/modules/agent-loop/tools/domain/index.ts");
const {
  buildSatelliteImageSearchTool,
} = await import("../../src/modules/agent-loop/tools/domain/satellite/satellite.ts");

const QUERY_DATA_URL = "http://192.168.0.129:5000/agent/queryData";
const STAC_URL = "https://stac.dataspace.copernicus.eu/v1/search";

function createContext() {
  return {
    taskId: "satellite-queryData-test",
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

function createQueryDataResponse(previewUrl, id = "GF5A-001") {
  return {
    state: true,
    value: {
      records: [
        {
          id,
          previewUrl,
          url: previewUrl,
          acquisition_time: "2026-06-08T03:00:00.000Z",
          resolution: 1,
          lon_ul: 122.9,
          lat_ul: 30.3,
          lon_ur: 123.1,
          lat_ur: 30.3,
          lon_ll: 122.9,
          lat_ll: 30.2,
          lon_lr: 123.1,
          lat_lr: 30.2,
        },
      ],
    },
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

// 1. Tool registration in default registry
{
  const tools = buildDomainTools();
  const tool = tools.find((t) => t.name === "SatelliteImageSearch");
  assert.ok(tool, "SatelliteImageSearch should be registered in buildDomainTools");
  assert.equal(tool.displayName, "卫星影像搜索");
  assert.equal(tool.kind, "domain");
  assert.equal(tool.riskLevel, "low");
}

// 2. Input schema validation
{
  const tool = buildSatelliteImageSearchTool();

  // valid with bbox
  const valid = tool.inputSchema.safeParse({
    bbox: { west: 120, east: 121, south: 30, north: 31 },
  });
  assert.equal(valid.success, true);
  assert.equal(valid.data.source, "any");
  assert.equal(valid.data.maxResults, 10);
  assert.equal(valid.data.maxCloudCoverage, 30);
  assert.equal(valid.data.queryDataUrl, QUERY_DATA_URL);

  // valid with targetPoint
  const validPoint = tool.inputSchema.safeParse({
    targetPoint: { lon: 120.5, lat: 30.5 },
  });
  assert.equal(validPoint.success, true);

  // invalid: neither bbox nor targetPoint
  const invalid = tool.inputSchema.safeParse({
    regionName: "东海",
  });
  assert.equal(invalid.success, false);

  // invalid bbox
  const invalidBbox = tool.inputSchema.safeParse({
    bbox: { west: 121, east: 120, south: 30, north: 31 },
  });
  assert.equal(invalidBbox.success, false);
}

// 3. Successful execution via queryData
{
  const calls = [];
  await withMockedFetch(async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url) === QUERY_DATA_URL) {
      return new Response(JSON.stringify(createQueryDataResponse("https://example.test/GF5A-001.png")), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, async () => {
    const output = await buildSatelliteImageSearchTool().execute(createInput(), createContext());

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, QUERY_DATA_URL);
    assert.equal(calls[0].body.dataType, "卫星影像");
    assert.deepEqual(calls[0].body.payloadType, ["可见光"]);
    assert.equal(calls[0].body.satelliteName, "高分五号A星");
    assert.equal(calls[0].body.targetName, "东海");

    assert.equal(output.provider, "queryData");
    assert.equal(output.images.length, 1);
    assert.equal(output.images[0].id, "GF5A-001");
    assert.equal(output.images[0].thumbnailUrl, "https://example.test/GF5A-001.png");
    assert.equal(output.gisData.imageOverlays[0].url, "https://example.test/GF5A-001.png");
    assert.ok(output.summary.includes("queryData"));
  });
}

// 4. queryData HTTP error falls back to STAC
{
  const calls = [];
  await withMockedFetch(async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url) === QUERY_DATA_URL) {
      return new Response(JSON.stringify({ state: false, message: "disabled" }), { status: 503 });
    }
    if (String(url) === STAC_URL) {
      return new Response(JSON.stringify(createStacResponse("S2_HTTP_FALLBACK")), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, async () => {
    const output = await buildSatelliteImageSearchTool().execute(createInput(), createContext());

    assert.equal(calls[0].url, QUERY_DATA_URL);
    assert.equal(calls[1].url, STAC_URL);
    assert.equal(output.provider, "open-stac");
    assert.equal(output.images[0].id, "S2_HTTP_FALLBACK");
    assert.match(output.fallbackReason, /HTTP 503/);
    assert.ok(output.summary.includes("queryData 查询未成功"));
    assert.ok(output.summary.includes("HTTP 503"));
  });
}

// 5. queryData empty records falls back to STAC
{
  const calls = [];
  await withMockedFetch(async (url, init) => {
    calls.push({ url: String(url) });
    if (String(url) === QUERY_DATA_URL) {
      return new Response(JSON.stringify({ state: true, value: { records: [] } }), { status: 200 });
    }
    if (String(url) === STAC_URL) {
      return new Response(JSON.stringify(createStacResponse("S2_EMPTY_FALLBACK")), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, async () => {
    const output = await buildSatelliteImageSearchTool().execute(createInput(), createContext());

    assert.equal(output.provider, "open-stac");
    assert.equal(output.images[0].id, "S2_EMPTY_FALLBACK");
    assert.match(output.fallbackReason, /no image url/i);
    assert.ok(output.summary.includes("queryData 查询未成功"));
    assert.ok(output.summary.includes("no image url"));
  });
}

// 6. queryData network error falls back to STAC
{
  await withMockedFetch(async (url) => {
    if (String(url) === QUERY_DATA_URL) {
      throw new Error("ECONNREFUSED");
    }
    if (String(url) === STAC_URL) {
      return new Response(JSON.stringify(createStacResponse("S2_NETWORK_FALLBACK")), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, async () => {
    const output = await buildSatelliteImageSearchTool().execute(createInput(), createContext());

    assert.equal(output.provider, "open-stac");
    assert.equal(output.images[0].id, "S2_NETWORK_FALLBACK");
    assert.match(output.fallbackReason, /queryData request failed/i);
    assert.ok(output.summary.includes("queryData 查询未成功"));
    assert.ok(output.summary.includes("queryData request failed"));
  });
}

// 7. queryData timeout falls back to STAC
{
  await withMockedFetch(async (url, init) => {
    if (String(url) === QUERY_DATA_URL) {
      const signal = init?.signal;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve(new Response(JSON.stringify(createQueryDataResponse("https://example.test/GF5A-timeout.png")), { status: 200 }));
        }, 200);
        if (signal) {
          const onAbort = () => {
            clearTimeout(timer);
            reject(new Error("queryData_timeout"));
          };
          if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener("abort", onAbort, { once: true });
          }
        }
      });
    }
    if (String(url) === STAC_URL) {
      return new Response(JSON.stringify(createStacResponse("S2_TIMEOUT_FALLBACK")), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, async () => {
    const output = await buildSatelliteImageSearchTool().execute(createInput(), createContext());

    assert.equal(output.provider, "open-stac");
    assert.equal(output.images[0].id, "S2_TIMEOUT_FALLBACK");
    assert.match(output.fallbackReason, /timeout/i);
    assert.ok(output.summary.includes("queryData 查询未成功"));
    assert.ok(output.summary.includes("timeout"));
  });
}

// 8. Focused bbox clipped to region when targetPoint is present
{
  const calls = [];
  await withMockedFetch(async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url) === QUERY_DATA_URL) {
      return new Response(JSON.stringify(createQueryDataResponse("https://example.test/GF5A-002.png", "GF5A-002")), { status: 200 });
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

    assert.equal(calls[0].url, QUERY_DATA_URL);

    const queryBbox = calls[0].body.rawPayload.bbox;
    assert.deepEqual(queryBbox, output.query.bbox);
    assertClose(queryBbox.west, 122.95, "focused bbox west should be clipped to region");
    assertClose(queryBbox.east, 123.05, "focused bbox east should be clipped to region");
    assert.ok(queryBbox.south > 30.07 && queryBbox.south < 30.08, "focused bbox south should use radius");
    assert.ok(queryBbox.north > 30.42 && queryBbox.north < 30.43, "focused bbox north should use radius");

    assert.equal(output.provider, "queryData");
    assert.equal(output.images[0].id, "GF5A-002");
  });
}

console.log("satellite queryData test passed");
