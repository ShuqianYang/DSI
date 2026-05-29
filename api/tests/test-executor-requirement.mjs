#!/usr/bin/env node
/**
 * 端到端测试：Planner -> Router -> Executor -> Requirement 聚合评估
 *
 * 测试覆盖：
 * 1. 无厘头问题 → executor 聚合阻断 → DeepSeek 评估 shouldCreate=false → 不生成 requirement
 * 2. 真实需求但缺少工具 → executor 聚合阻断 → DeepSeek 评估 shouldCreate=true → 生成 requirement
 * 3. 混合请求（部分支持 + 部分 unsupported）→ 只评估 unsupported 部分
 *
 * 运行方式：
 *   cd api && node tests/test-executor-requirement.mjs
 *
 * 依赖：
 *   - DEEPSEEK_API_KEY 环境变量（默认用内置 key）
 *   - 不需要数据库（mock executor 执行）
 */

import { plannerService } from "../dist/modules/planner/service.js";
import { routerService } from "../dist/modules/router/service.js";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-v4-flash";

// ============ 辅助函数 ============

async function callDeepSeek(messages, options = {}) {
  const resp = await fetch(DEEPSEEK_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({ model: DEEPSEEK_MODEL, messages, stream: false, ...options }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`DeepSeek API error: ${resp.status} ${text}`);
  }
  const json = await resp.json();
  return json.choices?.[0]?.message?.content || "";
}

function extractJson(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (m) return m[1].trim();
  const o = text.match(/\{[\s\S]*\}/);
  if (o) return o[0];
  return text.trim();
}

/**
 * 模拟 executor 中的 evaluateRequirementNeed 逻辑
 * 直接调用 DeepSeek 评估是否需要生成 requirement
 */
async function evaluateRequirementNeed(query, blockedItems) {
  const blockedSummary = blockedItems
    .map((b, i) => {
      return `${i + 1}. [${b.source}] ${b.actionType} — ${b.actionName}\n   原因：${b.reason}`;
    })
    .join("\n\n");

  const prompt = `你是数智融合平台的需求审核专家。\n\n## 输入\n\n- 用户原始请求：${query}\n- 系统不支持的能力列表：\n\n${blockedSummary}\n\n## 任务\n\n判断用户的请求是否值得生成需求单提报到外部平台。\n\n## 判断标准\n\n1. 如果用户请求涉及真实业务场景（如股票分析、天气预警、物流追踪、特定区域情报研判等），但当前系统缺少对应工具 → 应该创建需求单\n2. 如果用户请求是无厘头、闲聊、测试性提问（如"你好"、"1+1等于几"、"讲个笑话"、"今天吃什么"）→ 不应该创建需求单\n3. 如果用户请求本身就不合理或无法通过任何系统实现 → 不应该创建需求单\n4. 如果系统已有部分能力可以支撑，只是缺少某个具体工具或数据源 → 应该创建需求单\n\n## 输出格式\n\n必须返回纯 JSON，不要包含 markdown 代码块标记或任何其他说明文字：\n\n{\n  "shouldCreate": boolean,\n  "reason": "给用户看的判断说明（50字以内）",\n  "requirement": {\n    "name": "需求标题（20字以内）",\n    "description": "需求详细描述（200字以内），说明用户请求什么、系统缺什么能力",\n    "applicationScenario": "应用场景，如：金融分析、气象预警、物流追踪、情报研判等"\n  }\n}`;

  const answer = await callDeepSeek([
    { role: "system", content: "你是一个需求审核专家，只返回 JSON。" },
    { role: "user", content: prompt },
  ], { temperature: 0.3 });

  const parsed = JSON.parse(extractJson(answer));
  return {
    shouldCreate: !!parsed.shouldCreate,
    reason: parsed.reason || "已评估",
    requirement: parsed.requirement || null,
  };
}

// ============ 模拟 executor validateActionCase ============

function mockValidateActionCase(action, context) {
  switch (action.type) {
    case "oil-drift": {
      const hasOilFilm = Object.values(context).some(
        (v) => v && typeof v === "object" && v.oilFilmGeom
      );
      if (!hasOilFilm) {
        const err = new Error("oil-drift 需要上游 satellite 返回的 oilFilmGeom");
        err.name = "CaseValidationError";
        err.reason = "缺少油膜几何数据上下文依赖";
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
        err.reason = "缺少油污原点或时间窗上下文";
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
        err.reason = "缺少震前/震后或洪水前后影像对比数据";
        err.blockedReason = "CONTEXT_DEP_MISSING";
        throw err;
      }
      break;
    }
  }
}

// ============ 测试用例 ============

const TEST_CASES = [
  {
    name: "无厘头-火星海盗船",
    query: "帮我查查火星上有没有海盗船",
    expectShouldCreate: false,
    category: "nonsense",
  },
  {
    name: "无厘头-彩票预测",
    query: "预测一下明天彩票中奖号码",
    expectShouldCreate: false,
    category: "nonsense",
  },
  {
    name: "真实需求-股票分析",
    query: "分析一下特斯拉股票走势",
    expectShouldCreate: true,
    category: "real_need",
  },
  {
    name: "真实需求-天气预测",
    query: "帮我预测一下明天东海会不会有台风",
    expectShouldCreate: true,
    category: "real_need",
  },
  {
    name: "真实需求-按国籍统计",
    query: "查询一下东海现在有多少货船，按国籍统计一下",
    expectShouldCreate: true,
    category: "real_need",
  },
  {
    name: "混合请求-部分支持",
    query: "分析东海态势并导出PDF报告",
    expectShouldCreate: true,
    category: "mixed",
  },
];

