/**
 * News capability 测试（qwen + tavily 链路）
 *
 * 运行: cd api && npx tsx tests/test-news.mjs
 */

import "dotenv/config";
import { newsCapability } from "../src/modules/actions/capabilities/news.js";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatResult(result, label) {
  console.log(`\n📋 ${label}`);
  console.log(`   success: ${result.success}`);
  console.log(`   capability: ${result.metadata?.capability}`);
  console.log(`   source: ${result.metadata?.source}`);
  console.log(`   executionTime: ${result.metadata?.executionTime}ms`);
  if (result.metadata?.searchQuery) {
    console.log(`   searchQuery: ${result.metadata?.searchQuery}`);
  }
  if (result.metadata?.resultCount != null) {
    console.log(`   resultCount: ${result.metadata?.resultCount}`);
  }
  if (result.metadata?.error) {
    console.log(`   error: ${result.metadata?.error}`);
  }

  const data = result.data;
  if (data?.summary) {
    console.log(`   overview: ${data.summary.overview?.slice(0, 120)}...`);
  }
  if (Array.isArray(data?.articles)) {
    console.log(`   articles: ${data.articles.length} 条`);
    data.articles.slice(0, 3).forEach((a, i) => {
      console.log(`      ${i + 1}. [${a.source}] ${a.title?.slice(0, 50)}`);
    });
  }
  if (Array.isArray(data?.trends)) {
    console.log(`   trends: ${data.trends.length} 个`);
  }
}

async function testNewsSearch() {
  console.log("\n========================================");
  console.log("🧪 测试 1: 实时新闻搜索 (qwen + tavily)");
  console.log("========================================");

  const action = {
    id: "test-news-1",
    type: "news",
    params: {
      query: "南海仁爱礁最新消息",
      region: "南海",
      timeRange: "7d",
    },
  };

  const result = await newsCapability.execute(action);
  formatResult(result, "实时搜索");
  return result.success && result.metadata?.source?.includes("tavily");
}

async function testFireScenario() {
  console.log("\n========================================");
  console.log("🧪 测试 2: 火情 Scenario Mock");
  console.log("========================================");

  const action = {
    id: "test-fire-1",
    type: "news",
    params: {
      query: "新疆边境火情",
      region: "新疆-哈萨克斯坦边境",
      fireScenario: true,
    },
  };

  const result = await newsCapability.execute(action);
  formatResult(result, "火情 Scenario");
  return result.success && result.metadata?.mock === true;
}

async function testEarthquakeScenario() {
  console.log("\n========================================");
  console.log("🧪 测试 3: 地震 Scenario Mock");
  console.log("========================================");

  const action = {
    id: "test-earthquake-1",
    type: "news",
    params: {
      query: "广西柳州地震",
      region: "广西柳州市柳南区",
      earthquakeScenario: true,
    },
  };

  const result = await newsCapability.execute(action);
  formatResult(result, "地震 Scenario");

  const hasEarthquakeInfo = !!result.data?.earthquakeInfo;
  console.log(`   has earthquakeInfo: ${hasEarthquakeInfo}`);
  if (hasEarthquakeInfo) {
    console.log(`   magnitude: ${result.data.earthquakeInfo.magnitude}`);
    console.log(`   location: ${result.data.earthquakeInfo.location}`);
  }

  return result.success && result.metadata?.mock === true && hasEarthquakeInfo;
}

async function testNoResults() {
  console.log("\n========================================");
  console.log("🧪 测试 4: 无结果情况（超长无意义 query）");
  console.log("========================================");

  const action = {
    id: "test-empty-1",
    type: "news",
    params: {
      query: "asdfghjkl12345nonexistentquery",
      region: "",
      timeRange: "7d",
    },
  };

  try {
    const result = await newsCapability.execute(action);
    formatResult(result, "无结果处理");
    return result.success; // 即使没结果也应返回 success=true 的空结果
  } catch (err) {
    console.log(`   ⚠️ 异常: ${err.message}`);
    return false;
  }
}

// ===== 主流程 =====
async function main() {
  console.log("🚀 News Capability 测试开始");
  console.log(`   QWEN_API_KEY: ${process.env.QWEN_API_KEY ? "已设置" : "未设置"}`);
  console.log(`   TAVILY_API_KEY: ${process.env.TAVILY_API_KEY ? "已设置" : "未设置"}`);

  if (!process.env.QWEN_API_KEY || !process.env.TAVILY_API_KEY) {
    console.log("\n⚠️ 警告: API Key 未设置，实时搜索测试可能会失败");
    console.log("   请确保 .env 中已配置 QWEN_API_KEY 和 TAVILY_API_KEY");
  }

  const results = [];

  try {
    results.push({ name: "实时搜索", ok: await testNewsSearch() });
  } catch (err) {
    console.error("\n💥 实时搜索测试失败:", err.message);
    results.push({ name: "实时搜索", ok: false, error: err.message });
  }

  try {
    results.push({ name: "火情 Scenario", ok: await testFireScenario() });
  } catch (err) {
    console.error("\n💥 火情测试失败:", err.message);
    results.push({ name: "火情 Scenario", ok: false, error: err.message });
  }

  try {
    results.push({ name: "地震 Scenario", ok: await testEarthquakeScenario() });
  } catch (err) {
    console.error("\n💥 地震测试失败:", err.message);
    results.push({ name: "地震 Scenario", ok: false, error: err.message });
  }

  try {
    results.push({ name: "无结果处理", ok: await testNoResults() });
  } catch (err) {
    console.error("\n💥 无结果测试失败:", err.message);
    results.push({ name: "无结果处理", ok: false, error: err.message });
  }

  // 汇总
  console.log("\n========================================");
  console.log("📊 测试汇总");
  console.log("========================================");
  let passed = 0;
  for (const r of results) {
    const icon = r.ok ? "✅" : "❌";
    console.log(`  ${icon} ${r.name}`);
    if (r.error) console.log(`     错误: ${r.error}`);
    if (r.ok) passed++;
  }
  console.log(`\n总计: ${passed}/${results.length} 通过`);

  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error("未捕获异常:", err);
  process.exit(1);
});
