import "dotenv/config";
import { EventSource } from "eventsource";

/**
 * 测试实时 Agent Pipeline SSE 事件流
 * 1. POST /tasks 创建任务（立即返回 taskId）
 * 2. 立即建立 SSE 连接 /tasks/{taskId}/stream
 * 3. 验证事件顺序: planning → planning_done → routing → routing_done → completed
 */

async function testRealtimePipeline(query: string) {
  console.log("========================================");
  console.log("Query:", query);
  console.log("========================================\n");

  // 1. 创建任务
  const resp = await fetch("http://localhost:3001/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  const data = await resp.json();
  console.log("[1] POST /tasks response:", JSON.stringify(data));

  if (!data.taskId) {
    console.error("创建任务失败");
    return;
  }

  const taskId = data.taskId;

  // 2. 建立 SSE 连接
  console.log("\n[2] Connecting SSE...");
  const evtSource = new EventSource(`http://localhost:3001/tasks/${taskId}/stream`);

  const events: Array<{ type: string; timestamp: number; data: unknown }> = [];

  evtSource.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data);
      const record = { type: parsed.type, timestamp: Date.now(), data: parsed };
      events.push(record);

      // 简化打印
      switch (parsed.type) {
        case "connected":
          console.log("[SSE] connected");
          break;
        case "planning":
          console.log(`[SSE] planning: ${parsed.message}`);
          break;
        case "planning_done":
          console.log(`[SSE] planning_done: goal="${parsed.plan?.goal}" steps=${parsed.plan?.steps?.length}`);
          break;
        case "routing":
          console.log(`[SSE] routing: ${parsed.message}`);
          break;
        case "routing_done":
          console.log(`[SSE] routing_done: actions=${parsed.actions?.length} [${parsed.actions?.map((a: any) => a.type).join(", ")}]`);
          break;
        case "step_update":
          console.log(`[SSE] step_update: ${parsed.name} = ${parsed.status}`);
          break;
        case "completed":
          console.log(`[SSE] completed: ${parsed.message || ""}`);
          evtSource.close();
          printSummary(events);
          break;
        case "failed":
          console.log(`[SSE] failed: ${parsed.error || ""}`);
          evtSource.close();
          printSummary(events);
          break;
        default:
          console.log("[SSE] unknown:", parsed.type, JSON.stringify(parsed).slice(0, 200));
      }
    } catch (e) {
      console.warn("[SSE] parse error:", event.data);
    }
  };

  evtSource.onerror = (err) => {
    console.error("[SSE] error:", err);
    evtSource.close();
    printSummary(events);
  };

  // 超时自动关闭
  setTimeout(() => {
    if (evtSource.readyState !== EventSource.CLOSED) {
      console.log("\n[!] 60s timeout, closing SSE");
      evtSource.close();
      printSummary(events);
    }
  }, 60000);
}

function printSummary(events: Array<{ type: string; timestamp: number; data: unknown }>) {
  console.log("\n========================================");
  console.log("事件汇总 (按顺序)");
  console.log("========================================");
  if (events.length === 0) {
    console.log("未收到任何事件");
    return;
  }

  const order = events.map((e) => e.type);
  console.log("事件序列:", order.join(" → "));

  // 验证顺序
  const expectedOrder = ["connected", "planning", "planning_done", "routing", "routing_done"];
  const hasAll = expectedOrder.every((t) => order.includes(t));
  console.log("包含所有关键事件:", hasAll ? "✅ 是" : "❌ 否");

  // 检查顺序是否正确
  let orderCorrect = true;
  let lastIdx = -1;
  for (const t of expectedOrder) {
    const idx = order.indexOf(t);
    if (idx === -1) {
      orderCorrect = false;
      break;
    }
    if (idx < lastIdx) {
      orderCorrect = false;
      break;
    }
    lastIdx = idx;
  }
  console.log("事件顺序正确:", orderCorrect ? "✅ 是" : "❌ 否");

  // 计算各阶段耗时
  const getTime = (type: string) => events.find((e) => e.type === type)?.timestamp;
  const planningStart = getTime("planning");
  const planningEnd = getTime("planning_done");
  const routingStart = getTime("routing");
  const routingEnd = getTime("routing_done");

  if (planningStart && planningEnd) {
    console.log(`Planner 耗时: ${planningEnd - planningStart}ms`);
  }
  if (routingStart && routingEnd) {
    console.log(`Router 耗时: ${routingEnd - routingStart}ms`);
  }
  if (planningStart && routingEnd) {
    console.log(`总编排耗时: ${routingEnd - planningStart}ms`);
  }

  process.exit(0);
}

// 运行测试
testRealtimePipeline("每天早上9点推送东海海域船舶态势日报").catch((e) => {
  console.error(e);
  process.exit(1);
});
