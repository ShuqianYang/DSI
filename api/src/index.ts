import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { errorHandler } from "./middleware/errorHandler.js";
import { redisSubscriber } from "./config/redis.js";
import { SSE_CHANNEL } from "./queue/taskQueue.js";
import {
  notifyTaskUpdate,
  broadcastToAll,
  addGlobalSseClient,
  removeGlobalSseClient,
  notifyGlobalClients,
} from "./sse/sseManager.js";
import taskRoutes from "./modules/tasks/routes.js";
import jobRoutes from "./modules/jobs/routes.js";
import eventRoutes from "./modules/events/routes.js";
import subscriptionRoutes from "./modules/subscriptions/routes.js";
import requirementRoutes from "./modules/requirements/routes.js";
import insightRoutes from "./modules/insights/routes.js";
import infoCenterRoutes from "./modules/info-center/routes.js";
import aisRoutes from "./modules/ais/routes.js";
import adsRoutes from "./modules/ads/routes.js";
import phase0Routes from "./modules/harness/phase0/routes.js";
import { registerRoutable } from "./modules/harness/matchRegistry.js";
import { weatherSimpleSkill } from "./modules/harness/skills/weatherSimpleSkill.js";
import { newsSummaryTemplate } from "./modules/harness/templates/newsSummaryTemplate.js";
import { startScheduler } from "./modules/scheduler/service.js";
import { updateAisPositions } from "./data/aisDataStore.js";
import { initAdsAircrafts, updateAdsPositions } from "./data/adsDataStore.js";
import { resolveSliceCallback } from "./modules/actions/capabilities/satelliteCallbackStore.js";

const app = express();
const PORT = parseInt(process.env.API_PORT || "3001", 10);
const HOST = process.env.API_HOST || "0.0.0.0";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 中间件
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// 静态资源（mock SAR 影像、瓦片等）：api/public/* → 根路径
app.use(express.static(path.join(__dirname, "..", "public")));

// 健康检查
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API 路由
app.use("/tasks", taskRoutes);       // Agent 编排任务
app.use("/jobs", jobRoutes);         // 可执行任务列表
app.use("/events", eventRoutes);     // 事件列表
app.use("/subscriptions", subscriptionRoutes);  // 订阅任务
app.use("/requirements", requirementRoutes);    // 定制需求
app.use("/insights", insightRoutes);
app.use("/info-center", infoCenterRoutes);
app.use("/ais", aisRoutes);              // AIS 船舶数据
app.use("/ads", adsRoutes);              // ADS-B 航空数据
app.use("/agent/phase0", phase0Routes);  // Phase 0 Agent Harness debug

// 全局 SSE 通道：接收 subscription_triggered_task 等跨任务事件
app.get("/sse/global", (_req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders?.();

  addGlobalSseClient(res);

  _req.on("close", () => {
    removeGlobalSseClient(res);
  });
});

// 卫星切片回调：外部系统处理完需求后推送切片数据
app.post("/agent/callback/slice", (req, res) => {
  const payload = req.body as Record<string, unknown>;
  const requirementId = payload.requirementId as string | undefined;

  console.log(`[SliceCallback] Received callback for requirementId=${requirementId}`);
  console.log("[SliceCallback] Payload:", JSON.stringify(payload, null, 2));

  if (!requirementId) {
    res.status(400).json({ state: false, message: "missing requirementId", code: 400 });
    return;
  }

  const resolved = resolveSliceCallback(requirementId, payload as any);
  if (resolved) {
    console.log(`[SliceCallback] Resolved pending callback for ${requirementId}`);
    res.status(200).json({ state: true, message: "已接收", code: 200 });
  } else {
    console.warn(`[SliceCallback] No pending callback found for ${requirementId}`);
    res.status(200).json({ state: true, message: "已接收（无等待方）", code: 200 });
  }
});

// 404
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// 错误处理
app.use(errorHandler);

// Redis Pub/Sub：订阅 Worker 完成事件，推送到 SSE 客户端
redisSubscriber.subscribe(SSE_CHANNEL);
redisSubscriber.on("message", (channel: string, message: string) => {
  if (channel !== SSE_CHANNEL) return;
  try {
    const data = JSON.parse(message) as Record<string, unknown>;
    const taskId = data.taskId as string | undefined;
    const eventType = data.type as string | undefined;

    if (taskId) {
      console.log(`[SSE] Received update for task ${taskId}: ${data.status}`);
      notifyTaskUpdate(taskId, data);
      // subscription_triggered_task 需要推送给全局 SSE 客户端（前端可能还没建立该 task 的连接）
      if (eventType === "subscription_triggered_task") {
        console.log(`[SSE] Notifying global clients of subscription_triggered_task`);
        notifyGlobalClients(data);
      }
    } else {
      // 无 taskId 的全局事件（如 subscription_completed），广播给所有 SSE 客户端
      console.log(`[SSE] Broadcasting global event: ${data.type}`);
      broadcastToAll(data);
      notifyGlobalClients(data);
    }
  } catch (err) {
    console.error("[SSE] Failed to parse Redis message:", err);
  }
});

// 注册 Skill / Template（Agent Harness matchRegistry）
registerRoutable(weatherSimpleSkill);
registerRoutable(newsSummaryTemplate);
console.log("[Harness] Registered skill: weather.simple_query, template: news.summary_template");

app.listen(PORT, HOST, () => {
  console.log(`[API] Server listening on http://${HOST}:${PORT}`);
  console.log(`[API] Environment: ${process.env.NODE_ENV || "development"}`);

  // 启动订阅调度器
  startScheduler();

  // 启动 AIS 船舶位置更新定时器（每 3 秒一次，与前端同步）
  const apiKey = process.env.AISSTREAM_API_KEY;
  if (apiKey) {
    console.log("[AIS] Real-time mode: AISStream WebSocket enabled");
  } else {
    console.log("[AIS] Mock mode: AISSTREAM_API_KEY not set, using simulated ships");
  }

  setInterval(() => {
    updateAisPositions(3);
  }, 3000);
  console.log("[AIS] Position update scheduler started (every 3s)");

  // 启动 ADS-B 飞机数据
  initAdsAircrafts();
  setInterval(() => {
    updateAdsPositions(3);
  }, 3000);
  console.log("[ADS-B] Position update scheduler started (every 3s)");
});
