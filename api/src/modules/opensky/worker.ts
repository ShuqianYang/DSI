import { Worker } from "bullmq";
import { redisConnection } from "../../config/redis.js";
import { ingestOpenSkySnapshotOnce } from "./ingestion.js";

const QUEUE_NAME = "opensky";
const JOB_NAME = "fetch-and-store";

async function processOpenSkyJob(): Promise<void> {
  console.log("[OpenSkyWorker] Starting job...");

  const result = await ingestOpenSkySnapshotOnce();
  console.log("[OpenSkyWorker] Fetched", result.fetchedCount, "aircraft states");
  if (result.skipped) {
    console.warn("[OpenSkyWorker] Skipped OpenSky replacement:", result.skippedReason);
    return;
  }
  console.log(
    "[OpenSkyWorker] Replaced:",
    result.deleted,
    "deleted,",
    result.inserted,
    "inserted"
  );
}

export const openskyWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (job.name !== JOB_NAME) {
      console.log("[OpenSkyWorker] Ignoring unknown job:", job.name);
      return;
    }
    await processOpenSkyJob();
  },
  {
    connection: redisConnection,
    lockDuration: 120000,
    maxStalledCount: 2,
  }
);

openskyWorker.on("completed", (job) => {
  console.log("[OpenSkyWorker] Job completed:", job.id);
});

openskyWorker.on("failed", (job, err) => {
  console.error("[OpenSkyWorker] Job failed:", job?.id, err.message);
});
