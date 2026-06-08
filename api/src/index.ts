import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { errorHandler } from "./middleware/errorHandler.js";
import {
  addGlobalSseClient,
  removeGlobalSseClient,
} from "./sse/sseManager.js";
import taskRoutes from "./modules/tasks/routes.js";
import {
  registerOpenSkyJob,
  shouldRegisterOpenSkyJob,
} from "./modules/opensky/queue.js";

const app = express();
const PORT = parseInt(process.env.API_PORT || "3001", 10);
const HOST = process.env.API_HOST || "0.0.0.0";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 中间件
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// 静态资源
app.use(express.static(path.join(__dirname, "..", "public")));

// 健康检查
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Agent 任务路由（唯一入口）
app.use("/tasks", taskRoutes);

// 全局 SSE 通道
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

// 404
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// 错误处理
app.use(errorHandler);

// 注册 OpenSky 定时任务（不阻塞启动）
if (shouldRegisterOpenSkyJob()) {
  void registerOpenSkyJob();
} else {
  console.log("[OpenSkyQueue] Disabled. Set OPENSKY_COLLECTOR_ENABLED=1 to enable hourly ingestion.");
}

app.listen(PORT, HOST, () => {
  console.log(`[API] Server listening on http://${HOST}:${PORT}`);
  console.log(`[API] Environment: ${process.env.NODE_ENV || "development"}`);
});
