import "dotenv/config";

const API_KEY = process.env.SHIPDT_API_KEY;
const BASE_URL = "http://api.shipdt.com/DataApiServer/apicall/GetManyShip";

interface GetManyShipParams {
  k: string;
  id: string;
}

interface ShipDetail {
  ShipID?: number;
  mmsi?: number;
  name?: string;
  callsign?: string;
  imo?: number;
  shiptype?: number;
  length?: number;
  width?: number;
  left?: number;
  trail?: number;
  draught?: number;
  dest?: string;
  eta?: string;
  shipTypeName?: string;
  navistatName?: string;
  country?: string;
  longitude?: number;
  latitude?: number;
  speed?: number;
  course?: number;
  heading?: number;
  rot?: number;
  accurary?: number;
  utc?: number;
  lasttime?: number;
  receiveTime?: number;
  onlineStatus?: number;
  [key: string]: unknown;
}

async function getManyShip(params: GetManyShipParams): Promise<unknown> {
  const url = new URL(BASE_URL);
  url.searchParams.append("k", params.k);
  url.searchParams.append("id", params.id);

  console.log(`[ShipDT] GET ${url.toString()}`);
  const res = await fetch(url.toString());

  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

function printResult(data: unknown, ids: string): void {
  console.log(`\n[ShipDT] 查询结果 (id="${ids}"):`);
  console.log(JSON.stringify(data, null, 2));

  if (Array.isArray(data)) {
    console.log(`\n共返回 ${data.length} 条船舶详情`);
    if (data.length > 0) {
      console.log("\nPreview:");
      data.forEach((ship: ShipDetail, i) => {
        console.log(
          `  [${i + 1}] ${ship.name ?? "N/A"} | MMSI: ${ship.mmsi ?? "N/A"} | 坐标: [${ship.longitude ?? "N/A"}, ${ship.latitude ?? "N/A"}] | 航速: ${ship.speed ?? "N/A"}kn | 航向: ${ship.course ?? "N/A"}°`
        );
      });
    }
  }
}

async function main() {
  if (!API_KEY) {
    console.error("Error: SHIPDT_API_KEY must be set in .env");
    process.exit(1);
  }

  const testCases: { label: string; ids: string }[] = [
    { label: "单船查询", ids: "477183800" },
    { label: "多船查询（2艘）", ids: "477183800,477947700" },
    { label: "多船查询（3艘）", ids: "477183800,477947700,477319300" },
    { label: "混合查询", ids: "412465870,413374130,526107288" },
  ];

  for (const tc of testCases) {
    console.log(`\n=== ${tc.label} (id="${tc.ids}") ===`);
    try {
      const data = await getManyShip({ k: API_KEY, id: tc.ids });
      printResult(data, tc.ids);
    } catch (e) {
      console.error(`[ShipDT] Error: ${e instanceof Error ? e.message : e}`);
    }
  }
}

// GetManyShip 接口当前未启用，测试脚本已禁用
// main().catch((e) => {
//   console.error("[ShipDT] Fatal error:", e);
//   process.exit(1);
// });