// ============ 主测试逻辑 ============

async function runTestCase(testCase, index) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`[${index + 1}/${TEST_CASES.length}] ${testCase.name}`);
  console.log(`Query: ${testCase.query}`);
  console.log(`预期: shouldCreate=${testCase.expectShouldCreate}`);
  console.log("-".repeat(70));

  try {
    // Step 1: classifyIntent
    console.log("\n[Step 1] classifyIntent");
    const classification = await plannerService.classifyIntent(testCase.query);
    console.log(`  intent=${classification.intent}, hardcoded=${classification.hardcoded || false}`);

    // Step 2: generatePlan
    console.log("\n[Step 2] generatePlan");
    const plan = await plannerService.generatePlan(testCase.query, {});
    console.log(`  goal: ${plan.goal?.substring(0, 60) || "N/A"}`);
    console.log(`  steps: ${plan.steps?.length || 0}`);

    // 收集 plan 中的 unsupported steps
    const planUnsupported = (plan.steps || [])
      .filter((s) => s.supportStatus === "unsupported")
      .map((s) => ({
        source: "plan",
        actionType: s.capability || "unknown",
        actionName: s.description || s.purpose || "未知步骤",
        reason: `Planner 判定需要能力 ${s.capability || "unknown"}，当前系统未提供`,
      }));
    console.log(`  unsupported steps: ${planUnsupported.length}`);
    for (const u of planUnsupported) {
      console.log(`    - [${u.actionType}] ${u.actionName}`);
    }

    // Step 3: decideActions (Router)
    console.log("\n[Step 3] decideActions");
    const actions = await routerService.decideActions(plan, testCase.query, classification);
    console.log(`  actions: ${actions.length}`);
    for (const a of actions) {
      console.log(`    [${a.type}] ${a.name}`);
    }

    // Step 4: 模拟 executor 执行 + 收集阻断
    console.log("\n[Step 4] mockExecutor");
    const blockedSteps = [];
    const context = {};
    const stepResults = new Map();

    for (const action of actions) {
      try {
        mockValidateActionCase(action, context);
        console.log(`  [${action.type}] ✓ 通过`);
        stepResults.set(action.id, { success: true });
        context[action.id] = { success: true };
      } catch (err) {
        if (err.name === "CaseValidationError") {
          console.log(`  [${action.type}] ✗ 阻断: ${err.reason}`);
          blockedSteps.push({
            source: "executor",
            actionType: action.type,
            actionName: action.name,
            reason: err.reason,
          });
          break; // 中断执行
        }
        throw err;
      }
    }

    // Step 5: 聚合 + 统一评估
    console.log("\n[Step 5] evaluateRequirementNeed (DeepSeek)");
    const allBlocked = [...planUnsupported, ...blockedSteps];

    if (allBlocked.length === 0) {
      console.log("  → 无阻断，正常完成");
      return { pass: true, result: "success", shouldCreate: false };
    }

    console.log(`  聚合阻断项: ${allBlocked.length}`);
    const evaluation = await evaluateRequirementNeed(testCase.query, allBlocked);

    console.log(`  DeepSeek 评估结果:`);
    console.log(`    shouldCreate: ${evaluation.shouldCreate}`);
    console.log(`    reason: ${evaluation.reason}`);
    if (evaluation.requirement) {
      console.log(`    requirement.name: ${evaluation.requirement.name}`);
      console.log(`    requirement.applicationScenario: ${evaluation.requirement.applicationScenario}`);
    }

    // 验证
    const pass = evaluation.shouldCreate === testCase.expectShouldCreate;
    if (pass) {
      console.log(`  ✓ 断言通过: shouldCreate=${evaluation.shouldCreate} 符合预期`);
    } else {
      console.log(`  ✗ 断言失败: 预期 shouldCreate=${testCase.expectShouldCreate}，实际=${evaluation.shouldCreate}`);
    }

    return { pass, result: "evaluated", shouldCreate: evaluation.shouldCreate, evaluation };
  } catch (err) {
    console.error(`\n  ✗ 异常: ${err.message}`);
    return { pass: false, result: "error", error: err.message };
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("端到端测试: Planner -> Router -> Executor -> Requirement 聚合评估");
  console.log("=".repeat(70));

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
    const status = r.actual.pass === true ? "✓ PASS" : r.actual.result === "error" ? "✗ ERROR" : "✗ FAIL";
    if (r.actual.pass) passed++;
    else if (r.actual.result === "error") errors++;
    else failed++;

    const detail = r.actual.shouldCreate !== undefined
      ? `shouldCreate=${r.actual.shouldCreate}`
      : r.actual.error || "N/A";
    console.log(`${status} [${r.category}] ${r.name}: ${detail}`);
  }

  console.log(`\n总计: ${results.length} 个用例`);
  console.log(`  通过: ${passed}`);
  console.log(`  失败: ${failed}`);
  console.log(`  异常: ${errors}`);

  if (failed + errors > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("测试失败:", err);
  process.exit(1);
});
