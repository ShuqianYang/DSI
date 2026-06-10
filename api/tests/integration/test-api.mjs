/**
 * API 测试脚本 - 使用内置 fetch，无需额外依赖
 *
 * 用法:
 *   node test-api.mjs
 *   API_URL=http://localhost:3001 node test-api.mjs
 */

const API_URL = process.env.API_URL || "http://localhost:3001";

async function healthCheck() {
  console.log("===== 健康检查 =====");
  const res = await fetch(`${API_URL}/health`);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
  return data.status === "ok";
}

async function createTask(query, context) {
  console.log(`\n===== 创建任务: ${query} =====`);
  const res = await fetch(`${API_URL}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, context }),
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));

  if (!res.ok) {
    throw new Error(`创建任务失败: ${data.error || res.statusText}`);
  }
  return data;
}

async function getTask(taskId) {
  console.log(`\n===== 查询任务: ${taskId} =====`);
  const res = await fetch(`${API_URL}/tasks/${taskId}`);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
  return data;
}

async function waitForCompletion(taskId, maxWait = 30000, interval = 2000) {
  console.log(`\n===== 等待任务完成 (最多 ${maxWait / 1000}s) =====`);
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const data = await getTask(taskId);
    if (data.status === "completed" || data.status === "failed") {
      return data;
    }
    console.log(`  当前状态: ${data.status}，${interval / 1000}s 后重试...`);
    await sleep(interval);
  }

  throw new Error("等待任务完成超时");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printSummary(data) {
  console.log("\n===== 执行摘要 =====");
  console.log(`  taskId:  ${data.taskId}`);
  console.log(`  status:  ${data.status}`);
  console.log(`  query:   ${data.query}`);
  console.log(`  steps:   ${data.steps?.length || 0} 个`);

  if (data.steps) {
    for (const step of data.steps) {
      const icon = step.status === "completed" ? "✅" : step.status === "failed" ? "❌" : "⏳";
      console.log(`    ${icon} ${step.actionType}: ${step.status}`);
    }
  }

  if (data.result) {
    console.log(`  result keys: ${Object.keys(data.result).join(", ")}`);
  }

  if (data.error) {
    console.log(`  error: ${data.error}`);
  }
}

// ===== 主测试流程 =====
async function main() {
  try {
    // 1. 健康检查
    const healthy = await healthCheck();
    if (!healthy) {
      console.error("服务未就绪");
      process.exit(1);
    }

    // 2. 创建任务（海域态势分析）
    const task = await createTask("分析东海海域当前船舶态势，识别异常行为");
    const taskId = task.taskId;

    // 3. 立即查询（应为 pending）
    await getTask(taskId);

    // 4. 等待执行完成
    const final = await waitForCompletion(taskId);

    // 5. 打印摘要
    printSummary(final);

    // 6. 断言
    console.log("\n===== 测试断言 =====");
    const assertions = [
      { check: final.status === "completed", label: "任务最终状态为 completed" },
      { check: final.steps && final.steps.length > 0, label: "存在执行步骤" },
      { check: final.plan != null, label: "plan 已生成" },
      { check: final.actions != null, label: "actions 已决策" },
    ];

    let passed = 0;
    for (const a of assertions) {
      if (a.check) {
        console.log(`  ✅ ${a.label}`);
        passed++;
      } else {
        console.log(`  ❌ ${a.label}`);
      }
    }

    console.log(`\n总计: ${passed}/${assertions.length} 通过`);
    process.exit(passed === assertions.length ? 0 : 1);

  } catch (err) {
    console.error("\n测试失败:", err.message);
    process.exit(1);
  }
}

main();
