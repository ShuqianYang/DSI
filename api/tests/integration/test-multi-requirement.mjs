#!/usr/bin/env node
/**
 * 验证新提示词：是否能正确拆分多个 requirement 并标注 type
 * 不依赖数据库，直接调 DeepSeek API
 */

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-v4-flash";

// 读取 dist 中编译后的提示词构建函数
const { buildRequirementEvalPrompt, REQUIREMENT_EVAL_SYSTEM_PROMPT } =
  await import("../../dist/lib/prompts/requirement-eval.js");

const TEST_CASES = [
  {
    name: "混合缺失：数据+工具+组件",
    query: "我想实时查看全球机场航班动态，并在地图上显示延误热力图",
    blockedItems: [
      { source: "plan", actionType: "flight-tracker", actionName: "航班实时追踪", reason: "缺少全球航班数据源" },
      { source: "plan", actionType: "heatmap-generator", actionName: "热力图生成", reason: "缺少延误分析算法" },
      { source: "plan", actionType: "delay-dashboard", actionName: "延误面板", reason: "缺少前端延误可视化组件" },
    ],
    expectMultiple: true,
  },
  {
    name: "仅缺工具",
    query: "帮我预测下个月南海台风路径",
    blockedItems: [
      { source: "plan", actionType: "typhoon-predict", actionName: "台风路径预测", reason: "缺少台风预测模型" },
    ],
    expectMultiple: false,
  },
  {
    name: "无厘头",
    query: "今天吃什么",
    blockedItems: [],
    expectMultiple: false,
  },
];

async function callDeepSeek(messages) {
  const resp = await fetch(DEEPSEEK_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({ model: DEEPSEEK_MODEL, messages, stream: false, temperature: 0.3 }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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

console.log("=".repeat(70));
console.log("多 requirement + type 提示词验证");
console.log("=".repeat(70));

for (const tc of TEST_CASES) {
  console.log(`\n--- 用例: ${tc.name} ---`);
  console.log(`查询: ${tc.query}`);

  const hasBlocked = tc.blockedItems.length > 0;
  const blockedSummary = hasBlocked
    ? tc.blockedItems.map((b, i) => `${i + 1}. [${b.source}] ${b.actionType} — ${b.actionName}\n   原因：${b.reason}`).join("\n\n")
    : "系统当前无任何可用工具可以处理该请求。";
  const contextHint = hasBlocked
    ? "当前系统有部分能力，但缺少特定工具或数据源"
    : "当前系统完全无法处理该请求";

  const prompt = buildRequirementEvalPrompt({ query: tc.query, blockedSummary, contextHint });

  try {
    const answer = await callDeepSeek([
      { role: "system", content: REQUIREMENT_EVAL_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);

    const json = extractJson(answer);
    const parsed = JSON.parse(json);

    console.log(`  shouldCreate: ${parsed.shouldCreate}`);
    console.log(`  reason: ${parsed.reason}`);

    const reqs = Array.isArray(parsed.requirements) ? parsed.requirements : [];
    console.log(`  requirements 数量: ${reqs.length}`);

    for (const r of reqs) {
      const typeLabel = r.type === 1 ? "数据" : r.type === 2 ? "工具" : r.type === 3 ? "组件" : `未知(${r.type})`;
      console.log(`    [type=${r.type} ${typeLabel}] ${r.name}`);
      console.log(`      description: ${(r.description || "").slice(0, 60)}...`);
      console.log(`      scenario: ${r.applicationScenario}`);
    }

    if (tc.expectMultiple && reqs.length < 2) {
      console.log(`  ⚠️ 期望多个 requirement，实际只有 ${reqs.length} 个`);
    }
    if (!tc.expectMultiple && reqs.length > 1) {
      console.log(`  ⚠️ 期望单个/零个 requirement，实际有 ${reqs.length} 个`);
    }
    if (reqs.some((r) => ![1, 2, 3].includes(Number(r.type)))) {
      console.log(`  ⚠️ 存在非法 type 值: ${reqs.map((r) => r.type).join(", ")}`);
    }

    console.log(`  ✅ 通过`);
  } catch (err) {
    console.log(`  ❌ 失败: ${err.message}`);
  }
}

console.log("\n" + "=".repeat(70));
