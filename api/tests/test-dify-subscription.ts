import "dotenv/config";
import { plannerService } from "../src/modules/planner/service.js";
import { routerService } from "../src/modules/router/service.js";

const TEST_QUERIES = [
  "每天早上9点给我推送东海海域船舶态势日报",
  "订阅每周一的南海监测报告",
  "有异常时自动推送预警通知",
  "每天早上推送设备运行状态",
];

async function testQuery(query: string) {
  console.log("=".repeat(80));
  console.log("Query:", query);
  console.log("=".repeat(80));

  // 1. Planner
  console.log("\n[Planner] 生成计划...");
  const plan = await plannerService.generatePlan(query);
  console.log("Goal:", plan.goal);
  console.log("Reasoning:", plan.reasoning?.slice(0, 200));
  console.log("Steps:", plan.steps.length);
  plan.steps.forEach((s: any, i: number) => {
    console.log(`  ${i + 1}. ${s.description} (purpose: ${s.purpose})`);
  });

  // 2. Router
  console.log("\n[Router] 决策 Actions...");
  const actions = await routerService.decideActions(plan);
  console.log("Actions count:", actions.length);
  actions.forEach((a: any, i: number) => {
    console.log(`  ${i + 1}. type=${a.type} | name=${a.name}`);
    console.log(`     params:`, JSON.stringify(a.params));
    console.log(`     dependsOn:`, a.dependsOn || "none");
  });

  // 3. 判断是否包含 subscription
  const hasSubscription = actions.some((a: any) => a.type === "subscription");
  console.log("\n[Result] 包含 subscription:", hasSubscription ? "✅ 是" : "❌ 否");

  return { query, plan, actions, hasSubscription };
}

async function main() {
  const results = [];
  for (const query of TEST_QUERIES) {
    try {
      const result = await testQuery(query);
      results.push(result);
    } catch (e: any) {
      console.error("Error testing query:", query, e.message);
      results.push({ query, error: e.message });
    }
    console.log("\n");
  }

  console.log("=".repeat(80));
  console.log("汇总结果");
  console.log("=".repeat(80));
  results.forEach((r: any) => {
    const status = r.error ? "❌ ERROR" : r.hasSubscription ? "✅ 订阅" : "❌ 非订阅";
    console.log(`${status} | ${r.query.slice(0, 40)}...`);
    if (!r.error && !r.hasSubscription && r.actions) {
      console.log(`       实际返回: ${r.actions.map((a: any) => a.type).join(", ")}`);
    }
  });

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
