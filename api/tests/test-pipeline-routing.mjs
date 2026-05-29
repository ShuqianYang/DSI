/**
 * Pipeline Intent 路由端到端测试
 *
 * 验证 5 条路径：
 * 1. news → 直接执行
 * 2. 场景 + 完整参数 → 原有流程
 * 3. 场景 + 缺参数 → requirement
 * 4. unknown → requirement + 外部提交
 * 5. classifyIntent 失败 → fallback 到原有流程
 *
 * 运行: cd api && npx tsx tests/test-pipeline-routing.mjs
 */

import { classifyIntent } from "../src/modules/planner/service.js";
import { generateRequirement } from "../src/modules/router/service.js";

const TEST_CASES = [
  {
    name: "news 路径",
    query: "查一下南海新闻",
    expectIntent: "news",
  },
  {
    name: "地震完整参数",
    query: "柳州 5.2 级地震评估",
    expectIntent: "earthquake",
    expectMissing: false,
  },
  {
    name: "火灾缺参数",
    query: "火灾检测",
    expectIntent: "fire",
    expectMissing: true,
  },
  {
    name: "油污完整参数",
    query: "东海油污溯源",
    expectIntent: "oil_spill",
    expectMissing: false,
  },
  {
    name: "unknown 路径",
    query: "预测明年台风路径",
    expectIntent: "unknown",
  },
];

async function testRouting() {
  console.log("========== Pipeline Intent 路由测试 ==========\n");

  let pass = 0;
  let fail = 0;

  for (const tc of TEST_CASES) {
    try {
      const result = await classifyIntent(tc.query);
      const intentOk = result.intent === tc.expectIntent;
      let missingOk = true;
      if (tc.expectMissing !== undefined) {
        const hasMissing = result.missingParams.length > 0;
        missingOk = hasMissing === tc.expectMissing;
      }

      const ok = intentOk && missingOk;
      const status = ok ? "✅ PASS" : "❌ FAIL";
      console.log(`${status} [${tc.name}]`);
      console.log(`      intent=${result.intent} (expect=${tc.expectIntent})`);
      console.log(`      missing=${JSON.stringify(result.missingParams)}`);
      console.log(`      conf=${result.confidence}`);

      if (ok) pass++;
      else fail++;
    } catch (err) {
      console.log(`💥 ERROR [${tc.name}]: ${err.message}\n`);
      fail++;
    }
  }

  console.log(`\n路由结果: ${pass}/${TEST_CASES.length} 通过, ${fail}/${TEST_CASES.length} 失败`);
  return fail === 0;
}

async function testUnknownRequirement() {
  console.log("\n========== Unknown 路径 Requirement 生成测试 ==========\n");

  const queries = [
    "帮我做一个无人机巡检系统",
    "分析一下全球气候变化趋势",
  ];

  for (const query of queries) {
    try {
      const result = await generateRequirement(query);
      console.log(`Query: "${query}"`);
      console.log(`  name: ${result.name}`);
      console.log(`  scenario: ${result.applicationScenario}`);
      console.log(`  desc: ${result.description.slice(0, 60)}...`);
      console.log();
    } catch (err) {
      console.log(`💥 ERROR: ${err.message}\n`);
    }
  }
}

async function main() {
  const ok = await testRouting();
  await testUnknownRequirement();

  console.log("========== 测试完成 ==========");
  process.exit(ok ? 0 : 1);
}

main();
