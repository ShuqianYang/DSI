# Oil Spill Mock Skill Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the deterministic East China Sea oil-spill tracing demo from the old `main` capability chain into the `agent-loop` branch as one skill plus isolated mock domain tools.

**Architecture:** Keep the East China Sea replay deterministic and explicitly mock-scoped, while preserving the old oil-spill satellite detector's `queryData` probe before local fallback. Add all demo-only tools and shared mock data under `api/src/modules/agent-loop/tools/domain/oilSpillMock/`, keep them hidden from the default Agent Loop domain catalog, and expose them only as skill-scoped tools after `skills/oil-spill-tracing/SKILL.md` is loaded. Add only a thin prompt-manager rule that routes oil-spill wording to the skill.

**Tech Stack:** Next.js app backend API, TypeScript 5, Agent Loop `ToolDefinition`, Zod schemas, local repository skills, existing `@datasourceintelligence/shared` GIS data shape, Node/tsx tests.

## Global Constraints

- Keep the East China Sea oil-spill scenario deterministic for demo replay.
- `OilSpillDetectMock` must call the old oil-spill `queryData` endpoint first.
- Only the East China Sea demo region may fall back to local `/satellite/oil-spill-1.png` when `queryData` has no valid oil-spill image.
- Non-East-China-Sea oil-spill requests must stop after `OilSpillDetectMock` when `queryData` has no valid result; do not continue into weather, drift, AIS, matching, or ranking.
- Put all simulated tools and simulated data in `api/src/modules/agent-loop/tools/domain/oilSpillMock/`.
- Use new explicit tool names with `Mock` suffix.
- Preserve old capability aliases where they do not collide with existing Agent Loop tools.
- Do not globally steal the existing `weather-fetch` alias from real `WeatherFetch`; call `WeatherFetchMock` by explicit name in the oil-spill skill.
- Keep multi-step GIS replay; do not collapse the scene into one aggregate tool.
- Tool outputs must expose `gisData` at the top level so `src/lib/agentLoopGisBridge.ts` can push layers from tool observations.
- Do not reintroduce the old Planner / Router / Executor runtime path.
- Do not use live weather or live AIS data in this mock scenario. The detector may call `queryData` only to preserve the old satellite lookup behavior.

---

## File Structure

- Create `api/src/modules/agent-loop/tools/domain/oilSpillMock/mockData.ts`
  - Owns all deterministic oil-spill mock constants: oil film geometry, SAR image bounds, wind field values, pollution origin, suspect vessels, trajectories, match info, and ranking breakdown.
- Create `api/src/modules/agent-loop/tools/domain/oilSpillMock/gisHelpers.ts`
  - Owns small pure helpers shared by tools: DMS formatting, circular polygon generation, compass conversion, bbox calculation, and deterministic wind grid generation.
- Create `api/src/modules/agent-loop/tools/domain/oilSpillMock/oilSpillDetect.ts`
  - Builds `OilSpillDetectMock`, alias `satelliteForOilDetect`, calls `queryData`, returns SAR overlay and oil-film GIS regions when a valid result exists or the East China Sea fallback is allowed.
- Create `api/src/modules/agent-loop/tools/domain/oilSpillMock/weatherFetch.ts`
  - Builds `WeatherFetchMock`, no `weather-fetch` alias because real `WeatherFetch` already owns it.
- Create `api/src/modules/agent-loop/tools/domain/oilSpillMock/oilDriftTrace.ts`
  - Builds `OilDriftTraceMock`, alias `oil-drift`, returning pollution origin and drift path.
- Create `api/src/modules/agent-loop/tools/domain/oilSpillMock/aisFetch.ts`
  - Builds `AisFetchMock`, alias `ais-fetch`, returning candidate vessels and history trajectories.
- Create `api/src/modules/agent-loop/tools/domain/oilSpillMock/aisMatchSuspects.ts`
  - Builds `AisMatchSuspectsMock`, alias `ais-match-suspects`, returning matched candidate vessels as warning entities.
- Create `api/src/modules/agent-loop/tools/domain/oilSpillMock/aisSuspectRanking.ts`
  - Builds `AisSuspectRankingMock`, alias `ais-suspect-ranking`, returning final ranked vessel entities.
- Create `api/src/modules/agent-loop/tools/domain/oilSpillMock/index.ts`
  - Exports `buildOilSpillMockTools()`.
- Modify `api/src/modules/agent-loop/tools/domain/index.ts`
  - Registers `buildOilSpillMockTools()`.
- Create `skills/oil-spill-tracing/SKILL.md`
  - Tells the model when to run the deterministic mock chain and the exact tool order.
- Modify `api/src/modules/agent-loop/promptManager.ts`
  - Adds a thin oil-spill routing rule and bumps `DEFAULT_PROMPT_COMPONENT_VERSIONS`.
- Create `api/tests/agent-loop/test-oil-spill-mock-tools.mjs`
  - Direct tool-gateway tests for deterministic outputs and GIS shapes.
- Create `api/tests/agent-loop/test-oil-spill-skill-doc.mjs`
  - Validates the skill doc names the mock tools and does not call real weather/satellite/AIS tools.
- Create `api/tests/agent-loop/test-prompt-manager-oil-spill-routing.mjs`
  - Validates the global prompt includes the thin routing rule.

---

### Task 1: Add Isolated Mock Data And Helpers

**Files:**
- Create: `api/src/modules/agent-loop/tools/domain/oilSpillMock/mockData.ts`
- Create: `api/src/modules/agent-loop/tools/domain/oilSpillMock/gisHelpers.ts`
- Test: `api/tests/agent-loop/test-oil-spill-mock-tools.mjs`

**Interfaces:**
- Produces:
  - `OIL_FILM_CENTER: { lng: number; lat: number }`
  - `OIL_FILM_OUTLINE: [number, number][]`
  - `OIL_SPILL_BOUNDS: { west: number; south: number; east: number; north: number }`
  - `POLLUTION_ORIGIN: [number, number]`
  - `SUSPECT_VESSELS`, `SUSPECT_TRAJECTORIES`, `MATCH_INFOS`, `RANKING_BREAKDOWN`
  - `buildCircle(centerLng, centerLat, radiusDeg, points): [number, number][]`
  - `toDMS(deg, isLng): string`
  - `buildMockWindField(center): { bbox, grid, u, v, speed, timestamp, source }`
- Consumes: old deterministic values from `main:api/src/modules/actions/capabilities/_mock/oil-spill-suspects.ts`, `satellite.ts`, `weather-fetch.ts`, and `oil-drift.ts`.

- [ ] **Step 1: Write the failing data/helper assertions**

Add the first version of `api/tests/agent-loop/test-oil-spill-mock-tools.mjs`:

```js
import assert from "node:assert/strict";

const data = await import("../../src/modules/agent-loop/tools/domain/oilSpillMock/mockData.ts");
const helpers = await import("../../src/modules/agent-loop/tools/domain/oilSpillMock/gisHelpers.ts");

assert.deepEqual(data.OIL_FILM_CENTER, { lng: 123.0125, lat: 30.2561 });
assert.deepEqual(data.POLLUTION_ORIGIN, [123.0375, 30.2761]);
assert.equal(data.SUSPECT_VESSELS.length, 5);
assert.equal(data.TOTAL_VESSEL_COUNT, 157);
assert.equal(data.TOTAL_RECORD_COUNT, 2863);

const ring = helpers.buildCircle(123.0375, 30.2761, 0.002, 16);
assert.equal(ring.length, 17);
assert.deepEqual(ring[0], ring.at(-1));
assert.equal(helpers.toDMS(123.0375, true), "东经123°02′15″");
assert.equal(helpers.toDMS(30.2761, false), "北纬30°16′34″");

const wind = helpers.buildMockWindField(data.OIL_FILM_CENTER);
assert.equal(wind.grid.rows, 10);
assert.equal(wind.grid.cols, 10);
assert.equal(wind.u.length, 100);
assert.equal(wind.v.length, 100);
assert.equal(wind.speed.every((value) => value === 3.2), true);

console.log("oil spill mock data/helper assertions passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api; ..\node_modules\.bin\tsx.CMD tests\agent-loop\test-oil-spill-mock-tools.mjs`

Expected: FAIL with module-not-found for `oilSpillMock/mockData.ts`.

- [ ] **Step 3: Create `mockData.ts`**

Create `api/src/modules/agent-loop/tools/domain/oilSpillMock/mockData.ts` by moving the deterministic constants from `main` into this isolated directory. Keep the values identical:

