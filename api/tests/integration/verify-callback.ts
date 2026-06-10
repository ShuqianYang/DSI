/**
 * 快速验证：回调路由是否可达 + 能否唤醒等待中的 satellite capability
 *
 * 用法:
 *   npx tsx api/tests/verify-callback.ts
 *
 * 分两步测试：
 * 1. 检查 API 健康状态（确认服务在跑）
 * 2. 发送模拟回调（requirementId 随机，看路由是否通）
 */

const API_HOST = process.env.API_HOST || "192.168.0.176";
const API_PORT = process.env.API_PORT || "3001";
const BASE_URL = `http://${API_HOST}:${API_PORT}`;

async function checkHealth() {
  console.log(`[Verify] 检查 API 健康: ${BASE_URL}/health`);
  try {
    const resp = await fetch(`${BASE_URL}/health`);
    const body = await resp.json();
    console.log(`[Verify] Health: ${resp.status}`, body);
    return resp.ok;
  } catch (err) {
    console.error("[Verify] Health check failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

async function sendMockCallback(requirementId: string) {
  const url = `${BASE_URL}/agent/callback/slice`;
  const payload = {
    id: `REQ1778932206884`,
    satellite: "GF-3",
    acquisition_time: new Date().toISOString().replace(/\.\d{3}Z$/, ""),
    resolution: 1.0,
    source_image_id: `GF3_${Date.now()}`,
    center_longitude: 121.4737,
    center_latitude: 31.2304,
    target_type: "ship",
    confidence: 0.98,
    width: 256,
    height: 256,
    path: `/dataset/tiles/GF3/test.png`,
    url: "http://192.168.0.129:82/huoqing.jpg",
    requirementId,
    lon_ul: 121.45,
    lat_ul: 31.21,
    lon_ur: 121.50,
    lat_ur: 31.25,
  };

  console.log(`\n[Verify] 发送回调: POST ${url}`);
  console.log(`[Verify] requirementId: ${requirementId}`);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await resp.text();
    console.log(`[Verify] Status: ${resp.status}`);
    console.log(`[Verify] Response: ${body}`);
    return resp.ok;
  } catch (err) {
    console.error("[Verify] Callback failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

async function main() {
  console.log("========== 回调链路验证 ==========");
  console.log(`API: ${BASE_URL}`);

  // 1. 健康检查
  const healthy = await checkHealth();
  if (!healthy) {
    console.error("\n[Verify] API 未就绪，请确认后端已启动");
    process.exit(1);
  }

  // 2. 场景A：发送随机 requirementId（模拟无等待方的情况）
  console.log("\n--- 场景A: 无等待方的回调 ---");
  await sendMockCallback(`REQ_TEST_${Date.now()}`);

  // 3. 场景B：如果你当前正在跑一个 satellite fireScenario，
  //    把下面的 requirementId 改成实际值再手动触发
  console.log("\n--- 场景B: 如果你有正在等待的 satellite capability ---");
  console.log("[Verify] 如果你当前有 satellite fireScenario 在执行，");
  console.log("[Verify] 请把下面的 TEST_ID 改成日志里打印的 requirementId，重新运行本脚本。");
  console.log("[Verify] 例如: npx tsx api/tests/verify-callback.ts REQ20260516xxxx");

  const targetId = process.argv[2];
  if (targetId) {
    await sendMockCallback(targetId);
  } else {
    console.log("[Verify] 未提供 requirementId，跳过场景B");
  }

  console.log("\n========== 验证完成 ==========");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
