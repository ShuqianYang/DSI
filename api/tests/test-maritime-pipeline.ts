import { maritimeCapability } from "../src/modules/actions/capabilities/maritime.js";

async function test() {
  // 模拟 Router 实际传递的参数（无 region，query 被改写）
  const action = {
    id: "action-1",
    type: "maritime" as const,
    name: "海域态势分析",
    description: "分析当前海域态势",
    params: { query: "分析当前海域态势" },
    dependsOn: [],
  };

  const result = await maritimeCapability.execute(action);
  console.log("=== Pipeline-like params ===");
  console.log("Success:", result.success);
  const data = result.data || {};
  console.log("Region:", data.region);
  console.log("Vessels count:", (data.vessels as unknown[] || []).length);
  console.log("Aircrafts count:", (data.aircrafts as unknown[] || []).length);
  console.log("Summary:", JSON.stringify(data.summary, null, 2));
}

test().catch(console.error).finally(() => process.exit(0));