```ts
export const OIL_FILM_CENTER = { lng: 123.0125, lat: 30.2561 };

export const OIL_FILM_OUTLINE: [number, number][] = [
  [123.0, 30.25],
  [123.02, 30.25],
  [123.03, 30.26],
  [123.01, 30.27],
  [122.99, 30.26],
  [123.0, 30.25],
];

export const OIL_SPILL_BOUNDS = {
  west: 122.985,
  south: 30.238,
  east: 123.04,
  north: 30.274,
};

export const POLLUTION_ORIGIN: [number, number] = [123.0375, 30.2761];
export const TOTAL_VESSEL_COUNT = 157;
export const TOTAL_RECORD_COUNT = 2863;

export interface SuspectVessel {
  mmsi: string;
  name: string;
  type: "货轮" | "集装箱船" | "散货船" | "成品油轮" | "远洋渔船";
  flag: "CN" | "JP" | "KR" | "PA";
  length: number;
  width: number;
  dwt?: number;
  callSign: string;
  imo?: string;
}

export const SUSPECT_VESSELS: SuspectVessel[] = [
  { mmsi: "413567890", name: "远洋货轮01", type: "货轮", flag: "CN", length: 180, width: 28, dwt: 35000, callSign: "BVZQ7", imo: "9456789" },
  { mmsi: "431758432", name: "KOBE STAR", type: "集装箱船", flag: "JP", length: 260, width: 32, dwt: 50000, callSign: "7JFA", imo: "9712345" },
  { mmsi: "440912756", name: "DAEYANG VICTORY", type: "散货船", flag: "KR", length: 220, width: 32, dwt: 60000, callSign: "DSVT7", imo: "9645234" },
  { mmsi: "357654321", name: "OCEAN PEARL", type: "成品油轮", flag: "PA", length: 185, width: 27, dwt: 40000, callSign: "3FQH8", imo: "9523456" },
  { mmsi: "412987654", name: "浙象渔18866", type: "远洋渔船", flag: "CN", length: 38, width: 7, callSign: "BX18866" },
];

export interface TrajectoryPoint {
  coord: [number, number];
  hoursAgo: number;
  speedKn: number;
  heading: number;
}

export const SUSPECT_TRAJECTORIES: Record<string, TrajectoryPoint[]> = {
  "413567890": [
    { coord: [122.2, 30.3], hoursAgo: 72, speedKn: 14, heading: 95 },
    { coord: [122.55, 30.32], hoursAgo: 60, speedKn: 13, heading: 90 },
    { coord: [122.85, 30.3], hoursAgo: 48, speedKn: 13, heading: 95 },
    { coord: [122.98, 30.29], hoursAgo: 40, speedKn: 12, heading: 80 },
    { coord: [123.035, 30.275], hoursAgo: 36.2, speedKn: 4, heading: 45 },
    { coord: [123.0375, 30.2761], hoursAgo: 35.8, speedKn: 1, heading: 0 },
    { coord: [123.0392, 30.2775], hoursAgo: 35.5, speedKn: 1, heading: 30 },
    { coord: [123.06, 30.3], hoursAgo: 34.6, speedKn: 16, heading: 60 },
    { coord: [123.4, 30.5], hoursAgo: 24, speedKn: 15, heading: 65 },
    { coord: [124.1, 30.95], hoursAgo: 8, speedKn: 14, heading: 70 },
  ],
  "431758432": [
    { coord: [121.55, 31.3], hoursAgo: 68, speedKn: 15, heading: 100 },
    { coord: [122.1, 30.95], hoursAgo: 58, speedKn: 16, heading: 105 },
    { coord: [122.6, 30.65], hoursAgo: 46, speedKn: 16, heading: 110 },
    { coord: [122.95, 30.4], hoursAgo: 38, speedKn: 14, heading: 115 },
    { coord: [123.03, 30.29], hoursAgo: 36.5, speedKn: 8, heading: 100 },
    { coord: [123.035, 30.278], hoursAgo: 36.0, speedKn: 5, heading: 95 },
    { coord: [123.039, 30.27], hoursAgo: 35.7, speedKn: 6, heading: 90 },
    { coord: [123.12, 30.18], hoursAgo: 34.5, speedKn: 15, heading: 110 },
    { coord: [124.5, 29.5], hoursAgo: 20, speedKn: 16, heading: 115 },
    { coord: [126.8, 29.2], hoursAgo: 6, speedKn: 16, heading: 120 },
  ],
  "440912756": [
    { coord: [127.5, 33.8], hoursAgo: 70, speedKn: 14, heading: 240 },
    { coord: [126.2, 32.5], hoursAgo: 60, speedKn: 14, heading: 235 },
    { coord: [124.8, 31.2], hoursAgo: 48, speedKn: 14, heading: 240 },
    { coord: [123.5, 30.5], hoursAgo: 40, speedKn: 13, heading: 245 },
    { coord: [123.1, 30.3], hoursAgo: 37, speedKn: 10, heading: 250 },
    { coord: [123.042, 30.28], hoursAgo: 36.3, speedKn: 6, heading: 270 },
    { coord: [123.04, 30.272], hoursAgo: 36.0, speedKn: 2, heading: 320 },
    { coord: [123.038, 30.276], hoursAgo: 35.7, speedKn: 3, heading: 200 },
    { coord: [122.5, 30.1], hoursAgo: 20, speedKn: 14, heading: 240 },
    { coord: [121.8, 31.1], hoursAgo: 6, speedKn: 13, heading: 270 },
  ],
  "357654321": [
    { coord: [121.8, 28.5], hoursAgo: 68, speedKn: 13, heading: 60 },
    { coord: [122.3, 29.2], hoursAgo: 58, speedKn: 13, heading: 50 },
    { coord: [122.8, 29.8], hoursAgo: 46, speedKn: 12, heading: 45 },
    { coord: [123.0, 30.2], hoursAgo: 38, speedKn: 11, heading: 40 },
    { coord: [123.045, 30.275], hoursAgo: 36.5, speedKn: 7, heading: 30 },
    { coord: [123.041, 30.272], hoursAgo: 36.25, speedKn: 4, heading: 350 },
    { coord: [123.038, 30.275], hoursAgo: 36.05, speedKn: 5, heading: 0 },
    { coord: [123.025, 30.29], hoursAgo: 35.75, speedKn: 9, heading: 340 },
    { coord: [122.85, 30.95], hoursAgo: 24, speedKn: 12, heading: 320 },
    { coord: [122.2, 31.85], hoursAgo: 8, speedKn: 12, heading: 320 },
  ],
  "412987654": [
    { coord: [122.5, 30.1], hoursAgo: 70, speedKn: 6, heading: 80 },
    { coord: [122.75, 30.15], hoursAgo: 60, speedKn: 5, heading: 70 },
    { coord: [122.95, 30.22], hoursAgo: 48, speedKn: 4, heading: 60 },
    { coord: [123.05, 30.28], hoursAgo: 40, speedKn: 5, heading: 50 },
    { coord: [123.03, 30.272], hoursAgo: 36.5, speedKn: 7, heading: 90 },
    { coord: [123.043, 30.272], hoursAgo: 36.37, speedKn: 7, heading: 90 },
    { coord: [123.1, 30.25], hoursAgo: 36.0, speedKn: 8, heading: 100 },
    { coord: [123.3, 30.1], hoursAgo: 24, speedKn: 6, heading: 130 },
    { coord: [123.55, 29.8], hoursAgo: 12, speedKn: 7, heading: 150 },
    { coord: [123.7, 29.5], hoursAgo: 4, speedKn: 6, heading: 170 },
  ],
};

export interface MatchInfo {
  mmsi: string;
  matchedAt: [number, number];
  stayDurationMin: number;
  closestDistanceM: number;
  aisGapMin: number;
}

export const MATCH_INFOS: MatchInfo[] = [
  { mmsi: "413567890", matchedAt: [123.0375, 30.2761], stayDurationMin: 22, closestDistanceM: 80, aisGapMin: 0 },
  { mmsi: "431758432", matchedAt: [123.035, 30.278], stayDurationMin: 15, closestDistanceM: 240, aisGapMin: 0 },
  { mmsi: "440912756", matchedAt: [123.04, 30.272], stayDurationMin: 18, closestDistanceM: 320, aisGapMin: 0 },
  { mmsi: "357654321", matchedAt: [123.041, 30.272], stayDurationMin: 12, closestDistanceM: 450, aisGapMin: 5 },
  { mmsi: "412987654", matchedAt: [123.043, 30.272], stayDurationMin: 8, closestDistanceM: 850, aisGapMin: 0 },
];

export type SuspectLevel = "primary" | "secondary" | "normal";

export interface RankingBreakdown {
  mmsi: string;
  score: number;
  rank: number;
  level: SuspectLevel;
  breakdown: { distance: number; stay: number; behavior: number };
  reasons: string;
}

export const RANKING_BREAKDOWN: RankingBreakdown[] = [
  { mmsi: "413567890", score: 86, rank: 1, level: "primary", breakdown: { distance: 40, stay: 30, behavior: 16 }, reasons: "距排污原点 80m（最近，40分）| 异常停留 22 分钟（30分）| 航线绕路偏离常规东海航道（16分）" },
  { mmsi: "431758432", score: 72, rank: 2, level: "secondary", breakdown: { distance: 30, stay: 22, behavior: 20 }, reasons: "距原点 240m（30分）| 停留 15 分钟（22分）| 减速但无明显异动（20分）" },
  { mmsi: "440912756", score: 68, rank: 3, level: "secondary", breakdown: { distance: 20, stay: 22, behavior: 26 }, reasons: "距原点 320m（20分）| 停留 18 分钟（22分）| 反复转向（26分）" },
  { mmsi: "357654321", score: 65, rank: 4, level: "secondary", breakdown: { distance: 20, stay: 15, behavior: 30 }, reasons: "距原点 450m（20分）| 停留 12 分钟（15分）| AIS 信号断 5 分钟（30分，权宜旗+断点重点关注）" },
  { mmsi: "412987654", score: 45, rank: 5, level: "normal", breakdown: { distance: 10, stay: 8, behavior: 27 }, reasons: "距原点 850m（10分）| 短停 8 分钟（8分）| 航迹自然无异动（27分）— 判定为正常过路渔船" },
];

export function getVessel(mmsi: string): SuspectVessel | undefined {
  return SUSPECT_VESSELS.find((vessel) => vessel.mmsi === mmsi);
}

export function getMatch(mmsi: string): MatchInfo | undefined {
  return MATCH_INFOS.find((match) => match.mmsi === mmsi);
}

export function getRanking(mmsi: string): RankingBreakdown | undefined {
  return RANKING_BREAKDOWN.find((ranking) => ranking.mmsi === mmsi);
}
```

