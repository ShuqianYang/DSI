import "dotenv/config";
import { openskyWorker } from "./modules/opensky/worker.js";
import { aisWorker } from "./modules/ais/worker.js";

console.log("[Worker] OpenSky + AIS workers starting...");

const SHUTDOWN_TIMEOUT_MS = 5_000;
let shuttingDown = false;

async function shutdown(signal: "SIGINT" | "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Worker] ${signal} received, shutting down...`);
  try {
    await Promise.race([
      Promise.all([openskyWorker.close(), aisWorker.close()]),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("Worker shutdown timed out.")), SHUTDOWN_TIMEOUT_MS);
      }),
    ]);
    process.exit(0);
  } catch (error) {
    console.error("[Worker] Shutdown failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
