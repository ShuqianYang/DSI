/**
 * 需求提报 + 接收回调 连续测试
 *
 * 流程:
 * 1. 启动本地 HTTP 服务器监听回调
 * 2. POST {DEMAND_URL} 提报需求，callBackUrl 指向本地服务器
 * 3. 等待外部系统回调本地服务器，打印收到的切片数据
 *
 * 配置：改下方 CALLBACK_HOST 为本机 IP（外部系统可达的地址）
 */

import http from "http";

const DEMAND_URL = "http://192.168.0.129:5000/agent/zh/demand";

// 本地回调服务器配置
const CALLBACK_PORT = 6000;
const CALLBACK_HOST = "192.168.0.176"; // 改为你本机 IP，确保外部系统能访问到
const CALLBACK_PATH = "/agent/callback/slice";
const CALLBACK_URL = `http://${CALLBACK_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`;

const CALLBACK_TIMEOUT_MS = 60_000; // 等待回调最大 60 秒

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 启动临时 HTTP 服务器接收回调 */
function startCallbackServer(): Promise<{ server: http.Server; waitForCallback: Promise<Record<string, unknown>> }> {
  return new Promise((resolve) => {
    let callbackBody: Record<string, unknown> | null = null;
    let resolveCallback: (data: Record<string, unknown>) => void;

    const waitForCallback = new Promise<Record<string, unknown>>((resolve) => {
      resolveCallback = resolve;
    });

    const server = http.createServer((req, res) => {
      console.log(`\n[CallbackServer] ${req.method} ${req.url}`);

      if (req.method === "POST" && req.url === CALLBACK_PATH) {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            callbackBody = JSON.parse(body);
          } catch {
            callbackBody = { rawBody: body };
          }
          console.log("[CallbackServer] Received payload:", JSON.stringify(callbackBody, null, 2));

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ state: true, message: "已接收", code: 200 }));

          if (resolveCallback) resolveCallback(callbackBody!);
        });
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
    });

    server.listen(CALLBACK_PORT, CALLBACK_HOST, () => {
      console.log(`[CallbackServer] Listening on http://${CALLBACK_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`);
      resolve({ server, waitForCallback });
    });
  });
}

async function postDemand(): Promise<string> {
  const payload = {
    requirementId: `REQ${Date.now()}`,
    requirementName: "东海区域监测需求",
    requirementSource: "天基信息服务系统",
    startTime: new Date("2025-01-01T00:00:00").getTime(),
    endTime: new Date("2026-03-30T00:00:00").getTime(),
    areaBounds: 
    {
      "type": "Point",
      "coordinates": [76.998, 43.2635]
    }
    ,
    targetType: "船舰",
    targetName: "目标区域A",
    algorithm: "目标识别",
    payloadMode: "可见光;红外",
    productType: "目标切片",
    priority: "high",
    resolution: "1",
    trackType: "低",
    maximumCloudCover: 0.2,
    sideslipAngle: 30.0,
    timeConstraints: JSON.stringify({
      latestStartTime: new Date("2025-01-01T00:00:00").getTime(),
    }),
    duration: null,
    timeLimitRequirement: "24小时内",
    rawPayload: {
      source: "仿真系统",
      traceId: `trace-${Date.now()}`,
    },
    submitTime: Date.now(),
    callBackUrl: CALLBACK_URL,
  };

  console.log(`\n========== 1. 需求提报 ==========`);
  console.log(`[Demand] POST ${DEMAND_URL}`);
  console.log(`[Demand] callBackUrl: ${CALLBACK_URL}`);

  const start = Date.now();
  const resp = await fetch(DEMAND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const elapsed = Date.now() - start;
  console.log(`[Demand] Status: ${resp.status} ${resp.statusText} (${elapsed}ms)`);

  const body = await resp.text();
  console.log("[Demand] Raw response:\n", body);

  const json = JSON.parse(body);
  console.log("[Demand] Parsed keys:", Object.keys(json));

  const requirementId = json.value;
  if (!requirementId) {
    throw new Error(`需求提报未返回 requirementId: ${body}`);
  }

  console.log(`[Demand] requirementId: ${requirementId}`);
  return String(requirementId);
}

async function main() {
  const { server, waitForCallback } = await startCallbackServer();

  try {
    const requirementId = await postDemand();

    console.log(`\n========== 2. 等待回调 (${CALLBACK_TIMEOUT_MS / 1000}s) ==========`);
    console.log(`[Wait] 等待外部系统回调至 ${CALLBACK_URL} ...`);

    const timeoutPromise = sleep(CALLBACK_TIMEOUT_MS).then(() => {
      throw new Error(`等待回调超时（${CALLBACK_TIMEOUT_MS / 1000}秒内未收到回调）`);
    });

    const callbackData = await Promise.race([waitForCallback, timeoutPromise]);

    console.log("\n========== 3. 收到回调 ==========");
    console.log("[Callback] Data:", JSON.stringify(callbackData, null, 2));
    console.log("\n========== 全部完成 ==========");
  } catch (err) {
    console.error("\n[Error]", err instanceof Error ? err.message : err);
  } finally {
    server.close();
    console.log("[CallbackServer] 已关闭");
    process.exit(0);
  }
}

main();