- [ ] **Step 4: Create `gisHelpers.ts`**

Create `api/src/modules/agent-loop/tools/domain/oilSpillMock/gisHelpers.ts`:

```ts
export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

const GRID = 10;
const HALF_SPAN_DEG = 0.5;
const MOCK_WIND_SPEED = 3.2;
const MOCK_WIND_DIR_DEG = 45;

export function toDMS(deg: number, isLng: boolean): string {
  const absDeg = Math.abs(deg);
  const d = Math.floor(absDeg);
  const minDec = (absDeg - d) * 60;
  const m = Math.floor(minDec);
  const s = Math.round((minDec - m) * 60);
  const prefix = isLng ? (deg >= 0 ? "东经" : "西经") : deg >= 0 ? "北纬" : "南纬";
  return `${prefix}${d}°${String(m).padStart(2, "0")}′${String(s).padStart(2, "0")}″`;
}

export function buildCircle(centerLng: number, centerLat: number, radiusDeg: number, points: number): [number, number][] {
  const ring: [number, number][] = [];
  const latScale = Math.cos((centerLat * Math.PI) / 180);
  for (let index = 0; index < points; index += 1) {
    const angle = (index / points) * 2 * Math.PI;
    ring.push([
      Number((centerLng + radiusDeg * Math.cos(angle)).toFixed(5)),
      Number((centerLat + radiusDeg * Math.sin(angle) * latScale).toFixed(5)),
    ]);
  }
  ring.push(ring[0]!);
  return ring;
}

export function compassWindToFlowDeg(windDirection: string): number {
  const key = windDirection.replace(/风$/, "").trim();
  const fromDeg: Record<string, number> = { 北: 0, 东北: 45, 东: 90, 东南: 135, 南: 180, 西南: 225, 西: 270, 西北: 315 };
  return ((fromDeg[key] ?? 45) + 180) % 360;
}

export function degreesToCompass(degrees: number): string {
  const dirs = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
  return dirs[Math.round(((degrees % 360) + 360) / 45) % 8]!;
}

export function directionSpeedToUv(speed: number, directionDeg: number): { u: number; v: number } {
  const flowDeg = (directionDeg + 180) % 360;
  const rad = (flowDeg * Math.PI) / 180;
  return {
    u: Number((speed * Math.sin(rad)).toFixed(2)),
    v: Number((speed * Math.cos(rad)).toFixed(2)),
  };
}

export function bboxFromCoordinates(coordinates: [number, number][]): Bbox {
  const lngs = coordinates.map(([lng]) => lng);
  const lats = coordinates.map(([, lat]) => lat);
  return {
    west: Math.min(...lngs),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    north: Math.max(...lats),
  };
}

export function buildMockWindField(center: { lng: number; lat: number }): {
  bbox: Bbox;
  grid: { rows: number; cols: number };
  u: number[];
  v: number[];
  speed: number[];
  timestamp: string;
  source: "oil-spill-mock";
} {
  const bbox = {
    west: center.lng - HALF_SPAN_DEG,
    east: center.lng + HALF_SPAN_DEG,
    south: center.lat - HALF_SPAN_DEG,
    north: center.lat + HALF_SPAN_DEG,
  };
  const vector = directionSpeedToUv(MOCK_WIND_SPEED, MOCK_WIND_DIR_DEG);
  return {
    bbox,
    grid: { rows: GRID, cols: GRID },
    u: new Array(GRID * GRID).fill(vector.u),
    v: new Array(GRID * GRID).fill(vector.v),
    speed: new Array(GRID * GRID).fill(MOCK_WIND_SPEED),
    timestamp: "2026-06-23T00:00:00.000+08:00",
    source: "oil-spill-mock",
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api; ..\node_modules\.bin\tsx.CMD tests\agent-loop\test-oil-spill-mock-tools.mjs`

Expected: PASS and prints `oil spill mock data/helper assertions passed`.

- [ ] **Step 6: Commit**

Run:

```powershell
git add api/src/modules/agent-loop/tools/domain/oilSpillMock/mockData.ts api/src/modules/agent-loop/tools/domain/oilSpillMock/gisHelpers.ts api/tests/agent-loop/test-oil-spill-mock-tools.mjs
git commit -m "feat(agent-loop): add oil spill mock data"
```

---

### Task 2: Add Detection, Weather, And Drift Mock Tools

**Files:**
- Create: `api/src/modules/agent-loop/tools/domain/oilSpillMock/oilSpillDetect.ts`
- Create: `api/src/modules/agent-loop/tools/domain/oilSpillMock/weatherFetch.ts`
- Create: `api/src/modules/agent-loop/tools/domain/oilSpillMock/oilDriftTrace.ts`
- Create: `api/src/modules/agent-loop/tools/domain/oilSpillMock/index.ts`
- Modify: `api/src/modules/agent-loop/tools/domain/index.ts`
- Test: `api/tests/agent-loop/test-oil-spill-mock-tools.mjs`

**Interfaces:**
- Consumes: `OIL_FILM_CENTER`, `OIL_FILM_OUTLINE`, `OIL_SPILL_BOUNDS`, `POLLUTION_ORIGIN`, `buildMockWindField`, `buildCircle`, `toDMS`, `compassWindToFlowDeg`.
- Produces:
  - `buildOilSpillDetectMockTool(): ToolDefinition`
  - `buildWeatherFetchMockTool(): ToolDefinition`
  - `buildOilDriftTraceMockTool(): ToolDefinition`
  - `buildOilSpillMockTools(): ToolDefinition[]`

- [ ] **Step 1: Extend failing tool assertions**

Append to `api/tests/agent-loop/test-oil-spill-mock-tools.mjs`:

