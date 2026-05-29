import "dotenv/config";
import { plannerService } from "./src/modules/planner/service.js";

async function test() {
  console.log("MOCK_PLANNER:", process.env.MOCK_PLANNER);
  console.log("DIFY_PLANNER_API_KEY:", process.env.DIFY_PLANNER_API_KEY ? "set" : "empty");

  try {
    const plan = await plannerService.generatePlan("分析东海近期态势");
    console.log("Plan goal:", plan.goal);
    console.log("Plan reasoning:", plan.reasoning?.substring(0, 100));
    console.log("Steps:", plan.steps.map(s => s.description).join(" -> "));
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
