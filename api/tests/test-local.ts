/**
 * 本地零依赖测试脚本
 * 用内存模拟数据库和队列，不依赖 PostgreSQL/Redis/Docker
 * 用于验证业务逻辑（Planner → Router → Executor → Actions）
 */

import { plannerService } from "../src/modules/planner/service.js";
import { routerService } from "../src/modules/router/service.js";
import { actionsService } from "../src/modules/actions/service.js";

// ========== 内存数据库 ==========
interface MemoryTask {
  id: string;
  query: string;
  status: string;
  plan: Record<string, unknown> | null;
  actions: Record<string, unknown>[] | null;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface MemoryStep {
  id: string;
  taskId: string;
  actionType: string;
  actionConfig: Record<string, unknown>;
  status: string;
  result: Record<string, unknown> | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

const memoryDB = {
  tasks: new Map<string, MemoryTask>(),
  steps: new Map<string, MemoryStep>(),
  stepSeq: 1,
};

function createTaskRecord(query: string): MemoryTask {
  const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const task: MemoryTask = {
    id,
    query,
    status: "pending",
    plan: null,
    actions: null,
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };
  memoryDB.tasks.set(id, task);
  return task;
}

function updateTask(taskId: string, updates: Partial<MemoryTask>) {
  const task = memoryDB.tasks.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  Object.assign(task, updates, { updatedAt: new Date().toISOString() });
}

function createStepRecord(taskId: string, action: Record<string, unknown>): MemoryStep {
  const id = `step-${memoryDB.stepSeq++}`;
  const step: MemoryStep = {
    id,
    taskId,
    actionType: action.type as string,
    actionConfig: action,
    status: "pending",
    result: null,
    error: null,
    startedAt: null,
    completedAt: null,
  };
  memoryDB.steps.set(id, step);
  return step;
}

function updateStep(stepId: string, updates: Partial<MemoryStep>) {
  const step = memoryDB.steps.get(stepId);
  if (!step) throw new Error(`Step ${stepId} not found`);
  Object.assign(step, updates);
}

function getStepsByTaskId(taskId: string): MemoryStep[] {
  return Array.from(memoryDB.steps.values()).filter((s) => s.taskId === taskId);
}

// ========== 主测试流程 ==========
async function runTest(query: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🚀 测试任务: "${query}"`);
  console.log(`${"=".repeat(60)}\n`);

  const startTime = Date.now();

  // 1. 创建任务
  const task = createTaskRecord(query);
  console.log(`[1/5] 任务创建: ${task.id}`);

  // 2. Planner 生成计划
  const plan = await plannerService.generatePlan(query);
  updateTask(task.id, { plan: plan as unknown as Record<string, unknown> });
  console.log(`[2/5] Planner 完成:`);
  console.log(`      目标: ${plan.goal}`);
  console.log(`      步骤: ${plan.steps.map((s) => s.description).join(" → ")}`);

  // 3. Router 决策动作
  const actions = await routerService.decideActions(plan);
  updateTask(task.id, { actions: actions as unknown as Record<string, unknown>[] });
  console.log(`[3/5] Router 完成:`);
  actions.forEach((a, i) => {
    console.log(`      ${i + 1}. [${a.type}] ${a.name}`);
  });

  // 4. 创建步骤记录
  actions.forEach((action) => createStepRecord(task.id, action as unknown as Record<string, unknown>));
  console.log(`[4/5] 步骤记录创建: ${actions.length} 个`);

  // 5. 模拟 Worker 执行
  console.log(`[5/5] Executor 开始执行...\n`);
  updateTask(task.id, { status: "running" });

  const stepResults = new Map<string, Record<string, unknown>>();
  const completedSteps = new Set<string>();

  for (const action of actions) {
    const step = getStepsByTaskId(task.id).find((s) => s.actionConfig.id === action.id);
    if (!step) continue;

    updateStep(step.id, { status: "running", startedAt: new Date().toISOString() });
    console.log(`      ▶️ 执行 [${action.type}] ${action.name}...`);

    try {
      const context: Record<string, unknown> = {};
      if (action.dependsOn) {
        for (const depId of action.dependsOn) {
          const depResult = stepResults.get(depId);
          if (depResult) context[depId] = depResult;
        }
      }

      const result = await actionsService.execute(action, context);

      if (result.success) {
        updateStep(step.id, {
          status: "completed",
          result: result.data || null,
          completedAt: new Date().toISOString(),
        });
        stepResults.set(action.id, result.data || {});
        completedSteps.add(action.id);
        console.log(`      ✅ ${action.type} 完成 (${result.metadata?.executionTime || "N/A"}ms)`);
      } else {
        updateStep(step.id, {
          status: "failed",
          error: result.error || null,
          completedAt: new Date().toISOString(),
        });
        console.log(`      ❌ ${action.type} 失败: ${result.error}`);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      updateStep(step.id, {
        status: "failed",
        error,
        completedAt: new Date().toISOString(),
      });
      console.log(`      ❌ ${action.type} 异常: ${error}`);
    }
  }

  // 汇总
  const allResults: Record<string, unknown> = {};
  for (const [id, data] of stepResults) {
    allResults[id] = data;
  }

  const hasFailed = getStepsByTaskId(task.id).some((s) => s.status === "failed");
  const finalStatus = hasFailed ? "failed" : "completed";

  updateTask(task.id, {
    status: finalStatus,
    result: allResults,
    completedAt: new Date().toISOString(),
  });

  const elapsed = Date.now() - startTime;

  // 打印结果摘要
  console.log(`\n${"=".repeat(60)}`);
  console.log("📊 执行摘要");
  console.log(`${"=".repeat(60)}`);
  console.log(`  taskId:    ${task.id}`);
  console.log(`  status:    ${finalStatus}`);
  console.log(`  elapsed:   ${elapsed}ms`);
  console.log(`  steps:     ${actions.length} 个`);
  for (const step of getStepsByTaskId(task.id)) {
    const icon = step.status === "completed" ? "✅" : step.status === "failed" ? "❌" : "⏳";
    console.log(`    ${icon} [${step.actionType}] ${step.status}`);
  }
  if (task.error) {
    console.log(`  error:     ${task.error}`);
  }
  console.log(`${"=".repeat(60)}\n`);

  return { task, steps: getStepsByTaskId(task.id) };
}

// ========== 运行多个测试用例 ==========
async function main() {
  console.log("🔧 本地零依赖测试启动");
  console.log("   模式: Planner=MOCK, Router=MOCK, Actions=MOCK\n");

  const testCases = [
    "分析东海海域当前船舶态势，识别异常行为",
    "东海海域近期有哪些值得关注的地缘动态？",
    "展示东海海域风险热力图",
  ];

  for (const query of testCases) {
    await runTest(query);
  }

  console.log("\n✅ 全部测试完成");
}

main().catch((err) => {
  console.error("\n测试失败:", err);
  process.exit(1);
});