```js
const { buildDefaultToolRegistry } = await import("../../src/modules/agent-loop/tools/_shared/toolRegistry.ts");
const { callTool } = await import("../../src/modules/agent-loop/tools/_shared/toolGateway.ts");

const registry = buildDefaultToolRegistry();

assert.ok(registry.get("OilSpillDetectMock"), "OilSpillDetectMock should be registered");
assert.ok(registry.get("WeatherFetchMock"), "WeatherFetchMock should be registered");
assert.ok(registry.get("OilDriftTraceMock"), "OilDriftTraceMock should be registered");
assert.equal(registry.get("satelliteForOilDetect")?.name, "OilSpillDetectMock");
assert.notEqual(registry.get("satellite")?.name, "OilSpillDetectMock");
assert.ok(registry.get("oil-drift"), "oil-drift alias should resolve to OilDriftTraceMock");
assert.equal(registry.get("weather-fetch")?.name, "WeatherFetch", "weather-fetch alias remains owned by real WeatherFetch");

const toolContext = { taskId: "oil-spill-mock-tools", query: "查询东海漏油", observations: [] };

const fetchCalls = [];
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), body: String(init?.body ?? "") });
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    async json() {
      return { state: true, value: { records: [] } };
    },
  };
};

const detectObservation = await callTool(
  registry,
  { id: "detect", toolName: "OilSpillDetectMock", input: { region: "中国东海" } },
  toolContext,
);
assert.equal(detectObservation.ok, true);
assert.equal(fetchCalls.length, 1);
assert.equal(detectObservation.output.oilSpill.centerLng, 123.0125);
assert.equal(detectObservation.output.shouldContinue, true);
assert.equal(detectObservation.output.imageSource, "local-fallback");
assert.equal(detectObservation.output.gisData.type, "region");
assert.equal(detectObservation.output.gisData.imageOverlays.length, 1);

const otherRegionObservation = await callTool(
  registry,
  { id: "detect-other", toolName: "OilSpillDetectMock", input: { region: "南海" } },
  toolContext,
);
assert.equal(otherRegionObservation.ok, true);
assert.equal(otherRegionObservation.output.shouldContinue, false);
assert.equal(otherRegionObservation.output.reason, "queryData_no_valid_oil_spill_result");
assert.equal("gisData" in otherRegionObservation.output, false);

const weatherObservation = await callTool(
  registry,
  { id: "weather", toolName: "WeatherFetchMock", input: { region: "东海油膜片区" } },
  toolContext,
);
assert.equal(weatherObservation.ok, true);
assert.equal(weatherObservation.output.windSpeed, 3.2);
assert.equal(weatherObservation.output.windDirection, "东北");
assert.equal(weatherObservation.output.gisData.type, "wind-field");

const driftObservation = await callTool(
  registry,
  { id: "drift", toolName: "OilDriftTraceMock", input: {} },
  {
    ...toolContext,
    observations: [
      { toolCallId: "detect", toolName: "OilSpillDetectMock", ok: true, output: detectObservation.output },
      { toolCallId: "weather", toolName: "WeatherFetchMock", ok: true, output: weatherObservation.output },
    ],
  },
);
assert.equal(driftObservation.ok, true);
assert.equal(driftObservation.output.pollutionOrigin.lng, 123.0375);
assert.equal(driftObservation.output.gisData.trajectories[0].id, "drift-path");
assert.equal(driftObservation.output.gisData.regions[0].id, "pollution-origin-area");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api; ..\node_modules\.bin\tsx.CMD tests\agent-loop\test-oil-spill-mock-tools.mjs`

Expected: FAIL because `OilSpillDetectMock` is not registered.

- [ ] **Step 3: Implement `OilSpillDetectMock`**

Create `api/src/modules/agent-loop/tools/domain/oilSpillMock/oilSpillDetect.ts`:

```ts
import { z } from "zod";
import type { ToolDefinition, ToolExecutionContext } from "../../_shared/types.js";
import { OIL_FILM_CENTER, OIL_FILM_OUTLINE, OIL_SPILL_BOUNDS } from "./mockData.js";

const DEFAULT_QUERY_DATA_URL = "http://192.168.0.129:5000/agent/queryData";
const REQUEST_TIMEOUT_MS = 5_000;

const InputSchema = z.strictObject({
  region: z.string().trim().min(1).default("中国东海"),
  queryDataUrl: z.string().url().default(DEFAULT_QUERY_DATA_URL),
});

interface QueryDataResponse {
  state?: boolean;
  value?: {
    records?: Array<{
      previewUrl?: string;
    }>;
  };
}

function isEastChinaSea(region: string): boolean {
  return ["东海", "中国东海", "East China Sea", "Eastern China Sea"].includes(region.trim());
}

async function fetchOilSpillImageUrl(input: z.infer<typeof InputSchema>, context: ToolExecutionContext): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("queryData_timeout"), REQUEST_TIMEOUT_MS);
  const abortFromParent = () => controller.abort(context.signal?.reason ?? "aborted");
  if (context.signal?.aborted) abortFromParent();
  context.signal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    const response = await fetch(input.queryDataUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        pageNo: 1,
        pageSize: 10,
        satelliteName: "高分五号A星",
        payloadType: ["红外"],
        productType: "目标切片",
        dataType: "漏油",
        targetType: "漏油",
        targetName: input.region,
        reqObj: "天元认知计算",
        reqContent: `接收到天元认知计算系统的历史影像查询(油膜)需求，区域=${input.region}，完成影像检索并反馈`,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const json = (await response.json()) as QueryDataResponse;
    if (!json.state) return null;
    return json.value?.records?.find((record) => record.previewUrl)?.previewUrl ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    context.signal?.removeEventListener("abort", abortFromParent);
  }
}

function buildOilSpillDetectionOutput(input: z.infer<typeof InputSchema>, imageUrl: string, imageSource: "queryData" | "local-fallback") {
  return {
    summary: `天基遥感影像AI识别完成。在 ${input.region} 区域发现疑似油膜区域。`,
    region: input.region,
    shouldContinue: true,
    imageSource,
    imageCount: 32,
    resolution: "0.8-1m",
    cloudCover: "<8%",
    satelliteType: "SAR",
    oilSpill: {
      areaKm2: 0.3,
      centerLng: OIL_FILM_CENTER.lng,
      centerLat: OIL_FILM_CENTER.lat,
      outline: OIL_FILM_OUTLINE,
    },
    gisData: {
      type: "region" as const,
      regions: [
        {
          id: "oil-spill-area",
          name: "疑似油膜区域",
          type: "monitor" as const,
          coordinates: OIL_FILM_OUTLINE,
          style: { fill: false, outlineColor: "#FFAA00", outlineWidth: 2 },
          label: { text: "疑似油膜区域\n面积: 0.3km²", position: [OIL_FILM_CENTER.lng, OIL_FILM_CENTER.lat] as [number, number] },
        },
        {
          id: "sar-image-bounds",
          name: "SAR影像范围",
          type: "monitor" as const,
          coordinates: [
            [OIL_SPILL_BOUNDS.west, OIL_SPILL_BOUNDS.south],
            [OIL_SPILL_BOUNDS.east, OIL_SPILL_BOUNDS.south],
            [OIL_SPILL_BOUNDS.east, OIL_SPILL_BOUNDS.north],
            [OIL_SPILL_BOUNDS.west, OIL_SPILL_BOUNDS.north],
            [OIL_SPILL_BOUNDS.west, OIL_SPILL_BOUNDS.south],
          ] as [number, number][],
          style: { fill: false, outlineColor: "#FF0000", outlineWidth: 4 },
          label: { text: "SAR影像范围", position: [OIL_SPILL_BOUNDS.east, OIL_SPILL_BOUNDS.north] as [number, number] },
        },
      ],
      imageOverlays: [
        {
          id: "oil-spill-sar-1",
          url: imageUrl,
          rectangle: OIL_SPILL_BOUNDS,
          alpha: 0.85,
          tileWidth: 1402,
          tileHeight: 1122,
        },
      ],
      cameraView: { type: "point" as const, lng: 123.014109, lat: 30.258168, altitude: 11967 },
    },
    metadata: { capability: "satellite", mock: true, responseType: "oil_spill_detection", imageSource },
  };
}

export function buildOilSpillDetectMockTool(): ToolDefinition {
  return {
    name: "OilSpillDetectMock",
    aliases: ["satelliteForOilDetect"],
    description: "Oil-spill detector for the mock replay. It calls the old queryData oil-spill lookup first; East China Sea may fall back to a local demo SAR image, other regions stop when queryData has no valid result.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute(input, context) {
      const parsed = input as z.infer<typeof InputSchema>;
      const queryDataImageUrl = await fetchOilSpillImageUrl(parsed, context);
      if (queryDataImageUrl) {
        return buildOilSpillDetectionOutput(parsed, queryDataImageUrl, "queryData");
      }
      if (isEastChinaSea(parsed.region)) {
        return buildOilSpillDetectionOutput(parsed, "/satellite/oil-spill-1.png", "local-fallback");
      }
      return {
        summary: `${parsed.region} 未从 queryData 获取到有效漏油/油膜影像，停止油污溯源流程。`,
        region: parsed.region,
        shouldContinue: false,
        reason: "queryData_no_valid_oil_spill_result",
        metadata: {
          capability: "satellite",
          mock: true,
          responseType: "oil_spill_detection_empty",
          imageSource: "queryData",
        },
      };
    },
  };
}
```

- [ ] **Step 4: Implement `WeatherFetchMock`**

Create `api/src/modules/agent-loop/tools/domain/oilSpillMock/weatherFetch.ts`:

```ts
import { z } from "zod";
import type { ToolDefinition } from "../../_shared/types.js";
import { OIL_FILM_CENTER } from "./mockData.js";
import { buildMockWindField } from "./gisHelpers.js";

const InputSchema = z.strictObject({
  region: z.string().trim().min(1).default("东海油膜片区"),
});

export function buildWeatherFetchMockTool(): ToolDefinition {
  return {
    name: "WeatherFetchMock",
    aliases: ["oil-spill-weather-fetch"],
    description: "Deterministic mock weather and ocean-current data for the East China Sea oil-spill demo. Use this only inside oil-spill tracing.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute(input) {
      const parsed = input as z.infer<typeof InputSchema>;
      const windField = buildMockWindField(OIL_FILM_CENTER);
      return {
        summary: "风 3.2 m/s · 东北风 | 洋流 0.8 m/s · 东南向 | 数据源: oil-spill-mock",
        windSpeed: 3.2,
        windDirection: "东北",
        currentSpeed: 0.8,
        currentDirection: "东南",
        period: "近72小时",
        region: parsed.region,
        dataSource: "oil-spill-mock",
        gisData: {
          type: "wind-field" as const,
          windField,
        },
        metadata: { capability: "weather-fetch", mock: true, dataSource: "oil-spill-mock" },
      };
    },
  };
}
```

