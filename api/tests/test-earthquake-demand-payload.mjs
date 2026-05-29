/**
 * 地震 pre/post 卫星接口测试
 * 只测试地震两个场景：
 * 1. pre:  /agent/queryData  查询震前历史影像
 * 2. post: /agent/zh/demand  提报震后应急成像需求
 *
 * 运行：node api/tests/test-earthquake-demand-payload.mjs
 */

const DEMAND_URL = "http://192.168.0.129:5000/agent/zh/demand";
const QUERYDATA_URL = "http://192.168.0.129:5000/agent/queryData";

// ==================== 1. 地震 post 需求提报参数 ====================
const earthquakeDemandPayload = {
  requirementId: `REQ-EQ${Date.now()}`,
  requirementName: "广西柳州市柳南区 5.2级地震震后应急成像需求",
  requirementSource: "天基信息服务系统",
  startTime: Date.now(),
  endTime: Date.now() + 24 * 60 * 60 * 1000,
  areaBounds: {
    type: "Point",
    coordinates: [109.25982181039833, 24.366071571884453],
  },
  targetType: "地震后",
  targetName: "广西柳州市柳南区",
  algorithm: "灾后评估",
  payloadMode: "可见光",
  productType: "目标切片",
  priority: "high",
  resolution: "1",
  trackType: "低",
  timeConstraints: JSON.stringify({ latestStartTime: Date.now() }),
  duration: null,
  timeLimitRequirement: "24小时内",
  rawPayload: { mode: 1 },
  submitTime: Date.now(),
  callBackUrl: "http://192.168.0.193:3001/agent/callback/slice",
};

// ==================== 2. 地震 pre 历史影像查询参数 ====================
const earthquakeQueryDataPayload = {
  pageNo: 1,
  pageSize: 10,
  satelliteName: "高分五号A星",
  payloadType: ["可见光"],
  productType: "目标切片",
  dataType: "地震前",
  targetType: "地震前",
  reqObj: "天元认知计算",
  reqContent: "接收到天元认知计算系统的历史影像查询(地震)需求，完成影像检索并反馈",
};

// ==================== 测试发送 ====================
async function testDemand(payload, name) {
  console.log(`\n--- 测试 ${name} ---`);
  console.log("URL:", DEMAND_URL);
  console.log("Payload:", JSON.stringify(payload, null, 2));
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(DEMAND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(t);
    const body = await resp.text();
    console.log(`\n<-- HTTP ${resp.status}`);
    console.log(`Body: ${body.slice(0, 500)}`);
    return resp.ok;
  } catch (err) {
    console.error(`\n<-- 请求失败: ${err.message}`);
    return false;
  }
}

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
    console.log(`Body: ${body.slice(0, 500)}`);
    return resp.ok;
  } catch (err) {
    console.error(`\n<-- 请求失败: ${err.message}`);
    return false;
  }
}

(async () => {
  console.log("=".repeat(80));
  console.log("地震 satellite 接口测试");
  console.log("=".repeat(80));

  await testQueryData(earthquakeQueryDataPayload, "地震 pre - queryData 历史影像查询");
  await testDemand(earthquakeDemandPayload, "地震 post - demand 震后应急需求提报");

  console.log("\n" + "=".repeat(80));
  console.log("测试完成");
  console.log("=".repeat(80));
})();
