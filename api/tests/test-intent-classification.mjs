/**
 * 意图分类 + requirement 生成测试
 *
 * 运行: cd api && npx tsx tests/test-intent-classification.mjs
 */

import { classifyIntent } from "../src/modules/planner/service.js";
import { generateRequirement } from "../src/modules/router/service.js";

const TEST_CASES = [
  // news
  { query: "查一下最近的南海新闻", expected: "news" },
  { query: "柳州5.2级地震的最新报道", expected: "news" },

  // earthquake
  { query: "对柳州柳南区5.2级地震做灾后评估", expected: "earthquake" },
  { query: "地震评估 柳州", expected: "earthquake" },

  // fire
  { query: "新疆边境火情研判", expected: "fire" },
  { query: "火灾检测 哈萨克斯坦", expected: "fire" },

  // oil_spill
  { query: "东海油污溯源", expected: "oil_spill" },
  { query: "海面油污 AIS轨迹", expected: "oil_spill" },

  // unknown
  { query: "帮我预测一下明年的台风路径", expected: "unknown" },
  { query: "分析一下全球气候变化趋势", expected: "unknown" },
];

async function testClassification() {
  console.log("========== 意图分类测试 ==========\n");
  let pass = 0;
  let fail = 0;

  for (const { query, expected } of TEST_CASES) {
    try {
      const result = await classifyIntent(query);
      const ok = result.intent === expected;
      const status = ok ? "✅ PASS" : "❌ FAIL";
      console.log(`${status} [${expected}] <- "${query}"`);
      console.log(`      intent=${result.intent}, missing=${JSON.stringify(result.missingParams)}, conf=${result.confidence}`);
      console.log(`      params=${JSON.stringify(result.params)}`);
      console.log();
      if (ok) pass++; else fail++;
    } catch (err) {
      console.log(`💥 ERROR [${expected}] <- "${query}": ${err.message}\n`);
      fail++;
    }
  }

  console.log(`分类结果: ${pass}/${TEST_CASES.length} 通过, ${fail}/${TEST_CASES.length} 失败\n`);
  return fail === 0;
}

async function testRequirement() {
  console.log("========== requirement 生成测试 ==========\n");

  const unknownQueries = [
    "帮我预测一下明年的台风路径",
    "分析一下全球气候变化趋势",
    "我想做一个无人机巡检系统",
  ];

  for (const query of unknownQueries) {
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
  const ok = await testClassification();
  await testRequirement();

  console.log("========== 测试完成 ==========");
  process.exit(ok ? 0 : 1);
}

main();
