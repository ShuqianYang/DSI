import "dotenv/config";
import { routerService } from "./src/modules/router/service.js";
import { plannerService } from "./src/modules/planner/service.js";

async function test() {
  console.log("MOCK_ROUTER:", process.env.MOCK_ROUTER);
  console.log("DIFY_ROUTER_API_KEY:", process.env.DIFY_ROUTER_API_KEY ? "set" : "empty");

  try {
    const plan = await plannerService.generatePlan("分析东海近期态势");
    console.log("\n--- Plan ---");
    console.log("Goal:", plan.goal);
    console.log("Steps:", plan.steps.map(s => s.description).join(" -> "));

    const actions = await routerService.decideActions(plan);
    console.log("\n--- Actions ---");
    actions.forEach((a, i) => {
      console.log(`${i + 1}. [${a.type}] ${a.name}: ${a.description}`);
    });
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
