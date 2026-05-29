#!/usr/bin/env node
/**
 * 测试新的 Planner + Router -> Requirement 流程
 *
 * 测试用例：
 * - 5 个无厘头问题（应该被 classifyIntent 识别为 unknown → requirement）
 * - 5 个用户可能提问但现有工具无法满足的问题（应该触发 requirement 提报）
 */

import { plannerService } from "../dist/modules/planner/service.js";
import { routerService } from "../dist/modules/router/service.js";

// 内联模拟 executor 的 validateActionCase（运行时 context 依赖校验）
function mockValidateActionCase(action, context) {
  switch (action.type) {
    case "oil-drift": {
      const hasOilFilm = Object.values(context).some(
        (v) => v && typeof v === "object" && v.oilFilmGeom
      );
      if (!hasOilFilm) {
        const err = new Error("oil-drift 需要上游 satellite 返回的 oilFilmGeom");
        err.name = "CaseValidationError";
        err.blockedReason = "CONTEXT_DEP_MISSING";
        throw err;
      }
      break;
    }
    case "ais-match-suspects": {
      const hasOrigin = Object.values(context).some(
        (v) => v && typeof v === "object" && v.originPoint
      );
      const hasTimeWindow = Object.values(context).some(
        (v) => v && typeof v === "object" && v.timeWindow
      );
      if (!hasOrigin || !hasTimeWindow) {
        const err = new Error("ais-match-suspects 需要 oil-drift 返回的 originPoint 和 timeWindow");
        err.name = "CaseValidationError";
        err.blockedReason = "CONTEXT_DEP_MISSING";
        throw err;
      }
      break;
    }
    case "earthquake-evaluation":
    case "flood-evaluation": {
      const hasPre = Object.values(context).some(
        (v) => v && typeof v === "object" &&
          (v.responseType === "pre_earthquake" || v.responseType === "pre_flood" || v.phase === "pre")
      );
      const hasPost = Object.values(context).some(
        (v) => v && typeof v === "object" &&
          (v.responseType === "post_earthquake" || v.responseType === "post_flood" || v.phase === "post")
      );
      if (!hasPre || !hasPost) {
        const err = new Error(`${action.type} 需要 satellite 返回的 pre 和 post 影像数据`);
        err.name = "CaseValidationError";
        err.blockedReason = "CONTEXT_DEP_MISSING";
        throw err;
      }
      break;
    }
  }
}

const TEST_CASES = [
  // ========== 5 个无厘头问题 ==========
  {
    category: "无厘头",
    query: "帮我查查火星上有没有海盗船",
    expect: "unknown → requirement",
  },
  {
    category: "无厘头",
    query: "预测一下明天彩票中奖号码",
    expect: "unknown → requirement",
  },
  {
    category: "无厘头",
    query: "给我画一只粉红色的独角兽在太平洋上跳舞",
    expect: "unknown → requirement",
  },
  {
    category: "无厘头",
    query: "查查我家楼下奶茶店今天卖了多少杯珍珠奶茶",
    expect: "unknown → requirement",
  },
  {
    category: "无厘头",
    query: "帮我找一下海底两万里处的潜艇",
    expect: "unknown → requirement",
  },

  // ========== 5 个现有工具无法满足的问题 ==========
  {
    category: "工具能力不足",
    query: "查询一下东海现在有多少货船，按国籍统计一下",
    expect: "maritime/ais-fetch 执行，但缺少按国籍统计 → requirement",
  },
  {
    category: "工具能力不足",
    query: "查询一下南海有没有核潜艇活动",
    expect: "maritime，但无核潜艇检测 → requirement",
  },
  {
    category: "工具能力不足",
    query: "帮我预测一下明天东海会不会有台风",
    expect: "unknown/weather，无天气预测 → requirement",
  },
  {
    category: "工具能力不足",
    query: "统计一下全球有多少艘货船在航行",
    expect: "maritime，但 ais-fetch 只支持固定区域 → requirement",
  },
  {
    category: "工具能力不足",
    query: "帮我导出一份东海船舶态势报告，包含PDF",
    expect: "maritime，但无导出/PDF功能 → requirement",
  },
];