- [ ] **Step 5: Implement `OilDriftTraceMock`**

Create `api/src/modules/agent-loop/tools/domain/oilSpillMock/oilDriftTrace.ts`:

```ts
import { z } from "zod";
import type { ToolDefinition, ToolObservation } from "../../_shared/types.js";
import { OIL_FILM_CENTER, POLLUTION_ORIGIN } from "./mockData.js";
import { buildCircle, compassWindToFlowDeg, toDMS } from "./gisHelpers.js";

const InputSchema = z.strictObject({});

function readOutputRecord(observation: ToolObservation): Record<string, unknown> {
  return observation.output && typeof observation.output === "object" && !Array.isArray(observation.output)
    ? (observation.output as Record<string, unknown>)
    : {};
}

function pickOilCenter(observations: ToolObservation[]): { lng: number; lat: number } {
  for (const observation of observations) {
    const output = readOutputRecord(observation);
    const oilSpill = output.oilSpill as { centerLng?: number; centerLat?: number } | undefined;
    if (typeof oilSpill?.centerLng === "number" && typeof oilSpill.centerLat === "number") {
      return { lng: oilSpill.centerLng, lat: oilSpill.centerLat };
    }
  }
  return OIL_FILM_CENTER;
}

function pickWeather(observations: ToolObservation[]): { windSpeed: number; windDirection: string; currentSpeed: number; currentDirection: string } {
  for (const observation of observations) {
    const output = readOutputRecord(observation);
    if (typeof output.windSpeed === "number" && typeof output.currentSpeed === "number") {
      return {
        windSpeed: output.windSpeed,
        windDirection: typeof output.windDirection === "string" ? output.windDirection : "东北",
        currentSpeed: output.currentSpeed,
        currentDirection: typeof output.currentDirection === "string" ? output.currentDirection : "东南",
      };
    }
  }
  return { windSpeed: 3.2, windDirection: "东北", currentSpeed: 0.8, currentDirection: "东南" };
}

export function buildOilDriftTraceMockTool(): ToolDefinition {
  return {
    name: "OilDriftTraceMock",
    aliases: ["oil-drift"],
    description: "Deterministic mock oil-drift backtrace for the East China Sea oil-spill demo.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute(_input, context) {
      const oilCenter = pickOilCenter(context.observations);
      const weather = pickWeather(context.observations);
      const [originLng, originLat] = POLLUTION_ORIGIN;
      const offsetLng = Number((originLng - oilCenter.lng).toFixed(4));
      const offsetLat = Number((originLat - oilCenter.lat).toFixed(4));
      const driftPath = Array.from({ length: 5 }, (_value, index) => {
        const t = index / 4;
        return [
          Number((originLng - offsetLng * t).toFixed(4)),
          Number((originLat - offsetLat * t).toFixed(4)),
        ] as [number, number];
      });
      const originLngDMS = toDMS(originLng, true);
      const originLatDMS = toDMS(originLat, false);

      return {
        summary: `油污漂移反推完成。排污原点 ${originLngDMS}, ${originLatDMS}。`,
        driftPathLengthKm: 3.3,
        driftPath,
        pollutionOrigin: {
          lng: originLng,
          lat: originLat,
          lngDMS: originLngDMS,
          latDMS: originLatDMS,
          timeRange: "近72小时内10:00-12:00（UTC+8）",
          confidence: "误差≤2小时",
        },
        weatherInput: weather,
        gisData: {
          type: "trajectory" as const,
          trajectories: [
            { id: "drift-path", name: "油污漂移溯源路径", type: "route" as const, coordinates: driftPath, status: "history" as const },
          ],
          regions: [
            {
              id: "pollution-origin-area",
              name: "排污原点",
              type: "monitor" as const,
              coordinates: buildCircle(originLng, originLat, 0.002, 16),
              style: {
                fill: true,
                fillColor: "rgba(220, 38, 38, 0.4)",
                outlineColor: "#dc2626",
                outlineWidth: 3,
                diffusion: { windFlowDeg: compassWindToFlowDeg(weather.windDirection), windSpeed: weather.windSpeed },
              },
              label: { text: `排污原点\n${originLngDMS}\n${originLatDMS}`, position: [originLng, originLat + 0.003] as [number, number] },
            },
          ],
          cameraView: { type: "point" as const, lng: 123.035275, lat: 30.271615, altitude: 7968 },
        },
        metadata: { capability: "oil-drift", mock: true, oilCenter },
      };
    },
  };
}
```

- [ ] **Step 6: Register the first mock tools**

Create `api/src/modules/agent-loop/tools/domain/oilSpillMock/index.ts`:

```ts
import type { ToolDefinition } from "../../_shared/types.js";
import { buildOilSpillDetectMockTool } from "./oilSpillDetect.js";
import { buildWeatherFetchMockTool } from "./weatherFetch.js";
import { buildOilDriftTraceMockTool } from "./oilDriftTrace.js";

export function buildOilSpillMockTools(): ToolDefinition[] {
  return [
    buildOilSpillDetectMockTool(),
    buildWeatherFetchMockTool(),
    buildOilDriftTraceMockTool(),
  ];
}
```

Do not import or append these tools in default `api/src/modules/agent-loop/tools/domain/index.ts`.
They are registered as hidden skill-scoped tools when `oil-spill-tracing` is loaded.

- [ ] **Step 7: Run test to verify it passes**

Run: `cd api; ..\node_modules\.bin\tsx.CMD tests\agent-loop\test-oil-spill-mock-tools.mjs`

Expected: PASS.

- [ ] **Step 8: Run type check**

Run: `cd api; ..\node_modules\.bin\tsc.CMD -p tsconfig.json --noEmit --pretty false`

Expected: PASS with no TypeScript errors.

- [ ] **Step 9: Commit**

Run:

```powershell
git add api/src/modules/agent-loop/tools/domain/index.ts api/src/modules/agent-loop/tools/domain/oilSpillMock api/tests/agent-loop/test-oil-spill-mock-tools.mjs
git commit -m "feat(agent-loop): add oil spill detection and drift mock tools"
```

---

### Task 3: Add AIS Candidate, Match, And Ranking Mock Tools

**Files:**
- Create: `api/src/modules/agent-loop/tools/domain/oilSpillMock/aisFetch.ts`
- Create: `api/src/modules/agent-loop/tools/domain/oilSpillMock/aisMatchSuspects.ts`
- Create: `api/src/modules/agent-loop/tools/domain/oilSpillMock/aisSuspectRanking.ts`
- Modify: `api/src/modules/agent-loop/tools/domain/oilSpillMock/index.ts`
- Test: `api/tests/agent-loop/test-oil-spill-mock-tools.mjs`

**Interfaces:**
- Consumes: `SUSPECT_VESSELS`, `SUSPECT_TRAJECTORIES`, `MATCH_INFOS`, `RANKING_BREAKDOWN`, `POLLUTION_ORIGIN`, helper lookup functions.
- Produces:
  - `buildAisFetchMockTool(): ToolDefinition`
  - `buildAisMatchSuspectsMockTool(): ToolDefinition`
  - `buildAisSuspectRankingMockTool(): ToolDefinition`

- [ ] **Step 1: Extend failing AIS assertions**

Append to `api/tests/agent-loop/test-oil-spill-mock-tools.mjs`:

```js
assert.ok(registry.get("AisFetchMock"), "AisFetchMock should be registered");
assert.ok(registry.get("AisMatchSuspectsMock"), "AisMatchSuspectsMock should be registered");
assert.ok(registry.get("AisSuspectRankingMock"), "AisSuspectRankingMock should be registered");
assert.ok(registry.get("ais-fetch"), "ais-fetch alias should resolve");
assert.ok(registry.get("ais-match-suspects"), "ais-match-suspects alias should resolve");
assert.ok(registry.get("ais-suspect-ranking"), "ais-suspect-ranking alias should resolve");

const aisObservation = await callTool(
  registry,
  { id: "ais", toolName: "AisFetchMock", input: { region: "中国东海" } },
  toolContext,
);
assert.equal(aisObservation.ok, true);
assert.equal(aisObservation.output.vesselCount, 157);
assert.equal(aisObservation.output.displayedCount, 5);
assert.equal(aisObservation.output.gisData.entities.length, 5);
assert.equal(aisObservation.output.gisData.trajectories.length, 5);

const matchObservation = await callTool(
  registry,
  { id: "match", toolName: "AisMatchSuspectsMock", input: {} },
  {
    ...toolContext,
    observations: [
      { toolCallId: "drift", toolName: "OilDriftTraceMock", ok: true, output: driftObservation.output },
      { toolCallId: "ais", toolName: "AisFetchMock", ok: true, output: aisObservation.output },
    ],
  },
);
assert.equal(matchObservation.ok, true);
assert.equal(matchObservation.output.matchedCount, 5);
assert.equal(matchObservation.output.gisData.entities.every((entity) => entity.status === "warning"), true);

const rankingObservation = await callTool(
  registry,
  { id: "ranking", toolName: "AisSuspectRankingMock", input: {} },
  {
    ...toolContext,
    observations: [
      { toolCallId: "match", toolName: "AisMatchSuspectsMock", ok: true, output: matchObservation.output },
    ],
  },
);
assert.equal(rankingObservation.ok, true);
assert.equal(rankingObservation.output.primary[0].mmsi, "413567890");
assert.equal(rankingObservation.output.gisData.entities.find((entity) => entity.id === "413567890").status, "danger");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api; ..\node_modules\.bin\tsx.CMD tests\agent-loop\test-oil-spill-mock-tools.mjs`

