import assert from "node:assert/strict";
import "dotenv/config";
import { writeFile } from "node:fs/promises";

const CDSE_TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const CDSE_STAC_URL = "https://stac.dataspace.copernicus.eu/v1/search";
const CDSE_PROCESS_URL = "https://sh.dataspace.copernicus.eu/api/v1/process";

const CLIENT_ID = process.env.CDSE_CLIENT_ID;
const CLIENT_SECRET = process.env.CDSE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("[SKIP] CDSE_CLIENT_ID and CDSE_CLIENT_SECRET required in .env");
  console.error("       Get them from https://dataspace.copernicus.eu/ → User Settings → OAuth clients");
  process.exit(0);
}

// ─── 1. Get Access Token ───

async function getAccessToken() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  const res = await fetch(CDSE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  assert.equal(typeof json.access_token, "string", "access_token must be string");
  assert.ok(json.access_token.length > 10, "access_token looks valid");
  assert.equal(typeof json.expires_in, "number", "expires_in must be number");
  return { token: json.access_token, expiresIn: json.expires_in };
}

// ─── 2. STAC Search ───

async function searchStac(token) {
  const res = await fetch(CDSE_STAC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      collections: ["sentinel-2-l2a"],
      bbox: [117, 22, 122.5, 26.5], // 台湾海峡
      datetime: "2024-05-01T00:00:00Z/2024-06-01T00:00:00Z",
      limit: 5,
      filter: {
        op: "<=",
        args: [{ property: "eo:cloud_cover" }, 30],
      },
      "filter-lang": "cql2-json",
      sortby: [{ field: "properties.datetime", direction: "desc" }],
      fields: {
        include: ["id", "collection", "properties.datetime", "properties.eo:cloud_cover", "assets.thumbnail", "bbox"],
        exclude: ["geometry"],
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`STAC search failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  assert.ok(Array.isArray(data.features), "STAC response must have features array");
  return data;
}

// ─── 3. Process API Render PNG ───

const TRUE_COLOR_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: ["B02", "B03", "B04"],
    output: {
      bands: 3,
      sampleType: "AUTO"
    }
  }
}
function evaluatePixel(sample) {
  return [2.5 * sample.B04, 2.5 * sample.B03, 2.5 * sample.B02]
}`;

async function renderPreview(token) {
  const res = await fetch(CDSE_PROCESS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "image/png",
    },
    body: JSON.stringify({
      input: {
        bounds: {
          properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" },
          bbox: [119.5, 23.5, 120.5, 24.5], // 小区域，花莲附近
        },
        data: [
          {
            type: "sentinel-2-l2a",
            dataFilter: {
              timeRange: {
                from: "2024-05-20T00:00:00Z",
                to: "2024-06-01T00:00:00Z",
              },
              maxCloudCoverage: 30,
            },
          },
        ],
      },
      output: {
        width: 512,
        height: 512,
        responses: [{ identifier: "default", format: { type: "image/png" } }],
      },
      evalscript: TRUE_COLOR_EVALSCRIPT,
    }),
  });

  if (!res.ok) {
    throw new Error(`Process API failed: ${res.status} ${await res.text()}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  assert.ok(contentType.includes("image"), `Response must be image, got ${contentType}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  assert.ok(buffer.length > 1000, `Image too small (${buffer.length} bytes), likely empty/error`);

  return buffer;
}

// ─── Run Tests ───

console.log("[CDSE Smoke] Starting...\n");

// Test 1: Token
console.log("[Test 1] Getting access token...");
const { token, expiresIn } = await getAccessToken();
console.log(`  Token obtained, expires_in=${expiresIn}s, length=${token.length}`);

// Test 2: STAC Search
console.log("\n[Test 2] STAC search Sentinel-2 L2A (台湾海峡, 2024-05)...");
const stacResult = await searchStac(token);
console.log(`  Found ${stacResult.features.length} scenes`);

if (stacResult.features.length > 0) {
  const first = stacResult.features[0];
  console.log(`  First: ${first.id}`);
  console.log(`  Date: ${first.properties?.datetime}`);
  console.log(`  Cloud: ${first.properties?.["eo:cloud_cover"]}%`);
  console.log(`  Thumbnail: ${first.assets?.thumbnail?.href ? "available" : "missing"}`);
}

// Test 3: Process API Render
console.log("\n[Test 3] Process API render true-color PNG (花莲附近)...");
const imageBuffer = await renderPreview(token);
console.log(`  Image size: ${imageBuffer.length} bytes`);

// Save to disk for manual inspection
const outputPath = "test-cdse-preview.png";
await writeFile(outputPath, imageBuffer);
console.log(`  Saved to ${outputPath} — open it to verify visual quality`);

// Validate PNG header
assert.equal(imageBuffer[0], 0x89, "PNG magic byte 1");
assert.equal(imageBuffer[1], 0x50, "PNG magic byte 2");
assert.equal(imageBuffer[2], 0x4e, "PNG magic byte 3");
assert.equal(imageBuffer[3], 0x47, "PNG magic byte 4");

console.log("\n✅ CDSE API smoke test passed");
console.log("\nAssessment:");
console.log("  - OAuth2 token: working");
console.log("  - STAC search: working");
console.log("  - Process API render: working");
console.log("  - PNG output valid");
