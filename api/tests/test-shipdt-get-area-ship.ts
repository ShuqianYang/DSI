import "dotenv/config";

const API_KEY = process.env.SHIPDT_API_KEY;
const BASE_URL = "http://api.shipdt.com/DataApiServer/apicall/GetAreaShip";

interface GetAreaShipParams {
  k: string;
  minlon: number;
  maxlon: number;
  minlat: number;
  maxlat: number;
}

interface AreaShip {
  ShipID?: number;
  mmsi?: number;
  name?: string;
  callsign?: string;
  shiptype?: number;
  lon?: number;
  lat?: number;
  sog?: number;
  cog?: number;
  hdg?: number;
  navistat?: number;
  lasttime?: number;
  classType?: string;
  [key: string]: unknown;
}

function toMicroDegree(deg: number): number {
  return Math.round(deg * 1_000_000);
}

async function getAreaShip(params: GetAreaShipParams): Promise<unknown> {
  const url = new URL(BASE_URL);
  url.searchParams.append("k", params.k);
  url.searchParams.append("minlon", String(params.minlon));
  url.searchParams.append("maxlong", String(params.maxlon)); // 文档要求 maxlong（g结尾）
  url.searchParams.append("minlat", String(params.minlat));
  url.searchParams.append("maxlat", String(params.maxlat));

  console.log(`[ShipDT] GET ${url.toString()}`);
  const res = await fetch(url.toString());

  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

function printResult(data: unknown, label: string): void {
  console.log(`\n[ShipDT] 区域查询结果 (${label}):`);
  console.log(JSON.stringify(data, null, 2));

  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;

    if (typeof d.shipcount === "number" && d.data == null) {
      console.log(`\n⚠️ 船舶数量超过 2800 艘，仅返回数量: ${d.shipcount}`);
      return;
    }

    const ships = d.data as AreaShip[] | undefined;
    if (Array.isArray(ships)) {
      console.log(`\n共返回 ${ships.length} 条船舶`);
      if (ships.length > 0) {
        console.log("\nPreview (first 5):");
        ships.slice(0, 5).forEach((ship, i) => {
          const lon = ship.lon != null ? (ship.lon / 1_000_000).toFixed(4) : "N/A";
          const lat = ship.lat != null ? (ship.lat / 1_000_000).toFixed(4) : "N/A";
          const sog = ship.sog != null ? (ship.sog / 100).toFixed(1) : "N/A";
          const cog = ship.cog != null ? (ship.cog / 100).toFixed(1) : "N/A";
          console.log(
            `  [${i + 1}] ${ship.name ?? "N/A"} | MMSI: ${ship.mmsi ?? "N/A"} | [${lon}, ${lat}] | ${sog}kn / ${cog}°`
          );
        });
      }
    }
  }
}

async function main() {
  if (!API_KEY) {
    console.error("Error: SHIPDT_API_KEY must be set in .env");
    process.exit(1);
  }

  const testCases: {
    label: string;
    minlon: number;
    maxlon: number;
    minlat: number;
    maxlat: number;
  }[] = [
    {
      label: "上海附近小范围（示例坐标）",
      minlon: toMicroDegree(122.41953),
      maxlon: toMicroDegree(122.663475),
      minlat: toMicroDegree(31.777556),
      maxlat: toMicroDegree(31.8482),
    },
    {
      label: "东海海域（约2°×2°边界测试）",
      minlon: toMicroDegree(122.0),
      maxlon: toMicroDegree(124.0),
      minlat: toMicroDegree(30.0),
      maxlat: toMicroDegree(32.0),
    },
    {
      label: "渤海湾（船舶密集区）",
      minlon: toMicroDegree(117.5),
      maxlon: toMicroDegree(119.5),
      minlat: toMicroDegree(38.0),
      maxlat: toMicroDegree(40.0),
    },
    {
      label: "珠江口",
      minlon: toMicroDegree(113.5),
      maxlon: toMicroDegree(114.5),
      minlat: toMicroDegree(22.0),
      maxlat: toMicroDegree(23.0),
    },
  ];

  for (const tc of testCases) {
    const lonRange = (tc.maxlon - tc.minlon) / 1_000_000;
    const latRange = (tc.maxlat - tc.minlat) / 1_000_000;
    console.log(
      `\n=== ${tc.label} | 范围: ${lonRange.toFixed(2)}°×${latRange.toFixed(2)}° ===`
    );
    try {
      const data = await getAreaShip({
        k: API_KEY,
        minlon: tc.minlon,
        maxlon: tc.maxlon,
        minlat: tc.minlat,
        maxlat: tc.maxlat,
      });
      printResult(data, tc.label);
    } catch (e) {
      console.error(`[ShipDT] Error: ${e instanceof Error ? e.message : e}`);
    }
  }
}

main().catch((e) => {
  console.error("[ShipDT] Fatal error:", e);
  process.exit(1);
});