Expected: FAIL because `AisFetchMock` is not registered.

- [ ] **Step 3: Implement `AisFetchMock`**

Create `api/src/modules/agent-loop/tools/domain/oilSpillMock/aisFetch.ts` by adapting the old `ais-fetch.ts` capability output to top-level `gisData`. Preserve IDs and statuses:

```ts
import { z } from "zod";
import type { Entity, Trajectory } from "@datasourceintelligence/shared";
import type { ToolDefinition } from "../../_shared/types.js";
import { SUSPECT_TRAJECTORIES, SUSPECT_VESSELS, TOTAL_RECORD_COUNT, TOTAL_VESSEL_COUNT } from "./mockData.js";

const InputSchema = z.strictObject({
  region: z.string().trim().min(1).default("中国东海"),
});

export function buildAisFetchMockTool(): ToolDefinition {
  return {
    name: "AisFetchMock",
    aliases: ["ais-fetch"],
    description: "Deterministic mock AIS trajectory fetch for the East China Sea oil-spill demo.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute(input) {
      const parsed = input as z.infer<typeof InputSchema>;
      const now = Date.parse("2026-06-23T00:00:00+08:00");
      const entities: Entity[] = SUSPECT_VESSELS.map((vessel) => {
        const points = SUSPECT_TRAJECTORIES[vessel.mmsi]!;
        const latest = points[points.length - 1]!;
        return {
          id: vessel.mmsi,
          name: vessel.name,
          type: "ship",
          coordinates: latest.coord,
          importance: "low",
          status: "normal",
          heading: latest.heading,
          speed: latest.speedKn,
          description: `MMSI ${vessel.mmsi} | ${vessel.type} | ${vessel.flag} | 长 ${vessel.length}m | ${parsed.region}`,
        };
      });
      const trajectories: Trajectory[] = SUSPECT_VESSELS.map((vessel) => {
        const points = SUSPECT_TRAJECTORIES[vessel.mmsi]!;
        return {
          id: `ais-traj-${vessel.mmsi}`,
          name: `${vessel.name} AIS 历史轨迹`,
          type: "route",
          coordinates: points.map((point) => point.coord),
          timestamps: points.map((point) => now - point.hoursAgo * 3600 * 1000),
          status: "history",
        };
      });
      return {
        summary: `成功获取 AIS 数据 ${TOTAL_RECORD_COUNT} 条，涉及船舶 ${TOTAL_VESSEL_COUNT} 艘（演示展示 ${SUSPECT_VESSELS.length} 艘途经匹配区域候选船）。`,
        recordCount: TOTAL_RECORD_COUNT,
        vesselCount: TOTAL_VESSEL_COUNT,
        displayedCount: SUSPECT_VESSELS.length,
        region: parsed.region,
        period: "近72小时",
        vessels: SUSPECT_VESSELS,
        gisData: { type: "entity" as const, entities, trajectories },
        metadata: { capability: "ais-fetch", mock: true },
      };
    },
  };
}
```

- [ ] **Step 4: Implement `AisMatchSuspectsMock`**

Create `api/src/modules/agent-loop/tools/domain/oilSpillMock/aisMatchSuspects.ts`:

```ts
import { z } from "zod";
import type { Entity } from "@datasourceintelligence/shared";
import type { ToolDefinition } from "../../_shared/types.js";
import { MATCH_INFOS, POLLUTION_ORIGIN, SUSPECT_TRAJECTORIES, SUSPECT_VESSELS, TOTAL_VESSEL_COUNT, getMatch } from "./mockData.js";
import { bboxFromCoordinates } from "./gisHelpers.js";

const InputSchema = z.strictObject({});

export function buildAisMatchSuspectsMockTool(): ToolDefinition {
  return {
    name: "AisMatchSuspectsMock",
    aliases: ["ais-match-suspects"],
    description: "Deterministic mock AIS suspect matching around the oil-spill pollution origin.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute() {
      const entities: Entity[] = SUSPECT_VESSELS.map((vessel) => {
        const current = SUSPECT_TRAJECTORIES[vessel.mmsi]!.at(-1)!;
        const match = getMatch(vessel.mmsi);
        const gap = match?.aisGapMin ? ` | AIS 信号断 ${match.aisGapMin} 分钟` : "";
        return {
          id: vessel.mmsi,
          name: vessel.name,
          type: "ship",
          coordinates: current.coord,
          importance: "medium",
          status: "warning",
          heading: current.heading,
          speed: current.speedKn,
          description: `MMSI ${vessel.mmsi} | ${vessel.type} | ${vessel.flag} | 停留 ${match?.stayDurationMin ?? "—"} 分钟 | 距原点 ${match?.closestDistanceM ?? "—"} m${gap}`,
        };
      });
      return {
        summary: `从 ${TOTAL_VESSEL_COUNT} 艘船中匹配出 ${SUSPECT_VESSELS.length} 艘途经候选船（排污原点 ±1 km × 排污时间窗 10:00-12:00）。`,
        matchCriteria: { center: POLLUTION_ORIGIN, rangeKm: 1, timeRange: "近72小时内10:00-12:00（UTC+8）" },
        matchedCount: SUSPECT_VESSELS.length,
        totalScanned: TOTAL_VESSEL_COUNT,
        vessels: SUSPECT_VESSELS.map((vessel) => ({ ...vessel, match: getMatch(vessel.mmsi) })),
        gisData: {
          type: "entity" as const,
          entities,
          cameraView: { type: "point" as const, lng: 124.451871, lat: 30.721557, altitude: 1159060 },
        },
        metadata: { capability: "ais-match-suspects", mock: true, bbox: bboxFromCoordinates(entities.map((entity) => entity.coordinates)), matchInfosCount: MATCH_INFOS.length },
      };
    },
  };
}
```

- [ ] **Step 5: Implement `AisSuspectRankingMock`**

Create `api/src/modules/agent-loop/tools/domain/oilSpillMock/aisSuspectRanking.ts` by adapting old ranking logic and keeping `413567890` as danger/primary:

```ts
import { z } from "zod";
import type { Entity } from "@datasourceintelligence/shared";
import type { ToolDefinition } from "../../_shared/types.js";
import { POLLUTION_ORIGIN, RANKING_BREAKDOWN, SUSPECT_TRAJECTORIES, SUSPECT_VESSELS, getRanking, getVessel, type SuspectLevel } from "./mockData.js";

const InputSchema = z.strictObject({});

function levelToStatus(level: SuspectLevel): Entity["status"] {
  if (level === "primary") return "danger";
  if (level === "secondary") return "warning";
  return "normal";
}

function levelLabel(level: SuspectLevel): string {
  if (level === "primary") return "首要嫌疑";
  if (level === "secondary") return "次要嫌疑";
  return "一般嫌疑";
}

export function buildAisSuspectRankingMockTool(): ToolDefinition {
  return {
    name: "AisSuspectRankingMock",
    aliases: ["ais-suspect-ranking"],
    description: "Deterministic mock suspect-vessel ranking for the East China Sea oil-spill demo.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute() {
      const entities: Entity[] = SUSPECT_VESSELS.map((vessel) => {
        const current = SUSPECT_TRAJECTORIES[vessel.mmsi]!.at(-1)!;
        const ranking = getRanking(vessel.mmsi);
        const level = ranking?.level ?? "normal";
        return {
          id: vessel.mmsi,
          name: `${levelLabel(level)}·${vessel.name}`,
          type: "ship",
          coordinates: current.coord,
          importance: level === "primary" ? "high" : level === "secondary" ? "medium" : "low",
          status: levelToStatus(level),
          heading: current.heading,
          speed: current.speedKn,
          description: `MMSI ${vessel.mmsi} | ${vessel.type} | ${vessel.flag} | 第 ${ranking?.rank ?? "—"} 名 | 得分 ${ranking?.score ?? "—"} | ${ranking?.reasons ?? ""}`,
        };
      });

      const grouped = {
        primary: RANKING_BREAKDOWN.filter((ranking) => ranking.level === "primary"),
        secondary: RANKING_BREAKDOWN.filter((ranking) => ranking.level === "secondary"),
        normal: RANKING_BREAKDOWN.filter((ranking) => ranking.level === "normal"),
      };
      const enrich = (ranking: (typeof RANKING_BREAKDOWN)[number]) => {
        const vessel = getVessel(ranking.mmsi);
        return { ...ranking, name: vessel?.name, type: vessel?.type, flag: vessel?.flag };
      };
      const primary = grouped.primary[0];
      const primaryVessel = primary ? getVessel(primary.mmsi) : undefined;

      return {
        summary: `嫌疑船舶分级完成。首要嫌疑 ${grouped.primary.length} 艘${primaryVessel ? `（${primaryVessel.name}，MMSI ${primaryVessel.mmsi}，得分 ${primary?.score}）` : ""}，次要嫌疑 ${grouped.secondary.length} 艘，一般嫌疑 ${grouped.normal.length} 艘。`,
        totalSuspects: RANKING_BREAKDOWN.length,
        primary: grouped.primary.map(enrich),
        secondary: grouped.secondary.map(enrich),
        normal: grouped.normal.map(enrich),
        gisData: { type: "entity" as const, entities },
        metadata: { capability: "ais-suspect-ranking", mock: true, pollutionOrigin: POLLUTION_ORIGIN, primaryMmsi: primary?.mmsi },
      };
    },
  };
}
```