async function runTestCase(testCase, index) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[${index + 1}/${TEST_CASES.length}] [${testCase.category}] ${testCase.query}`);
  console.log(`预期: ${testCase.expect}`);
  console.log("-".repeat(60));

  try {
    // Step 1: classifyIntent
    const classification = await plannerService.classifyIntent(testCase.query);
    console.log("\n[Step 1] classifyIntent:");
    console.log(`  intent: ${classification.intent}`);
    console.log(`  hardcoded: ${classification.hardcoded || false}`);
    console.log(`  confidence: ${classification.confidence}`);
    console.log(`  missingParams: [${classification.missingParams.join(", ")}]`);

    if (classification.intent === "unknown") {
      console.log("\n  → 意图 unknown，直接走 requirement 提报");
      return { result: "requirement", reason: "unknown intent" };
    }

    // Step 2: generatePlan
    const plan = await plannerService.generatePlan(testCase.query, {});
    console.log("\n[Step 2] generatePlan:");
    console.log(`  goal: ${plan.goal?.substring(0, 60)}...`);
    console.log(`  steps: ${plan.steps?.length || 0}`);
    console.log(`  scenario: ${plan.scenario?.name || "none"}`);

    // Step 3: decideActions (Router)
    const actions = await routerService.decideActions(plan, testCase.query, classification);
    console.log("\n[Step 3] decideActions:");
    console.log(`  actions: ${actions.length}`);
    for (const a of actions) {
      console.log(`    [${a.type}] ${a.name} params=${JSON.stringify(a.params || {})}`);
    }

    if (actions.length === 0) {
      console.log("\n  → 无 routable action，走 requirement 提报");
      return { result: "requirement", reason: "no routable action" };
    }

    // Step 4: 模拟 executor validateActionCase（运行时 context 校验）
    console.log("\n[Step 4] validateActionCase (模拟):");
    const stepResults = new Map();
    const context = {};
    for (const action of actions) {
      try {
        mockValidateActionCase(action, context);
        console.log(`  [${action.type}] ✓ 通过`);
        // 模拟执行成功，将结果加入 context
        stepResults.set(action.id, { success: true, type: action.type });
        context[action.id] = { success: true };
      } catch (err) {
        if (err.name === "CaseValidationError") {
          console.log(`  [${action.type}] ✗ 阻断: ${err.reason}`);
          console.log(`\n  → 运行时阻断，走 analyzeBlockReason → requirement 提报`);
          return { result: "requirement", reason: err.reason, blockedAction: action.type };
        }
        throw err;
      }
    }

    console.log("\n  → 全部通过，正常执行完成");
    return { result: "success", actions: actions.length };
  } catch (err) {
    console.error(`\n  ✗ 错误: ${err.message}`);
    return { result: "error", reason: err.message };
  }
}

async function main() {
  console.log("========================================");
  console.log("Planner + Router -> Requirement 流程测试");
  console.log("========================================");

  const results = [];
  for (let i = 0; i < TEST_CASES.length; i++) {
    const result = await runTestCase(TEST_CASES[i], i);
    results.push({ ...TEST_CASES[i], actual: result });
  }

  // 汇总
  console.log("\n" + "=".repeat(60));
  console.log("测试汇总");
  console.log("=".repeat(60));

  const byResult = { requirement: 0, success: 0, error: 0 };
  for (const r of results) {
    byResult[r.actual.result] = (byResult[r.actual.result] || 0) + 1;
    const status =
      r.actual.result === "requirement"
        ? "REQUIREMENT"
        : r.actual.result === "success"
          ? "SUCCESS"
          : "ERROR";
    console.log(`[${status}] [${r.category}] ${r.query.substring(0, 40)}...`);
  }

  console.log(`\n总计: ${results.length} 个用例`);
  console.log(`  requirement: ${byResult.requirement}`);
  console.log(`  success: ${byResult.success}`);
  console.log(`  error: ${byResult.error}`);
}

main().catch((err) => {
  console.error("测试失败:", err);
  process.exit(1);
});
