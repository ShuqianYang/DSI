#!/usr/bin/env node
/**
 * 真实端到端测试：完整走通 Pipeline → Executor → Requirement
 *
 * 测试流程：
 * 1. 连接真实数据库（从 .env 读取 DATABASE_URL）
 * 2. 创建 Task 记录
 * 3. 调用 runAgentPipeline（真实代码，走 Planner → Router → Executor）
 * 4. 轮询等待 Executor 执行完成
 * 5. 检查 requirements 表是否生成记录
 * 6. 清理测试数据
 *
 * 前置条件：
 *   - PostgreSQL 数据库已启动
 *   - Redis 已启动（用于 SSE）
 *   - dist/ 目录已编译（npm run build）
 *
 * 运行方式：
 *   cd api && node tests/test-e2e-requirement.mjs
 */

import { db } from "../dist/config/database.js";
import { tasks, requirements } from "../dist/db/schema.js";
import { eq, desc } from "drizzle-orm";
import { runAgentPipeline } from "../dist/modules/tasks/pipeline.js";
import * as taskService from "../dist/modules/tasks/service.js";

const TEST_CASES = [
  {
    name: "无厘头-火星海盗船",
    query: "帮我查查火星上有没有海盗船",
    expectRequirementCreated: false,
    category: "nonsense",
  },
  {
    name: "真实需求-全球机场统计",
    query: "帮我统计一下全球有多少个机场，按大洲排名",
    expectRequirementCreated: true,
    category: "real_need",
  },
  {
    name: "煤矿灾后评估-多能力缺失",
    query: "请结合山西煤矿新闻和地理信息、天基信息对昨天的煤矿进行灾后评估",
    expectRequirementCreated: true,
    category: "real_need",
  },
  {
    name: "煤矿新闻检索-现有能力覆盖",
    query: "请检索昨天山西煤矿爆炸的新闻，并告诉我最新动态",
    expectRequirementCreated: false,
    category: "supported",
  },
];

const MAX_WAIT_MS = 120000; // 最多等 120 秒
const POLL_INTERVAL_MS = 3000; // 每 3 秒轮询一次

/**
 * 等待 task 执行完成
 */
