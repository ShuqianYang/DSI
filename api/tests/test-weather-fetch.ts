// 临时验证脚本：直接调 weather-fetch capability，看返回结构和数据源
// 运行：npx tsx api/scripts/test-weather-fetch.ts
import { weatherFetchCapability } from "../src/modules/actions/capabilities/weather-fetch.js";

function summarize(label: string, r: Awaited<ReturnType<typeof weatherFetchCapability.execute>>) {
  const data = r.data as Record<string, unknown> | undefined;
  const gis = data?.gisData as { windField?: { u: number[]; v: number[]; speed: number[]; source: string; bbox: unknown; grid: unknown } } | undefined;
  const wf = gis?.windField;
  console.log(`--- ${label} ---`);
  console.log("dataSource =", data?.dataSource);
  console.log("metadata =", r.metadata);
  console.log("windField.source =", wf?.source);
  console.log("windField.bbox =", wf?.bbox);
  console.log("windField.grid =", wf?.grid);
  console.log("windField.u.length =", wf?.u.length, "v.length =", wf?.v.length, "speed.length =", wf?.speed.length);
  console.log("windField.u[0..4] =", wf?.u.slice(0, 5));
  console.log("windField.speed avg =", wf?.speed.length ? (wf.speed.reduce((a, b) => a + b, 0) / wf.speed.length).toFixed(2) : "n/a");
}

async function main() {
  console.log("=== Test 1: 无 context，使用默认东海中心点 ===");
  const r1 = await weatherFetchCapability.execute(
    {
      id: "test-1",
      type: "weather-fetch",
      name: "气象数据",
      description: "test",
      params: { region: "东海油膜片区" },
    },
    {}
  );
  summarize("Test 1", r1);

  console.log("\n=== Test 2: 携带 satellite mock context（应使用 oil-spill 中心点）===");
  const r2 = await weatherFetchCapability.execute(
    {
      id: "test-2",
      type: "weather-fetch",
      name: "气象数据",
      description: "test",
      params: { region: "中国东海" },
    },
    {
      "action-2": {
        data: {
          oilSpill: { centerLat: 30.2561, centerLng: 123.0125 },
        },
      },
    }
  );
  summarize("Test 2", r2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
