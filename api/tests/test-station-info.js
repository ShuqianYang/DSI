// 测试 GetStationInfo.aspx 接口
// 运行: node scripts/test-station-info.js

const PARAMETER = "GMG80leXIjuFq2BifGIVQP7oTq7NI065QmVjbUpRl+Mnro5l2ot5EsadmvqB3a/U";
const BASE_URL = "http://218.249.73.159:60000/GetStationInfo.aspx";

async function main() {
  const rand = Math.floor(Math.random() * 10000);
  const url = `${BASE_URL}?Parameter=${encodeURIComponent(PARAMETER)}&Rand=${rand}`;

  console.log("[Test] Rand:", rand);
  console.log("[Test] URL:", url);
  console.log("[Test] Sending GET request...\n");

  const start = Date.now();
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "*/*" },
    });

    const elapsed = Date.now() - start;
    const body = await resp.text();

    console.log(`[Test] Status: ${resp.status} ${resp.statusText} (${elapsed}ms)`);
    console.log("[Test] Headers:");
    resp.headers.forEach((v, k) => console.log(`  ${k}: ${v}`));
    console.log("\n[Test] Body:");
    console.log(body);
  } catch (err) {
    console.error("[Test] Request failed:", err);
  }
}

main();
