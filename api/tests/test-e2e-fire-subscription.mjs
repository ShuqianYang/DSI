/**
 * 火情订阅端到端测试（完整链路）
 *
 * 验证两阶段链路：
 *   Stage A: 用户提问 → 创建订阅（含 region 信息）
 *   Stage B: 直接触发研判 → 4 步执行成功
 *
 * 用法：
 *   1. 确保后端 API 已启动: pnpm dev
 *   2. 运行: node api/tests/test-e2e-fire-subscription.mjs
 */

const API_URL = process.env.API_URL || "http://localhost:3001";
const SUBSCRIPTION_QUERY = "订阅新疆边境与哈萨克斯坦接壤管段火情智能研判服务";
const TRIGGER_QUERY = "[订阅触发] 火情研判·新疆-哈萨克斯坦接壤段";
const TRIGGER_CONTEXT = {
  scenario: "fire-investigation",
  regionId: "xj-kz-border",
  regionName: "新疆-哈萨克斯坦接壤段",
  bbox: [79.5, 42.5, 88.0, 49.0],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createTask(query, context) {
  const res = await fetch(`${API_URL}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, context }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`创建任务失败: ${data.error || res.statusText}`);
  return data;
}

async function getTask(taskId) {
  const res = await fetch(`${API_URL}/tasks/${taskId}`);
  return res.json();
}

async function listSubscriptions() {
  const res = await fetch(`${API_URL}/subscriptions`);
  return res.json();
}

async function waitForCompletion(taskId, maxWait = 60000, interval = 2000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const data = await getTask(taskId);
    if (data.status === "completed" || data.status === "failed") return data;
    process.stdout.write(".");
    await sleep(interval);
  }
  throw new Error("等待任务完成超时");
}

async function listenTaskSse(taskId, timeoutMs = 90000) {
  console.log(`\n===== 监听 Task SSE: /tasks/${taskId}/stream =====`);
  const events = [];
  let completed = false;

  function handleData(data) {
    events.push(data);
    if (data.type === "planning_done") {
      console.log(`[Task SSE] Planner: ${data.plan?.steps?.length || 0} steps`);
    } else if (data.type === "routing_done") {
      console.log(`[Task SSE] Router: ${data.actions?.length || 0} actions`);
    } else if (data.type === "step_update") {
      const icon = data.status === "completed" ? "✅" : data.status === "failed" ? "❌" : "⏳";
      console.log(`[Task SSE] Step ${data.stepIndex + 1} ${icon} ${data.name} → ${data.status}`);
    } else if (data.type === "completed" || data.type === "failed") {
      console.log(`[Task SSE] Task ${data.status || data.type}`);
      completed = true;
    }
  }

  const res = await fetch(`${API_URL}/tasks/${taskId}/stream`);
  if (!res.body) return events;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const start = Date.now();

  while (true) {
    if (Date.now() - start > timeoutMs || completed) break;
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          handleData(JSON.parse(line.slice(6)));
        } catch {
          // ignore
        }
      }
    }
  }

  reader.releaseLock?.();
  return events;
}

// ===== 主流程 =====
async function main() {
  console.log("===== 火情订阅端到端测试 =====");
  console.log(`API_URL: ${API_URL}`);

  // ========== Stage A: 用户提问，创建订阅 ==========
  console.log("\n========== Stage A: 用户提问 → 创建订阅 ==========");
  console.log(`QUERY: ${SUBSCRIPTION_QUERY}`);

  const subTask = await createTask(SUBSCRIPTION_QUERY);
  console.log(`taskId: ${subTask.taskId}`);

  console.log("\n等待订阅任务完成...");
  const subResult = await waitForCompletion(subTask.taskId, 120000);
  console.log(`\n订阅任务状态: ${subResult.status}`);

  if (subResult.status !== "completed") {
    throw new Error(`订阅任务失败: ${subResult.error || "unknown"}`);
  }

  // 查询订阅记录
  await sleep(500);
  const subs = await listSubscriptions();
  const fireSub = subs.subscriptions?.find(
    (s) => s.toolType === "fire-investigation-scenario"
  );
  if (!fireSub) {
    console.log("subscriptions:", JSON.stringify(subs, null, 2));
    throw new Error("未找到 fire-investigation-scenario 订阅记录");
  }
  console.log(`\n订阅记录:`);
  console.log(`  id:        ${fireSub.id}`);
  console.log(`  toolType:  ${fireSub.toolType}`);
  console.log(`  regionId:  ${fireSub.regionId}`);
  console.log(`  queryParams: ${JSON.stringify(fireSub.queryParams)}`);

  // ========== Stage B: 直接触发研判 ==========
  console.log("\n========== Stage B: 触发研判 → 验证 4 步链路 ==========");
  console.log(`QUERY: ${TRIGGER_QUERY}`);

  const fireTask = await createTask(TRIGGER_QUERY, TRIGGER_CONTEXT);
  console.log(`taskId: ${fireTask.taskId}`);

  const sseEvents = await listenTaskSse(fireTask.taskId, 90000);
  console.log(`\n收到 ${sseEvents.length} 条 SSE 事件`);

  // 查询最终结果
  const final = await getTask(fireTask.taskId);
  console.log(`\n研判任务状态: ${final.status}`);
  console.log(`steps (${final.steps?.length || 0}):`);
  final.steps?.forEach((s, i) => {
    const icon = s.status === "completed" ? "✅" : s.status === "failed" ? "❌" : "⏳";
    console.log(`  ${icon} [${i}] ${s.actionType} → ${s.status}`);
  });

  // ========== 断言 ==========
  console.log("\n===== 断言检查 =====");
  const checks = [];

  checks.push({
    check: subResult.status === "completed",
    label: "Stage A: 订阅创建任务 completed",
  });

  checks.push({
    check: fireSub.toolType === "fire-investigation-scenario",
    label: `订阅 toolType 正确 (实际 ${fireSub.toolType})`,
  });

  checks.push({
    check: fireSub.regionId === "xj-kz-border",
    label: `订阅 regionId 正确 (实际 ${fireSub.regionId})`,
  });

  checks.push({
    check: final.status === "completed",
    label: `Stage B: 研判任务 completed (实际 ${final.status})`,
  });

  const expectedActions = ["news", "satellite", "fire-detector", "border-push"];
  const actualActions = final.actions?.map((a) => a.type) || [];
  checks.push({
    check: expectedActions.every((t) => actualActions.includes(t)),
    label: `研判 actions 包含 ${expectedActions.join(",")} (实际 ${actualActions.join(",")})`,
  });

  const allStepsCompleted = final.steps?.every((s) => s.status === "completed");
  checks.push({
    check: allStepsCompleted,
    label: `研判所有 steps 成功`,
  });

  let passed = 0;
  for (const c of checks) {
    if (c.check) {
      console.log(`  ✅ ${c.label}`);
      passed++;
    } else {
      console.log(`  ❌ ${c.label}`);
    }
  }
  console.log(`\n总计: ${passed}/${checks.length} 通过`);

  process.exit(passed === checks.length ? 0 : 1);
}

main().catch((err) => {
  console.error("\n测试失败:", err.message);
  process.exit(1);
});
