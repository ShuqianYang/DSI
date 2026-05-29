import { maritimeCapability } from "../src/modules/actions/capabilities/maritime.js";
import type { Action } from "@datasourceintelligence/shared";

async function testMaritime() {
  console.log("=== Maritime Capability Test ===\n");

  const action: Action = {
    id: "test-action-1",
    name: "海域态势分析",
    type: "maritime",
    params: { region: "东海", query: "分析东海近期态势" },
  };

  const result = await maritimeCapability.execute(action, {});

  console.log("success:", result.success);
  console.log("metadata:", JSON.stringify(result.metadata, null, 2));

  if (result.data) {
    const data = result.data as Record<string, unknown>;
    console.log("\nregion:", data.region);
    console.log("analysisId:", data.analysisId);

    const vessels = data.vessels as Array<Record<string, unknown>>;
    const aircrafts = data.aircrafts as Array<Record<string, unknown>>;
    const summary = data.summary as Record<string, unknown>;
    const gisLayers = data.gisLayers as Record<string, unknown>;

    console.log("\nvessels count:", vessels?.length);
    if (vessels?.length > 0) {
      console.log("first vessel:", JSON.stringify(vessels[0], null, 2));
    }

    console.log("\naircrafts count:", aircrafts?.length);
    if (aircrafts?.length > 0) {
      console.log("first aircraft:", JSON.stringify(aircrafts[0], null, 2));
    }

    console.log("\nsummary:", JSON.stringify(summary, null, 2));

    const heatmap = (gisLayers?.heatmap as Record<string, unknown>)?.data as Array<Record<string, unknown>>;
    const trajectories = (gisLayers?.trajectories as Record<string, unknown>)?.data as Array<Record<string, unknown>>;
    console.log("\ngisLayers heatmap points:", heatmap?.length);
    console.log("gisLayers trajectories:", trajectories?.length);
  }

  console.log("\n=== Test completed ===");
}

testMaritime().catch(console.error);
