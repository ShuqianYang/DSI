/**
 * 洪水前历史影像 queryData 接口测试
 * 参考地震 queryData 传参格式
 *
 * 运行：node api/tests/test-flood-query-payload.mjs
 */

const QUERYDATA_URL = "http://192.168.0.129:5000/agent/queryData";

// 洪水前历史影像查询参数
const floodQueryDataPayload = {
  pageNo: 1,
  pageSize: 10,
  satelliteName: "高分五号A星",
  payloadType: ["可见光"],
  productType: "目标切片",
  dataType: "洪水前",
  targetType: "洪水前",
  reqObj: "天元认知计算",
  reqContent: "接收到天元认知计算系统的历史影像查询(洪水)需求，完成影像检索并反馈",
};

async function testQueryData(payload, name) {
  console.log(`\n--- 测试 ${name} ---`);
  console.log("URL:", QUERYDATA_URL);
  console.log("Payload:", JSON.stringify(payload, null, 2));
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(QUERYDATA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(t);
    const body = await resp.text();
    console.log(`\n<-- HTTP ${resp.status}`);
    console.log(`Body: ${body.slice(0, 1000)}`);
    return resp.ok;
  } catch (err) {
    console.error(`\n<-- 请求失败: ${err.message}`);
    return false;
  }
}

(async () => {
  console.log("=".repeat(80));
  console.log("洪水 queryData 接口测试");
  console.log("=".repeat(80));

  await testQueryData(floodQueryDataPayload, "洪水前 - queryData 历史影像查询");

  console.log("\n" + "=".repeat(80));
  console.log("测试完成");
  console.log("=".repeat(80));
})();