- [ ] **Step 6: Register AIS mock tools**

Modify `api/src/modules/agent-loop/tools/domain/oilSpillMock/index.ts`:

```ts
import type { ToolDefinition } from "../../_shared/types.js";
import { buildOilSpillDetectMockTool } from "./oilSpillDetect.js";
import { buildWeatherFetchMockTool } from "./weatherFetch.js";
import { buildOilDriftTraceMockTool } from "./oilDriftTrace.js";
import { buildAisFetchMockTool } from "./aisFetch.js";
import { buildAisMatchSuspectsMockTool } from "./aisMatchSuspects.js";
import { buildAisSuspectRankingMockTool } from "./aisSuspectRanking.js";

export function buildOilSpillMockTools(): ToolDefinition[] {
  return [
    buildOilSpillDetectMockTool(),
    buildWeatherFetchMockTool(),
    buildOilDriftTraceMockTool(),
    buildAisFetchMockTool(),
    buildAisMatchSuspectsMockTool(),
    buildAisSuspectRankingMockTool(),
  ];
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd api; ..\node_modules\.bin\tsx.CMD tests\agent-loop\test-oil-spill-mock-tools.mjs`

Expected: PASS.

- [ ] **Step 8: Run type check**

Run: `cd api; ..\node_modules\.bin\tsc.CMD -p tsconfig.json --noEmit --pretty false`

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```powershell
git add api/src/modules/agent-loop/tools/domain/oilSpillMock api/tests/agent-loop/test-oil-spill-mock-tools.mjs
git commit -m "feat(agent-loop): add oil spill AIS mock tools"
```

---

### Task 4: Add Oil-Spill Skill And Prompt Routing

**Files:**
- Create: `skills/oil-spill-tracing/SKILL.md`
- Modify: `api/src/modules/agent-loop/promptManager.ts`
- Create: `api/tests/agent-loop/test-oil-spill-skill-doc.mjs`
- Create: `api/tests/agent-loop/test-prompt-manager-oil-spill-routing.mjs`

**Interfaces:**
- Consumes: hidden skill-scoped mock tools from Tasks 2 and 3.
- Produces:
  - skill `oil-spill-tracing`
  - prompt component `oilSpillMockRules`

- [x] **Step 1: Write failing skill doc test**

Create `api/tests/agent-loop/test-oil-spill-skill-doc.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const content = await readFile(new URL("../../../skills/oil-spill-tracing/SKILL.md", import.meta.url), "utf8");

assert.match(content, /^name: oil-spill-tracing/m);
assert.match(content, /OilSpillDetectMock/);
assert.match(content, /WeatherFetchMock/);
assert.match(content, /OilDriftTraceMock/);
assert.match(content, /AisFetchMock/);
assert.match(content, /AisMatchSuspectsMock/);
assert.match(content, /AisSuspectRankingMock/);
assert.match(content, /multi-step GIS replay/i);
assert.match(content, /Do not call `SatelliteImageSearch`/);
assert.match(content, /Do not call real `WeatherFetch`/);
assert.match(content, /shouldContinue:false/);

console.log("oil spill tracing skill doc test passed");
```

- [x] **Step 2: Run skill doc test to verify it fails**

Run: `cd api; ..\node_modules\.bin\tsx.CMD tests\agent-loop\test-oil-spill-skill-doc.mjs`

Expected: FAIL because `skills/oil-spill-tracing/SKILL.md` does not exist.

- [x] **Step 3: Create the skill**

Create `skills/oil-spill-tracing/SKILL.md`:

```md
---
name: oil-spill-tracing
description: Use when the user asks about oil spills, oil film, oil pollution, illegal discharge, pollution origin tracing, AIS suspect matching, or suspected responsible vessels; East China Sea has deterministic local fallback, other regions stop if queryData has no valid result.
argument-hint: "[user oil-spill tracing query]"
allowed-tools: OilSpillDetectMock, WeatherFetchMock, OilDriftTraceMock, AisFetchMock, AisMatchSuspectsMock, AisSuspectRankingMock
---

# Oil Spill Tracing

Use this skill for oil-spill tracing requests. East China Sea is the deterministic replay path. Other regions are allowed to enter the detector, but the workflow stops when `queryData` has no valid oil-spill image. This skill uses mock tools under `oilSpillMock`. The first detector keeps the old oil-spill behavior by calling `queryData`; weather, drift, AIS, matching, and ranking remain deterministic mock steps.

## Trigger

Use this skill when the user's query contains oil-spill intent such as 漏油, 油污, 油膜, 排污, 偷排, 疑似肇事船, pollution origin, or illegal discharge. The default demo region is 中国东海.

## Workflow

Run the tools in this exact order for multi-step GIS replay:

1. `OilSpillDetectMock` with `{"region":"中国东海"}` unless the user gives another display name.
2. Inspect the detector output.
3. If `shouldContinue:false`, stop immediately and answer that `queryData` did not return a valid oil-spill image for that region. Do not call any later mock tools.
4. If `shouldContinue:true`, call `WeatherFetchMock` with `{"region":"东海油膜片区"}`.
5. Call `OilDriftTraceMock` with `{}`.
6. Call `AisFetchMock` with `{"region":"中国东海"}` unless the user gave a different region and the detector returned `shouldContinue:true`.
7. Call `AisMatchSuspectsMock` with `{}`.
8. Call `AisSuspectRankingMock` with `{}`.

Each tool returns top-level `gisData`. Preserve the sequence because the frontend uses tool observations for step-by-step map replay.

## Rules

- Do not call `SatelliteImageSearch` for this demo.
- Do not call real `WeatherFetch` for this demo.
- Do not call SQL AIS tools or `ais-region-query` for this demo.
- Do not fabricate extra vessels, weather values, images, or rankings.
- Keep the demo deterministic even when the user says "现在", "最新", or "实时".
- For non-East-China-Sea regions, if `OilSpillDetectMock` returns `shouldContinue:false`, treat that as the final answer and stop the workflow.
- If the user explicitly asks for real live data, explain that this skill is the deterministic mock oil-spill demo and ask whether to switch to real tools.

## Response

Summarize:

- oil-film detection result and SAR overlay,
- wind/current mock input,
- pollution origin and drift path,
- AIS candidate count,
- matched suspects,
- final ranked suspect vessels.

Mention that the result is a deterministic mock replay, not live operational evidence.
```

- [x] **Step 4: Run skill doc test to verify it passes**

Run: `cd api; ..\node_modules\.bin\tsx.CMD tests\agent-loop\test-oil-spill-skill-doc.mjs`

Expected: PASS.

- [x] **Step 5: Write failing prompt routing test**

Create `api/tests/agent-loop/test-prompt-manager-oil-spill-routing.mjs`:

