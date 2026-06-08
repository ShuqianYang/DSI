import { Queue } from "bullmq";

const QUEUE_NAME = "opensky";
const JOB_NAME = "fetch-and-store";
const CRON_PATTERN = "0 * * * *";

let openskyQueue: Queue | undefined;

export function shouldRegisterOpenSkyJob(): boolean {
  return process.env.OPENSKY_COLLECTOR_ENABLED === "1";
}

export async function getOpenSkyQueue(): Promise<Queue> {
  if (openskyQueue) return openskyQueue;
  const { redisConnection } = await import("../../config/redis.js");
  openskyQueue = new Queue(QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
      removeOnComplete: { count: 24 },
      removeOnFail: { count: 5 },
    },
  });
  return openskyQueue;
}

/**
 * Idempotently register the OpenSky repeatable job.
 * Safe to call on every API startup; skips if already registered.
 */
export async function registerOpenSkyJob(): Promise<void> {
  try {
    const queue = await getOpenSkyQueue();
    const repeatJobs = await queue.getRepeatableJobs();
    const exists = repeatJobs.some((job) => job.name === JOB_NAME);
    if (exists) {
      console.log("[OpenSkyQueue] Repeatable job already registered, skipping.");
      return;
    }

    await queue.add(
      JOB_NAME,
      {},
      {
        repeat: { pattern: CRON_PATTERN },
      }
    );
    console.log("[OpenSkyQueue] Repeatable job registered:", CRON_PATTERN);
  } catch (err) {
    console.error("[OpenSkyQueue] Failed to register repeatable job:", err);
    // Do not block API startup if Redis is temporarily unavailable.
  }
}
