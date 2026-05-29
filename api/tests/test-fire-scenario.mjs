/**
 * 火情研判 scenario 端到端测试
 *
 * 直接测试 POST /tasks 走通 "[订阅触发] 火情研判" 完整链路：
 * Planner → Router → Executor（news → satellite → fire-detector → border-push）
 *
 * 用法:
 *   1. 确保后端 API 已启动: pnpm dev (api 端口 3001)
 *   2. 运行: node api/tests/test-fire-scenario.mjs
 *   3. 或指定端口: API_URL=http://localhost:3001 node api/tests/test-fire-scenario.mjs
 */

const API_URL = process.env.API_URL || "http://localhost:3001";
const QUERY = "[订阅触发] 火情研判·新疆-哈萨克斯坦接壤段";
const CONTEXT = {
  scenario: "fire-investigation",
  regionId: "xj-kz-border",
  regionName: "新疆-哈萨克斯坦接壤段",
  bbox: [79.5, 42.5, 88.0, 49.0],
  query: "订阅新疆边境与哈萨克斯坦接壤管段火情智能研判服务",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createTask(query, context) {
  console.log(`\n===== 创建任务 =====`);
  console.log(`query: ${query}`);
  const res = await fetch(`${API_URL}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, context }),
  });
  const data = await res.json();
  console.log("response:", JSON.stringify(data, null, 2));
  if (!res.ok) throw new Error(`创建任务失败: ${data.error || res.statusText}`);
  return data;
}

async function getTask(taskId) {
  const res = await fetch(`${API_URL}/tasks/${taskId}`);
  return res.json();
}

async function listenSse(taskId) {
  console.log(`\n===== 监听 SSE: /tasks/${taskId}/stream =====`);
  const events = [];
  let completed = false;

  function handleData(data) {
    events.push(data);

    if (data.type === "planning_done") {
      console.log(`\n[Planner] goal: ${data.plan?.goal}`);
      console.log(`  steps: ${data.plan?.steps?.length || 0}`);
      data.plan?.steps?.forEach((s, i) => console.log(`    ${i + 1}. ${s.description}`));
    } else if (data.type === "routing_done") {
      console.log(`\n[Router] actions: ${data.actions?.length || 0}`);
      data.actions?.forEach((a, i) => console.log(`    ${i + 1}. ${a.type}: ${a.name}`));
    } else if (data.type === "step_update") {
      const icon = data.status === "completed" ? "✅" : data.status === "failed" ? "❌" : "⏳";
      console.log(`\n[Step ${data.stepIndex + 1}] ${icon} ${data.name} → ${data.status}`);
      if (data.detail) console.log(`  detail: ${data.detail}`);
    } else if (data.type === "completed" || data.type === "failed") {
      console.log(`\n[Task] 最终状态: ${data.status || data.type}`);
      completed = true;
    }
  }

  // 用 fetch 消费 SSE（Node.js 无原生 EventSource）
  try {
    const res = await fetch(`${API_URL}/tasks/${taskId}/stream`);
    if (!res.body) {
      console.log("  SSE 无响应体");
      return events;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            handleData(data);
          } catch {
            // ignore parse error
          }
        }
      }
    }
  } catch (err) {
    console.log(`  SSE 消费结束: ${err.message}`);
  }

  return events;
}

async function waitForCompletion(taskId, maxWait = 90000, interval = 2000) {
  console.log(`\n===== 等待任务完成 (最多 ${maxWait / 1000}s) =====`);
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const data = await getTask(taskId);
    if (data.status === "completed" || data.status === "failed") {
      return data;
    }
    process.stdout.write(".");
    await sleep(interval);
  }
  throw new Error("等待任务完成超时");
}

function printResultSummary(data) {
  console.log(`\n===== 任务结果摘要 =====`);
  console.log(`taskId:  ${data.taskId}`);
  console.log(`status:  ${data.status}`);
  console.log(`query:   ${data.query}`);
  console.log(`error:   ${data.error || "无"}`);

  if (data.plan) {
    console.log(`\nplan goal: ${data.plan.goal}`);
    console.log(`plan steps:`);
    data.plan.steps?.forEach((s, i) => console.log(`  ${i + 1}. ${s.id}: ${s.description}`));
  }

  if (data.actions) {
    console.log(`\nactions:`);
    data.actions.forEach((a, i) => console.log(`  ${i + 1}. ${a.type}: ${a.name}`));
  }

  if (data.steps) {
    console.log(`\nsteps execution (${data.steps.length}):`);
    data.steps.forEach((s, i) => {
      const icon = s.status === "completed" ? "✅" : s.status === "failed" ? "❌" : "⏳";
      console.log(`  ${icon} [${i}] ${s.actionType} → ${s.status}${s.error ? " | " + s.error : ""}`);
    });
  }

  if (data.result) {
    console.log(`\nresult keys: ${Object.keys(data.result).join(", ")}`);
    for (const [key, val] of Object.entries(data.result)) {
      const v = val;
      console.log(`  ${key}: ${v?.success != null ? (v.success ? "success" : "failed") : ""} ${v?.metadata?.capability || ""}`);
    }
  }

  if (data.error) {
    console.log(`\nerror: ${data.error}`);
  }
}

async function assertSteps(data) {
  console.log(`\n===== 断言检查 =====`);
  const checks = [];

  // 1. 任务完成
  checks.push({ check: data.status === "completed", label: "任务状态为 completed" });

  // 2. Plan 有 4 步
  checks.push({
    check: data.plan?.steps?.length === 4,
    label: `Plan 有 4 步 (实际 ${data.plan?.steps?.length || 0})`,
  });

  // 3. Actions 有 4 个（news/satellite/fire-detector/border-push）
  const expectedActions = ["news", "satellite", "fire-detector", "border-push"];
  const actualActions = data.actions?.map((a) => a.type) || [];
  const actionTypesMatch = expectedActions.every((t) => actualActions.includes(t));
  checks.push({
    check: actionTypesMatch,
    label: `Actions 包含 ${expectedActions.join(", ")} (实际: ${actualActions.join(", ")})`,
  });

  // 4. Steps 全部 completed
  const allCompleted = data.steps?.every((s) => s.status === "completed");
  const stepStatuses = data.steps?.map((s) => `${s.actionType}:${s.status}`).join(", ");
  checks.push({
    check: allCompleted,
    label: `所有 steps 执行成功 (实际: ${stepStatuses})`,
  });

  // 5. Result 有 4 个 key（对应 4 个 action）
  checks.push({
    check: Object.keys(data.result || {}).length === 4,
    label: `Result 包含 4 个 action 结果 (实际 ${Object.keys(data.result || {}).length})`,
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
  return passed === checks.length;
}

// ===== 主流程 =====
async function main() {
  try {
    console.log("===== 火情研判 Scenario 端到端测试 =====");
    console.log(`API_URL: ${API_URL}`);
    console.log(`QUERY:   ${QUERY}`);

    // 1. 创建任务
    const { taskId } = await createTask(QUERY, CONTEXT);
    if (!taskId) throw new Error("未返回 taskId");

    // 2. 监听 SSE（与轮询并行）
    const ssePromise = listenSse(taskId);

    // 3. 轮询等待完成
    const final = await waitForCompletion(taskId);

    // 4. 等 SSE 收完（最多再等 5 秒）
    const sseEvents = await Promise.race([
      ssePromise,
      sleep(5000).then(() => []),
    ]);
    console.log(`\nSSE 收到 ${sseEvents.length} 条事件`);

    // 5. 打印结果
    printResultSummary(final);

    // 6. 断言
    const allPass = await assertSteps(final);

    process.exit(allPass ? 0 : 1);
  } catch (err) {
    console.error("\n测试失败:", err.message);
    process.exit(1);
  }
}

main();
