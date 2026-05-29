import { maritimeCapability } from "../src/modules/actions/capabilities/maritime.js";
import type { Action } from "@datasourceintelligence/shared";

// 模拟 writeDisplayData 的 maritime case 处理逻辑
function simulateWriteDisplayData(data: Record<string, unknown>) {
  const vessels = data.vessels as Array<Record<string, unknown>> | undefined;
  const aircrafts = data.aircrafts as Array<Record<string, unknown>> | undefined;
  const gisLayers = data.gisLayers as Record<string, unknown> | undefined;

  const shipEntities = vessels?.map((v) => ({
    id: v.id,
    name: v.name,
    type: "ship" as const,
    coordinates: [v.lng as number, v.lat as number],
    importance: (v.riskLevel === "high" ? "high" : v.riskLevel === "medium" ? "medium" : "low") as "high" | "medium" | "low",
    status: (v.status === "danger" ? "danger" : v.status === "warning" ? "warning" : "normal") as "normal" | "warning" | "danger",
    description: `${v.name} | 航速: ${v.speed}节 | 航向: ${v.heading}° | ${v.reason || ""}`,
  })) || [];

  const aircraftEntities = aircrafts?.map((a) => ({
    id: a.id,
    name: a.name,
    type: "aircraft" as const,
    coordinates: [a.lng as number, a.lat as number],
    importance: (a.riskLevel === "high" ? "high" : a.riskLevel === "medium" ? "medium" : "low") as "high" | "medium" | "low",
    status: (a.status === "danger" ? "danger" : a.status === "warning" ? "warning" : "normal") as "normal" | "warning" | "danger",
    description: `${a.name} | 航速: ${a.speed}km/h | 航向: ${a.heading}° | 高度: ${a.altitude}m | ${a.reason || ""}`,
  })) || [];

  const trajectoryData = (gisLayers?.trajectories as { data?: Array<{ vesselId: string; points: Array<{ lat: number; lng: number }> }> } | undefined)?.data;
  const trajectories = trajectoryData?.map((t) => ({
    id: `traj-${t.vesselId}`,
    name: `轨迹_${t.vesselId}`,
    type: "route" as const,
    coordinates: t.points.map((p) => [p.lng, p.lat] as [number, number]),
    status: "realtime" as const,
  })) || [];

  return {
    type: "entity" as const,
    entities: [...shipEntities, ...aircraftEntities],
    trajectories: trajectories.length > 0 ? trajectories : undefined,
  };
}

async function test() {
  console.log("=== Maritime → GIS 完整链路测试 ===\n");

  const action: Action = {
    id: "test-action-1",
    name: "海域态势分析",
    type: "maritime",
    params: { region: "东海", query: "分析东海近期态势" },
  };

  const result = await maritimeCapability.execute(action, {});

  if (!result.success || !result.data) {
    console.error("执行失败:", result);
    return;
  }

  // 模拟 writeDisplayData 处理
  const gisData = simulateWriteDisplayData(result.data as Record<string, unknown>);

  console.log("GIS 数据类型:", gisData.type);
  console.log("实体总数:", gisData.entities.length);
  console.log("  - 船舶:", gisData.entities.filter((e) => e.type === "ship").length);
  console.log("  - 飞机:", gisData.entities.filter((e) => e.type === "aircraft").length);
  console.log("轨迹数:", gisData.trajectories?.length || 0);

  console.log("\n--- 船舶实体样本 ---");
  const ship = gisData.entities.find((e) => e.type === "ship");
  console.log(JSON.stringify(ship, null, 2));

  if (gisData.entities.some((e) => e.type === "aircraft")) {
    console.log("\n--- 飞机实体样本 ---");
    const aircraft = gisData.entities.find((e) => e.type === "aircraft");
    console.log(JSON.stringify(aircraft, null, 2));
  }

  if (gisData.trajectories && gisData.trajectories.length > 0) {
    console.log("\n--- 轨迹样本 ---");
    console.log(JSON.stringify(gisData.trajectories[0], null, 2));
  }

  console.log("\n=== 测试通过 ===");
}

test().catch(console.error);
