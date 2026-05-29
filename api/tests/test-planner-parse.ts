import { plannerService } from "../src/modules/planner/service.js";

// 模拟 Dify 返回的有问题的 JSON（description 缺少引号）
const badJson = `"goal": "分析东海近期海域安全态势", "steps": [ { "id": "step-1", description": "明确分析时间范围", "purpose": "确定'近期'的具体时间跨度", "expectedOutput": "时间范围" }, { "id": "step-2", "description": "检索船舶动态数据", "purpose": "从海域系统获取数据", "expectedOutput": "数据列表" } ], "reasoning": "用户请求分析海域态势。"`;

async function test() {
  // 直接调用 parsePlanFromText（但它是内部函数，无法直接调用）
  // 所以我们用 plannerService.generatePlan 的 mock 版本来测试
  process.env.MOCK_PLANNER = "true";
  const plan = await plannerService.generatePlan("分析东海近期态势", {});
  console.log("Mock plan result:", JSON.stringify(plan, null, 2));
}

test().catch(console.error);

// 直接测试 parsePlanFromText 的逻辑
function testParsePlanFromText(text: string, query: string) {
  const trimmed = text.trim().replace(/^﻿/, "");

  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonCandidate = codeBlockMatch ? codeBlockMatch[1].trim() : trimmed;

  try {
    const parsed = JSON.parse(jsonCandidate);
    console.log("[Test] Direct parse succeeded:", parsed.goal);
    return parsed;
  } catch (e) {
    console.log("[Test] Direct parse failed:", (e as Error).message.slice(0, 80));
  }

  let wrapped = jsonCandidate;
  if (!jsonCandidate.startsWith("{")) {
    wrapped = jsonCandidate.endsWith("}")
      ? `{${jsonCandidate}`
      : `{${jsonCandidate}}`;
  }
  try {
    const parsed = JSON.parse(wrapped);
    console.log("[Test] Wrapped parse succeeded:", parsed.goal);
    return parsed;
  } catch (e) {
    console.log("[Test] Wrapped parse failed:", (e as Error).message.slice(0, 80));
  }

  // 修复缺少引号的属性键
  const fixedQuotes = wrapped.replace(/([{\[,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":');
  try {
    const parsed = JSON.parse(fixedQuotes);
    console.log("[Test] FixedQuotes parse succeeded:", parsed.goal);
    console.log("[Test] Steps count:", parsed.steps?.length);
    console.log("[Test] Fixed text preview:", fixedQuotes.slice(0, 120));
    return parsed;
  } catch (e) {
    console.log("[Test] FixedQuotes parse failed:", (e as Error).message.slice(0, 80));
  }

  return null;
}

console.log("\n=== Testing bad JSON ===");
const result = testParsePlanFromText(badJson, "分析东海近期态势");
console.log("Result:", result ? "OK" : "FAILED");