async function waitForTaskCompletion(taskId) {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    const task = await taskService.getTaskById(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    if (task.status === "completed" || task.status === "failed") {
      return task;
    }
    console.log(`  [等待] task ${taskId} 状态: ${task.status}，已等待 ${Math.round((Date.now() - start) / 1000)}s`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Task ${taskId} 执行超时（超过 ${MAX_WAIT_MS / 1000}s）`);
}

/**
 * 清理测试数据
 */
async function cleanup(taskId) {
  try {
    // 删除关联的 requirements
    await db.delete(requirements).where(eq(requirements.chatId, taskId));
    // 删除 task（级联删除 taskSteps、jobTasks、events 等）
    await db.delete(tasks).where(eq(tasks.id, taskId));
    console.log(`  [清理] task ${taskId} 及关联数据已删除`);
  } catch (err) {
    console.warn(`  [清理] 失败: ${err.message}`);
  }
}

async function runTestCase(testCase, index) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`[${index + 1}/${TEST_CASES.length}] ${testCase.name}`);
  console.log(`Query: ${testCase.query}`);
  console.log(`预期: requirementCreated=${testCase.expectRequirementCreated}`);
  console.log("-".repeat(70));

  let taskId = null;
  try {
    // Step 1: 创建 Task
    console.log("\n[Step 1] 创建 Task");
    const task = await taskService.createTask({
      query: testCase.query,
      context: {},
    });
    taskId = task.id;
    console.log(`  taskId: ${taskId}`);

    // Step 2: 调用 runAgentPipeline（真实代码）
    console.log("\n[Step 2] 调用 runAgentPipeline");
    runAgentPipeline(taskId, { query: testCase.query, context: {} }).catch((err) => {
      console.error(`  [Pipeline] 执行错误: ${err.message}`);
    });

    // Step 3: 等待 Executor 完成
    console.log("\n[Step 3] 等待 Executor 执行完成...");
    const finishedTask = await waitForTaskCompletion(taskId);
    console.log(`  最终状态: ${finishedTask.status}`);

    // Step 4: 检查 requirements 表
    console.log("\n[Step 4] 检查 requirements 表");
    const reqs = await db
      .select()
      .from(requirements)
      .where(eq(requirements.chatId, taskId))
      .orderBy(desc(requirements.createdAt));

    const requirementCreated = reqs.length > 0;
    console.log(`  requirements 记录数: ${reqs.length}`);
    if (reqs.length > 0) {
      const r = reqs[0];
      console.log(`  最近一条:`);
      console.log(`    id: ${r.id}`);
      console.log(`    description: ${r.description?.substring(0, 80)}...`);
      console.log(`    requirementId: ${r.requirementId || "N/A"}`);
      console.log(`    status: ${r.status}`);
    }

    // Step 5: 断言
    const pass = requirementCreated === testCase.expectRequirementCreated;
    if (pass) {
      console.log(`\n  ✓ 断言通过: requirementCreated=${requirementCreated} 符合预期`);
    } else {
      console.log(`\n  ✗ 断言失败: 预期 requirementCreated=${testCase.expectRequirementCreated}，实际=${requirementCreated}`);
    }

    return { pass, taskId, requirementCreated, reqs };
  } catch (err) {
    console.error(`\n  ✗ 异常: ${err.message}`);
    return { pass: false, taskId, error: err.message };
  } finally {
    // Step 6: 清理
    if (taskId) {
      console.log("\n[Step 6] 清理测试数据");
      await cleanup(taskId);
    }
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("真实端到端测试: Pipeline → Executor → Requirement");
  console.log("=".repeat(70));

  // 检查环境
  if (!process.env.DATABASE_URL) {
    console.error("错误: DATABASE_URL 未设置，请检查 .env 文件");
    process.exit(1);
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("错误: DEEPSEEK_API_KEY 未设置，请检查 .env 文件");
    process.exit(1);
  }

  console.log(`\n环境检查:`);
  console.log(`  DATABASE_URL: ${process.env.DATABASE_URL.replace(/\/\/[^:]+:[^@]+@/, "//***:***@")}`);
  console.log(`  DEEPSEEK_API_KEY: ${process.env.DEEPSEEK_API_KEY ? "已设置" : "未设置"}`);
  console.log(`  GATEWAY_BASE_URL: ${process.env.GATEWAY_BASE_URL || "未设置（跳过外部推送）"}`);

  const results = [];
  for (let i = 0; i < TEST_CASES.length; i++) {
    const result = await runTestCase(TEST_CASES[i], i);
    results.push({ ...TEST_CASES[i], actual: result });
  }

  // 汇总
  console.log("\n" + "=".repeat(70));
  console.log("测试汇总");
  console.log("=".repeat(70));

  let passed = 0, failed = 0, errors = 0;
  for (const r of results) {
    const status = r.actual.pass === true ? "✓ PASS" : r.actual.error ? "✗ ERROR" : "✗ FAIL";
    if (r.actual.pass) passed++;
    else if (r.actual.error) errors++;
    else failed++;

    const detail = r.actual.requirementCreated !== undefined
      ? `requirementCreated=${r.actual.requirementCreated}`
      : r.actual.error || "N/A";
    console.log(`${status} [${r.category}] ${r.name}: ${detail}`);
  }

  console.log(`\n总计: ${results.length} 个用例`);
  console.log(`  通过: ${passed}`);
  console.log(`  失败: ${failed}`);
  console.log(`  异常: ${errors}`);

  // 关闭数据库连接
  try {
    await db.$client.end();
    console.log("\n数据库连接已关闭");
  } catch (err) {
    console.warn("关闭数据库连接失败:", err.message);
  }

  if (failed + errors > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("测试失败:", err);
  process.exit(1);
});
