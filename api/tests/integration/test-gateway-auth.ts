/**
 * API 网关鉴权接口测试
 *
 * 鉴权机制: accessKey + timestamp(毫秒) + signature
 * signature = MD5(secretKey + timestamp)
 * timestamp 有效期: 5 分钟
 *
 * 使用步骤:
 * 1. 在下方填写你的 accessKey 和 secretKey
 * 2. 修改 BASE_URL 和请求路径
 * 3. 运行: cd api && npx tsx tests/test-gateway-auth.ts
 */

import crypto from "crypto";

// ==================== 请填写你的密钥 ====================
const ACCESS_KEY = "a1cff1cc4bb146a68dc2dbb7aa400234"; // 替换为你的 accessKey
const SECRET_KEY = "e357e87cb6894194a35999c2f3753621"; // 替换为你的 secretKey
// ======================================================

const BASE_URL = "http://192.168.0.136";

/**
 * 生成签名: MD5(secretKey + timestamp)
 */
function generateSignature(secretKey: string, timestamp: number): string {
  return crypto.createHash("md5").update(secretKey + timestamp).digest("hex");
}

/**
 * 生成鉴权参数
 */
function getAuthParams() {
  const timestamp = Date.now();
  const signature = generateSignature(SECRET_KEY, timestamp);
  return { accessKey: ACCESS_KEY, timestamp, signature };
}

/**
 * 发送 GET 请求（网页重定向接口）
 * GET /gt/partner/app/v1/webPageRedirect/{bizType}/{bizId}
 */
async function sendGetRequest(bizType: string, bizId: string) {
  const auth = getAuthParams();
  const url = `${BASE_URL}/v1/webPageRedirect/${bizType}/${bizId}`;

  console.log(`\n[Gateway GET] ${url}`);
  console.log("[Gateway GET] Headers:", JSON.stringify(auth, null, 2));

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        accessKey: auth.accessKey,
        timestamp: String(auth.timestamp),
        signature: auth.signature,
      },
      redirect: "manual", // 网页重定向接口可能返回 302
    });

    console.log(`[Gateway GET] Status: ${resp.status} ${resp.statusText}`);

    if (resp.status === 302 || resp.status === 301) {
      console.log(`[Gateway GET] Redirect Location: ${resp.headers.get("location")}`);
    }

    const body = await resp.text();
    if (body) {
      console.log(`[Gateway GET] Body:\n${body.slice(0, 2000)}`);
    }
  } catch (err) {
    console.error("[Gateway GET] Error:", err instanceof Error ? err.message : err);
  }
}

/**
 * 发送 POST 请求（API 网关转发接口）
 * POST /gt/partner/app/v1/gateway/{bizType}/{bizId}
 */
async function sendPostRequest(bizType: string, bizId: string, bodyData: Record<string, unknown>) {
  const auth = getAuthParams();
  const url = `${BASE_URL}/v1/gateway/${bizType}/${bizId}`;

  console.log(`\n[Gateway POST] ${url}`);
  console.log("[Gateway POST] Headers:", JSON.stringify(auth, null, 2));
  console.log("[Gateway POST] Body:", JSON.stringify(bodyData, null, 2));

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accessKey: auth.accessKey,
        timestamp: String(auth.timestamp),
        signature: auth.signature,
      },
      body: JSON.stringify(bodyData),
    });

    console.log(`[Gateway POST] Status: ${resp.status} ${resp.statusText}`);

    const body = await resp.text();
    if (body) {
      console.log(`[Gateway POST] Body:\n${body.slice(0, 2000)}`);
    }
  } catch (err) {
    console.error("[Gateway POST] Error:", err instanceof Error ? err.message : err);
  }
}

/**
 * 需求管理 - 需求提交接口
 * POST /sys-service-web/sysBackend/gt/requirement/issue
 */
async function sendIssueRequest() {
  const auth = getAuthParams();
  const url = `${BASE_URL}/sys-service-web/sysBackend/gt/requirement/issue`;

  const bodyData = {
    applicant: "测试单位",
    applicationScenario: "海上监测",
    description: "测试需求描述",
    name: "测试需求-" + Date.now(),
    source: "智能体平台",
    status: 0,
    type: "1",
  };

  console.log(`\n[Gateway Issue] POST ${url}`);
  console.log("[Gateway Issue] Headers:", JSON.stringify(auth, null, 2));
  console.log("[Gateway Issue] Body:", JSON.stringify(bodyData, null, 2));

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accessKey: auth.accessKey,
        timestamp: String(auth.timestamp),
        signature: auth.signature,
      },
      body: JSON.stringify(bodyData),
    });

    console.log(`[Gateway Issue] Status: ${resp.status} ${resp.statusText}`);

    const body = await resp.text();
    if (body) {
      console.log(`[Gateway Issue] Body:\n${body.slice(0, 2000)}`);
      try {
        const json = JSON.parse(body);
        console.log("[Gateway Issue] Parsed keys:", Object.keys(json));
        if (json.success !== undefined) console.log("[Gateway Issue] success:", json.success);
        if (json.message !== undefined) console.log("[Gateway Issue] message:", json.message);
        if (json.data !== undefined) console.log("[Gateway Issue] data:", json.data);
      } catch {
        // not JSON
      }
    }
  } catch (err) {
    console.error("[Gateway Issue] Error:", err instanceof Error ? err.message : err);
  }
}

// ==================== 测试入口 ====================
async function main() {
  if (ACCESS_KEY === "your_access_key" || SECRET_KEY === "your_secret_key") {
    console.error("[Gateway] 请先填写 ACCESS_KEY 和 SECRET_KEY！");
    process.exit(1);
  }

  console.log("[Gateway] API Gateway Auth Test Started");

  // 需求提交接口
  await sendIssueRequest();

  // GET 请求示例
  await sendGetRequest("moduleToolsApply", "123");

  // POST 网关转发示例
  await sendPostRequest("moduleToolsApply", "123", {
    param1: "value1",
    param2: "value2",
  });

  console.log("\n[Gateway] Test completed.");
}

main();
