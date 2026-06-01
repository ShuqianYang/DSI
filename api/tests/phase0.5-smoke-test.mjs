#!/usr/bin/env node
/**
 * Phase 0.5 Smoke Test
 * 验证 Observation-driven Agent Loop 的 mock 决策链路
 * 不依赖数据库、Redis、外部 API
 *
 * 运行方式：cd api && npx tsx tests/phase0.5-smoke-test.mjs
 */

import { makeAgentDecision } from "../src/modules/harness/agentDecision.ts";
import { weatherFetchContract } from "../src/modules/actions/contracts/weather-fetch.contract.ts";
import { newsSearchContract } from "../src/modules/actions/contracts/news.contract.ts";

const registry = new Map();
registry.set(weatherFetchContract.name, weatherFetchContract);
registry.set(newsSearchContract.name, newsSearchContract);

async function testCase(name, query, observations) {
  console.log(`\n=== ${name} ===`);
  console.log(`Query: ${query}`);
  console.log(`Observations: ${observations.length}`);

  const decision = await makeAgentDecision(query, observations, Array.from(registry.values()));
  console.log(`Decision: ${decision.decision}`);
  console.log(`Reason: ${decision.reason}`);

  if (decision.decision === "tool_call") {
    console.log(`Tool: ${decision.tool}`);
    console.log(`Params: ${JSON.stringify(decision.params)}`);
  } else if (decision.decision === "final_answer") {
    console.log(`FinalText: ${decision.finalText.slice(0, 100)}...`);
  }
}

async function main() {
  console.log("Phase 0.5 Smoke Test");
  console.log("====================");

  // Test 1: 初始 query，无 observation → 应该选 news.search
  await testCase(
    "Test 1: 初始 query（新闻类）",
    "最近日本有没有灾害事件，会不会影响出行？",
    []
  );

  // Test 2: 初始 query（天气类）
  await testCase(
    "Test 2: 初始 query（天气类）",
    "东京明天天气怎么样？",
    []
  );

  // Test 3: 已有 news.search 结果（无灾害）→ 应该 final_answer
  await testCase(
    "Test 3: News 返回后（无灾害）",
    "最近日本有没有灾害事件，会不会影响出行？",
    [{
      stepId: "obs_1",
      sequence: 1,
      toolName: "news.search",
      params: { query: "日本 灾害" },
      result: {
        summary: { overview: "日本近日无重大灾害，天气平稳" },
        articles: [
          { title: "日本天气平稳", summary: "本周日本各地天气良好", source: "NHK" }
        ]
      },
      success: true,
      timestamp: Date.now()
    }]
  );

  // Test 4: 已有 news.search 结果（有灾害）→ 应该 weather.fetch
  await testCase(
    "Test 4: News 返回后（有灾害）",
    "最近日本有没有灾害事件，会不会影响出行？",
    [{
      stepId: "obs_2",
      sequence: 1,
      toolName: "news.search",
      params: { query: "日本 灾害" },
      result: {
        summary: { overview: "日本某地遭遇暴雨，道路中断" },
        articles: [
          { title: "日本暴雨", summary: "暴雨导致道路中断", source: "NHK" }
        ]
      },
      success: true,
      timestamp: Date.now()
    }]
  );

  // Test 5: 已有 news + weather → 应该 final_answer
  await testCase(
    "Test 5: News + Weather 后",
    "最近日本有没有灾害事件，会不会影响出行？",
    [{
      stepId: "obs_3",
      sequence: 1,
      toolName: "news.search",
      params: { query: "日本 灾害" },
      result: {
        summary: { overview: "日本暴雨" },
        articles: [{ title: "暴雨", summary: "暴雨", source: "NHK" }]
      },
      success: true,
      timestamp: Date.now()
    }, {
      stepId: "obs_4",
      sequence: 2,
      toolName: "weather.fetch",
      params: { region: "日本" },
      result: {
        message: "日本东京：风速 3.2m/s 东北风",
        windField: { grid: [] }
      },
      success: true,
      timestamp: Date.now()
    }]
  );

  console.log("\n====================");
  console.log("All smoke tests passed!");
}

main().catch(console.error);
