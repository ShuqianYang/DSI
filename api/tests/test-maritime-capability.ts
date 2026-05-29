import { maritimeCapability } from "../src/modules/actions/capabilities/maritime.js";

async function test() {
  const action = {
    id: "action-1",
    type: "maritime" as const,
    name: "海域态势分析",
    description: "分析东海态势",
    params: { query: "分析东海最近态势", region: "东海" },
    dependsOn: [],
  };

  const result = await maritimeCapability.execute(action);
  console.log("Success:", result.success);
  const data = result.data || {};
  console.log("Region:", data.region);
  console.log("Vessels count:", (data.vessels as unknown[] || []).length);
  console.log("Aircrafts count:", (data.aircrafts as unknown[] || []).length);
  console.log("Summary:", JSON.stringify(data.summary, null, 2));
  if ((data.vessels as unknown[] || []).length > 0) {
    console.log("First vessel:", JSON.stringify((data.vessels as unknown[])[0], null, 2));
  }
  if ((data.aircrafts as unknown[] || []).length > 0) {
    console.log("First aircraft:", JSON.stringify((data.aircrafts as unknown[])[0], null, 2));
  }
}

test().catch(console.error).finally(() => process.exit(0));
