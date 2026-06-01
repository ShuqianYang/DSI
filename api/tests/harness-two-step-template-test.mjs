/**
 * Phase 2A: 两步 Template 单元测试
 *
 * 纯单元测试，不依赖数据库连接。
 */

import { z } from "zod";
import { matchTemplates } from "../src/modules/harness/templateMatcher.js";
import { convertToRunnable } from "../src/modules/harness/matchRegistry.js";
import { newsSummaryTemplate } from "../src/modules/harness/templates/newsSummaryTemplate.js";
import { generateTemplateSummary } from "../src/modules/harness/finalizers/templateSummaryFinalizer.js";
import { finalizerTemplateSummaryContract } from "../src/modules/actions/contracts/finalizer.contract.js";
import { createRuntimeState, saveArtifact } from "../src/modules/harness/runtimeState.js";
import { registerRoutable } from "../src/modules/harness/matchRegistry.js";
import { weatherSimpleSkill } from "../src/modules/harness/skills/weatherSimpleSkill.js";

console.log("=== Phase 2A: Two-Step Template Unit Tests ===\n");

// 注册 routables（测试环境不会自动执行 index.ts 的注册）
registerRoutable(weatherSimpleSkill);
registerRoutable(newsSummaryTemplate);

// ========== Test 1: Matcher 命中 template ==========
console.log("TEST 1: Template matcher hit");
{
  const result = matchTemplates("最近日本有什么灾害新闻");
  console.log("  Tier:", result.tier);
  console.log("  Top candidate:", result.topCandidate?.id);
  console.assert(result.topCandidate?.id === "news.summary_template", "Should match news.summary_template");
  console.log("  Result:", result.topCandidate?.id === "news.summary_template" ? "✓" : "✗");
}

// ========== Test 2: Convert to Runnable ==========
console.log("\nTEST 2: Convert template to runnable");
{
  const runnable = convertToRunnable(newsSummaryTemplate);
  console.assert(runnable.steps.length === 2, "Should have 2 steps");
  console.log("  Step 1:", runnable.steps[0].stepKey, "tool=", runnable.steps[0].tool, "saveAs=", runnable.steps[0].saveAs);
  console.log("  Step 2:", runnable.steps[1].stepKey, "tool=", runnable.steps[1].tool);
  console.log("  Result:", runnable.steps.length === 2 ? "✓" : "✗");
}

// ========== Test 3: Finalizer generates summary without LLM ==========
console.log("\nTEST 3: Finalizer generates summary without LLM");
{
  const result = generateTemplateSummary({
    sourceTool: "news.search",
    query: "日本灾害",
    items: [
      { title: "日本暴雨致交通中断", source: "NHK" },
      { title: "台风逼近九州", source: "Reuters" },
    ],
  });
  console.log("  Summary:", result.summary.slice(0, 60) + "...");
  console.log("  KeyFindings:", result.keyFindings);
  console.log("  SuggestedNextAction:", result.suggestedNextAction);
  console.assert(result.keyFindings.length >= 2, "Should have at least 2 findings");
  console.assert(result.suggestedNextAction === "final_answer", "Should suggest final_answer");
  console.log("  Result:", result.suggestedNextAction === "final_answer" ? "✓" : "✗");
}

// ========== Test 4: Finalizer outputSchema validation ==========
console.log("\nTEST 4: Finalizer outputSchema validation");
{
  const valid = finalizerTemplateSummaryContract.outputSchema.safeParse({
    summary: "测试摘要",
    keyFindings: ["发现1", "发现2"],
    missingData: [],
    suggestedNextAction: "final_answer",
  });
  console.assert(valid.success, "Valid output should pass");
  console.log("  Valid output:", valid.success ? "PASS ✓" : "FAIL ✗");

  const invalid = finalizerTemplateSummaryContract.outputSchema.safeParse({
    summary: "测试摘要",
    // missing keyFindings, missingData, suggestedNextAction
  });
  console.assert(!invalid.success, "Invalid output should fail");
  console.log("  Invalid output:", !invalid.success ? "FAIL ✓" : "PASS ✗");
}

// ========== Test 5: Artifact save / read between steps ==========
console.log("\nTEST 5: Artifact save/read between steps");
{
  const state = createRuntimeState("task-5", "日本灾害新闻");

  // Step 1: save news results
  const newsResults = [
    { title: "暴雨报道", source: "NHK" },
    { title: "台风预警", source: "JMA" },
  ];
  saveArtifact(state, "news.search.results", newsResults);

  // Step 2: read from artifacts
  const items = state.artifacts["news.search.results"];
  console.log("  Saved items:", (items || []).length);
  console.assert(Array.isArray(items) && items.length === 2, "Should read 2 items");

  // Build finalizer params
  const params = {
    sourceTool: "news.search",
    query: state.userQuery,
    items,
    missingData: state.missingData,
  };
  const summary = generateTemplateSummary(params);
  console.log("  Generated summary:", summary.summary.slice(0, 60) + "...");
  console.log("  Result:", summary.summary.includes("2") ? "✓" : "✗");
}

// ========== Test 6: Template buildParams with state ==========
console.log("\nTEST 6: Template step buildParams");
{
  const state = createRuntimeState("task-6", "最近有什么新闻");

  // Step 1 buildParams
  const step1Params = newsSummaryTemplate.steps[0].buildParams(state);
  console.log("  Step 1 params:", JSON.stringify(step1Params));
  console.assert(step1Params.query === "最近有什么新闻", "Step 1 should use userQuery");

  // Simulate step 1 execution and save result
  saveArtifact(state, "news.search.results", [
    { title: "新闻1" },
    { title: "新闻2" },
  ]);

  // Step 2 buildParams
  const step2Params = newsSummaryTemplate.steps[1].buildParams(state);
  console.log("  Step 2 params:", JSON.stringify(step2Params));
  console.assert(step2Params.sourceTool === "news.search", "Step 2 should reference sourceTool");
  console.assert(Array.isArray(step2Params.items) && step2Params.items.length === 2, "Step 2 should read 2 items from artifacts");
  console.log("  Result:", step2Params.items?.length === 2 ? "✓" : "✗");
}

console.log("\n=== Phase 2A unit tests completed ===");
