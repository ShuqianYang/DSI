import "dotenv/config";
import { taskWorker } from "./queue/taskQueue.js";

console.log("[Worker] Task execution worker started");
console.log("[Worker] Waiting for jobs...");

// 保持进程运行
process.on("SIGTERM", async () => {
  console.log("[Worker] SIGTERM received, closing...");
  await taskWorker.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[Worker] SIGINT received, closing...");
  await taskWorker.close();
  process.exit(0);
});
