import "dotenv/config";
import { openskyWorker } from "./modules/opensky/worker.js";

console.log("[Worker] OpenSky worker starting...");

async function shutdown(signal: "SIGINT" | "SIGTERM") {
  console.log(`[Worker] ${signal} received, shutting down...`);
  await openskyWorker.close();
  process.exit(0);
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
