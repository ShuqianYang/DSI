import "dotenv/config";

const API_KEY = process.env.SHIPDT_API_KEY;
const BASE_URL = "https://api.shipdt.com/DataApiServer/apicall/QueryShip";

interface QueryShipParams {
  k: string;
  kw: string;
  max?: number;
}

interface ShipInfo {
  ShipName?: string;
  CallSign?: string;
  MMSI?: string;
  IMO?: string;
  [key: string]: unknown;
}

async function queryShip(params: QueryShipParams): Promise<unknown> {
  const url = new URL(BASE_URL);
  url.searchParams.append("k", params.k);
  url.searchParams.append("kw", params.kw);
  if (params.max != null) {
    url.searchParams.append("max", String(params.max));
  }

  console.log(`[ShipDT] GET ${url.toString()}`);
  const res = await fetch(url.toString());

  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

function printResult(data: unknown, keyword: string): void {
  console.log(`\n[ShipDT] 查询结果 (kw="${keyword}"):`);
  console.log(JSON.stringify(data, null, 2));

  if (Array.isArray(data)) {
    console.log(`\n共返回 ${data.length} 条记录`);
    if (data.length > 0) {
      console.log("\nPreview (first 3):");
      data.slice(0, 3).forEach((ship: ShipInfo, i) => {
        console.log(
          `  [${i + 1}] 船名: ${ship.ShipName ?? "N/A"} | 呼号: ${ship.CallSign ?? "N/A"} | MMSI: ${ship.MMSI ?? "N/A"} | IMO: ${ship.IMO ?? "N/A"}`
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

  const testCases: { label: string; kw: string; max?: number }[] = [
    { label: "按船名查询", kw: "盐港拖七" },
    { label: "按呼号查询", kw: "BFOU" },
    { label: "按 MMSI 查询", kw: "413374130" },
    { label: "按 IMO 查询", kw: "9468595" },
    { label: "限制返回数", kw: "COSCO", max: 3 },
  ];

  for (const tc of testCases) {
    console.log(`\n=== ${tc.label} (kw="${tc.kw}") ===`);
    try {
      const data = await queryShip({
        k: API_KEY,
        kw: tc.kw,
        max: tc.max,
      });
      printResult(data, tc.kw);
    } catch (e) {
      console.error(`[ShipDT] Error: ${e instanceof Error ? e.message : e}`);
    }
  }
}

main().catch((e) => {
  console.error("[ShipDT] Fatal error:", e);
  process.exit(1);
});
