import "dotenv/config";

const { buildDefaultToolRegistry } = await import("../../src/modules/agent-loop/tools/_shared/toolRegistry.js");

const registry = buildDefaultToolRegistry();
const taskId = `disaster-satellite-smoke-${Date.now()}`;
const query = "查询台湾海峡最近一周地震情况，并找一下灾后的卫星图";

function createContext(toolName: string) {
  return {
    taskId,
    query,
    observations: [],
    onProgress: (event: { stage?: string; message?: string; percent?: number; data?: unknown }) => {
      console.log(`[${toolName}] ${event.stage ?? ""} ${event.message ?? ""}`.trim());
    },
  };
}

console.log("=== Disaster-Satellite End-to-End Smoke ===\n");

// ─── Step 1: RegionResolve ───
console.log("[Step 1] RegionResolve('台湾海峡')");
const regionResolve = registry.get("RegionResolve")!;
const resolveOutput = await regionResolve.execute({ regionName: "台湾海峡" }, createContext("RegionResolve"));
console.log("  resolved:", resolveOutput.resolved);
console.log("  bbox:", JSON.stringify(resolveOutput.selected?.bbox));
console.log("  gisData:", resolveOutput.gisData ? `type=${resolveOutput.gisData.type}` : "none");
if (!resolveOutput.resolved) {
  console.error("  ❌ RegionResolve failed");
  process.exit(1);
}

// ─── Step 2: RegionMark ───
console.log("\n[Step 2] RegionMark(geometryRef)");
const regionMark = registry.get("RegionMark")!;
const markOutput = await regionMark.execute(
  {
    name: resolveOutput.selected.name,
    geometryRef: resolveOutput.selected.geometryRef,
    bbox: resolveOutput.selected.bbox,
    regionType: "monitor",
    label: resolveOutput.selected.name,
  },
  createContext("RegionMark")
);
console.log("  gisData.type:", markOutput.gisData?.type);
console.log("  cameraView:", JSON.stringify(markOutput.gisData?.cameraView));

// ─── Step 3: DisasterQuery ───
console.log("\n[Step 3] DisasterQuery(earthquake, 7d)");
const disasterQuery = registry.get("DisasterQuery")!;
const disasterOutput = await disasterQuery.execute(
  {
    regionName: "台湾海峡",
    bbox: resolveOutput.selected.bbox,
    disasterType: "earthquake",
    timeRange: "7d",
    minMagnitude: 4,
  },
  createContext("DisasterQuery")
);
console.log("  events:", disasterOutput.totalCount);
console.log("  summary:", disasterOutput.summary);

// ─── Step 4: SatelliteImageSearch ───
console.log("\n[Step 4] SatelliteImageSearch(post-disaster)");
const satelliteSearch = registry.get("SatelliteImageSearch")!;
const now = new Date();
const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
const satelliteOutput = await satelliteSearch.execute(
  {
    regionName: "台湾海峡",
    bbox: resolveOutput.selected.bbox,
    startDate: oneWeekAgo.toISOString().slice(0, 10),
    endDate: now.toISOString().slice(0, 10),
    maxCloudCoverage: 30,
    source: "any",
    maxResults: 3,
  },
  createContext("SatelliteImageSearch")
);
console.log("  images:", satelliteOutput.totalCount);
console.log("  summary:", satelliteOutput.summary);
console.log("  gisData.type:", satelliteOutput.gisData?.type);
console.log("  imageOverlays:", satelliteOutput.gisData?.imageOverlays?.length ?? 0);
if (satelliteOutput.gisData?.imageOverlays?.[0]) {
  const o = satelliteOutput.gisData.imageOverlays[0];
  console.log("    first overlay:", o.id, "→", o.url?.slice(0, 60) + "...");
  console.log("    rectangle:", JSON.stringify(o.rectangle));
}

// ─── Step 5: ImageAnalysis (if images found and QWEN key available) ───
const hasQwenKey = !!process.env.QWEN_API_KEY;
const thumbnailUrls = satelliteOutput.images
  .map((img: { thumbnailUrl?: string | null }) => img.thumbnailUrl)
  .filter(Boolean) as string[];

if (thumbnailUrls.length > 0 && hasQwenKey) {
  console.log("\n[Step 5] ImageAnalysis(thumbnail URLs)");
  const imageAnalysis = registry.get("ImageAnalysis")!;
  const analysisOutput = await imageAnalysis.execute(
    {
      imageUrls: thumbnailUrls.slice(0, 2),
      analysisType: "disaster_assessment",
      context: "台湾海峡最近地震后的卫星影像评估",
    },
    createContext("ImageAnalysis")
  );
  console.log("  summary:", analysisOutput.summary);
  console.log("  severity:", analysisOutput.assessment.severity);
  console.log("  confidence:", analysisOutput.assessment.confidence);
  console.log("  changes:", analysisOutput.assessment.changesDetected.length);
} else {
  console.log("\n[Step 5] ImageAnalysis SKIPPED");
  if (thumbnailUrls.length === 0) console.log("  reason: no thumbnail URLs available");
  if (!hasQwenKey) console.log("  reason: QWEN_API_KEY not configured");
}

// ─── Validation ───
console.log("\n=== Validation ===");
const checks = [
  { name: "RegionResolve resolved", pass: resolveOutput.resolved === true },
  { name: "RegionMark gisData.type=region", pass: markOutput.gisData?.type === "region" },
  { name: "RegionMark bbox matches resolve", pass: JSON.stringify(markOutput.bbox) === JSON.stringify(resolveOutput.selected.bbox) },
  { name: "DisasterQuery returned events", pass: disasterOutput.totalCount >= 0 },
  { name: "SatelliteImageSearch returned images", pass: satelliteOutput.totalCount >= 0 },
  { name: "SatelliteImageSearch gisData.type=image", pass: satelliteOutput.gisData?.type === "image" },
  { name: "SatelliteImageSearch has imageOverlays", pass: (satelliteOutput.gisData?.imageOverlays?.length ?? 0) > 0 },
  { name: "imageOverlays have valid URLs", pass: satelliteOutput.gisData?.imageOverlays?.every((o: { url: string }) => o.url?.startsWith("http")) ?? false },
];

let passed = 0;
let failed = 0;
for (const check of checks) {
  if (check.pass) {
    console.log(`  ✅ ${check.name}`);
    passed++;
  } else {
    console.log(`  ❌ ${check.name}`);
    failed++;
  }
}

console.log(`\n=== Result: ${passed}/${checks.length} passed ===`);
process.exit(failed > 0 ? 1 : 0);
