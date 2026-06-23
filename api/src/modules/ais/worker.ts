import { Worker } from "bullmq";
import { redisConnection } from "../../config/redis.js";
import { ingestAisSnapshotOnce } from "./ingestion.js";

const QUEUE_NAME = "ais";
const JOB_NAME = "fetch-and-store";

async function processAisJob(): Promise<void> {
  console.log("[AisWorker] Starting job...");

  const result = await ingestAisSnapshotOnce();
  console.log("[AisWorker] Fetched", result.fetchedCount, "AIS ship states");
  if (result.skipped) {
    console.warn("[AisWorker] Skipped AIS replacement:", result.skippedReason);
    return;
  }
  console.log(
    "[AisWorker] Replaced:",
    result.deleted,
    "deleted,",
    result.inserted,
    "inserted"
  );
}

export const aisWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (job.name !== JOB_NAME) {
      console.log("[AisWorker] Ignoring unknown job:", job.name);
      return;
    }
    await processAisJob();
  },
  {
    connection: redisConnection,
    lockDuration: 300_000,
    maxStalledCount: 2,
  }
);

aisWorker.on("completed", (job) => {
  console.log("[AisWorker] Job completed:", job.id);
});

aisWorker.on("failed", (job, err) => {
  console.error("[AisWorker] Job failed:", job?.id, err.message);
});