```js
import assert from "node:assert/strict";

const { defaultPromptManager, DEFAULT_PROMPT_COMPONENT_VERSIONS } = await import("../../src/modules/agent-loop/promptManager.ts");

const messages = defaultPromptManager.buildMessages({
  query: "查询东海漏油并匹配疑似肇事船",
  tools: [],
  userContext: {},
  systemContext: {},
  contextSections: [],
  runtimeSections: [],
  memorySections: [],
  skillSections: [],
  observations: [],
});

const systemMessage = messages.find((message) => message.role === "system");
assert.ok(systemMessage, "expected a system message");
assert.match(systemMessage.content, /# Oil Spill Mock Routing Rules/);
assert.match(systemMessage.content, /Skill.*oil-spill-tracing/);
assert.match(systemMessage.content, /OilSpillDetectMock/);
assert.match(systemMessage.content, /WeatherFetchMock/);
assert.match(systemMessage.content, /queryData/);
assert.match(systemMessage.content, /shouldContinue:false/);
assert.match(systemMessage.content, /do not use real WeatherFetch/i);
assert.equal(DEFAULT_PROMPT_COMPONENT_VERSIONS.oilSpillMockRules, "oil-spill-mock-rules-v1");

console.log("prompt manager oil spill routing test passed");
```

- [x] **Step 6: Run prompt routing test to verify it fails**

Run: `cd api; ..\node_modules\.bin\tsx.CMD tests\agent-loop\test-prompt-manager-oil-spill-routing.mjs`

Expected: FAIL because `oilSpillMockRules` is missing.

- [x] **Step 7: Add thin prompt routing rule**

Modify `api/src/modules/agent-loop/promptManager.ts`.

Add the component version:

```ts
  oilSpillMockRules: "oil-spill-mock-rules-v1",
```

Add this section after `# Disaster Satellite Query Rules`:

```ts
  "",
  "# Oil Spill Mock Routing Rules",
  "When the user asks about oil spills, oil film, oil pollution, illegal discharge, pollution origin tracing, AIS suspect matching, or suspected responsible vessels:",
  "1. Call Skill with skill=oil-spill-tracing before doing the analysis.",
  "2. OilSpillDetectMock calls queryData first. If it returns shouldContinue:false, stop and answer that no valid oil-spill image was found for that region.",
  "3. Use the deterministic mock tools named OilSpillDetectMock, WeatherFetchMock, OilDriftTraceMock, AisFetchMock, AisMatchSuspectsMock, and AisSuspectRankingMock.",
  "4. Keep multi-step GIS replay by calling the tools in the skill order; do not collapse the workflow into one answer.",
  "5. For this mock scenario, do not use real WeatherFetch, SatelliteImageSearch, SQL AIS tools, or live web data unless the user explicitly asks to leave the mock demo.",
```

- [x] **Step 8: Run prompt routing test to verify it passes**

Run: `cd api; ..\node_modules\.bin\tsx.CMD tests\agent-loop\test-prompt-manager-oil-spill-routing.mjs`

Expected: PASS.

- [x] **Step 9: Run existing prompt tests**

Run:

```powershell
cd api
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-prompt-manager-disaster-satellite-routing.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-prompt-manager-gis-routing.mjs
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```powershell
git add skills/oil-spill-tracing/SKILL.md api/src/modules/agent-loop/promptManager.ts api/tests/agent-loop/test-oil-spill-skill-doc.mjs api/tests/agent-loop/test-prompt-manager-oil-spill-routing.mjs
git commit -m "feat(agent-loop): add oil spill tracing skill"
```

---

### Task 5: Add End-To-End Smoke Coverage

**Files:**
- Create: `api/scripts/agent-loop/agent-loop-smoke-oil-spill-mock.ts`
- Modify: package scripts only if the repo already exposes grouped smoke scenarios through `api/package.json`.

**Interfaces:**
- Consumes: all tools and skill from Tasks 2-4.
- Produces: one standard `agent-loop-smoke.ts` scenario that verifies deterministic tool order and GIS outputs without requiring live services.

- [x] **Step 1: Write smoke script**

Create `api/scripts/agent-loop/agent-loop-smoke-oil-spill-mock.ts` as a scenario helper, not a standalone runner. It must export the scenario name, query, fake model client, queryData fetch mock, and validation function, and the scenario must be run through `api/scripts/agent-loop/agent-loop-smoke.ts`.

```ts
import "dotenv/config";
import { buildDefaultToolRegistry } from "../../src/modules/agent-loop/tools/_shared/toolRegistry.js";
import { callTool } from "../../src/modules/agent-loop/tools/_shared/toolGateway.js";

async function main() {
  const registry = buildDefaultToolRegistry();
  const context = { taskId: "oil-spill-smoke", query: "查询东海漏油并匹配疑似肇事船", observations: [] as any[] };
  const fetchCalls: Array<{ url: string; body: string }> = [];
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), body: String(init?.body ?? "") });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return { state: true, value: { records: [] } };
      },
    } as Response;
  };

  const calls = [
    { id: "detect", toolName: "OilSpillDetectMock", input: { region: "中国东海" } },
    { id: "weather", toolName: "WeatherFetchMock", input: { region: "东海油膜片区" } },
    { id: "drift", toolName: "OilDriftTraceMock", input: {} },
    { id: "ais", toolName: "AisFetchMock", input: { region: "中国东海" } },
    { id: "match", toolName: "AisMatchSuspectsMock", input: {} },
    { id: "ranking", toolName: "AisSuspectRankingMock", input: {} },
  ];

  for (const toolCall of calls) {
    const observation = await callTool(registry, toolCall, context);
    if (!observation.ok) {
      throw new Error(`${toolCall.toolName} failed: ${observation.error?.message ?? "unknown error"}`);
    }
    const output = observation.output as Record<string, unknown>;
    if (!output.gisData) {
      throw new Error(`${toolCall.toolName} did not return top-level gisData`);
    }
    context.observations.push(observation);
  }

  const ranking = context.observations.at(-1)!.output as {
    primary: Array<{ mmsi: string; score: number }>;
  };
  if (ranking.primary[0]?.mmsi !== "413567890" || ranking.primary[0]?.score !== 86) {
    throw new Error("Unexpected primary suspect ranking");
  }
  if (fetchCalls.length !== 1 || !fetchCalls[0]!.url.includes("/agent/queryData")) {
    throw new Error("OilSpillDetectMock did not call queryData");
  }

  console.log(JSON.stringify({
    ok: true,
    queryDataCalls: fetchCalls.length,
    toolOrder: context.observations.map((observation) => observation.toolName),
    gisOutputs: context.observations.length,
    primarySuspect: ranking.primary[0],
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [x] **Step 2: Run smoke**

Run: `cd api; ..\node_modules\.bin\tsx.CMD scripts\agent-loop\agent-loop-smoke-oil-spill-mock.ts`

Expected: PASS with JSON containing six tool names and `primarySuspect.mmsi = "413567890"`.

- [x] **Step 3: Run focused regression suite**

Run:

```powershell
cd api
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-oil-spill-mock-tools.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-oil-spill-skill-doc.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-prompt-manager-oil-spill-routing.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-agent-loop-gis-bridge.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-agent-loop-result-projection.mjs
..\node_modules\.bin\tsc.CMD -p tsconfig.json --noEmit --pretty false
```

Expected: PASS.

- [x] **Step 4: Commit**

Run:

```powershell
git add api/scripts/agent-loop/agent-loop-smoke-oil-spill-mock.ts
git commit -m "test(agent-loop): add oil spill mock smoke"
```

---

## Acceptance Checklist

- [ ] `oilSpillMock/` contains all mock-only oil-spill tools and mock data.
- [ ] `OilSpillDetectMock`, `WeatherFetchMock`, `OilDriftTraceMock`, `AisFetchMock`, `AisMatchSuspectsMock`, and `AisSuspectRankingMock` are executable after `oil-spill-tracing` loads but hidden from the default domain tool list.
- [ ] `OilSpillDetectMock` calls `queryData` before using any local SAR fallback.
- [ ] East China Sea queryData empty/no-valid-result responses fall back to `/satellite/oil-spill-1.png` and continue the replay.
- [ ] Non-East-China-Sea queryData empty/no-valid-result responses return `shouldContinue:false` with no `gisData`, and the skill stops without calling later tools.
- [ ] Scoped mock aliases work for `satelliteForOilDetect`, `oil-drift`, `ais-fetch`, `ais-match-suspects`, and `ais-suspect-ranking`; `OilSpillDetectMock` does not occupy the generic `satellite` alias.
- [ ] `weather-fetch` remains owned by real `WeatherFetch`; the oil-spill skill calls `WeatherFetchMock` explicitly.
- [ ] Each mock tool returns top-level `gisData`.
- [ ] The skill enforces multi-step GIS replay and deterministic mock data.
- [ ] Prompt routing tells the model to invoke `Skill(oil-spill-tracing)` for oil-spill queries.
- [ ] Focused tests and TypeScript check pass.

## Known Follow-Up Decisions

- If strict old alias compatibility for `weather-fetch` becomes mandatory, add a scoped alias mechanism to `ToolRegistry` or move the real weather alias. Do not silently override the real weather tool in this migration.
- If a future real oil-spill workflow is needed, add a separate `oilSpillReal/` tool folder and a separate skill instead of mutating this deterministic mock scenario.
