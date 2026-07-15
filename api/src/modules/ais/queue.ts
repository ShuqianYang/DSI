import { Queue } from "bullmq";

const QUEUE_NAME = "ais";
const JOB_NAME = "fetch-and-store";
const CRON_PATTERN = "0 * * * *";

let aisQueue: Queue | undefined;

export function shouldRegisterAisJob(): boolean {
  return process.env.AIS_STREAM_COLLECTOR_ENABLED === "1";
}

export async function getAisQueue(): Promise<Queue> {
  if (aisQueue) return aisQueue;
  const { redisConnection } = await import("../../config/redis.js");
  aisQueue = new Queue(QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
      removeOnComplete: { count: 24 },
      removeOnFail: { count: 5 },
    },
  });
  return aisQueue;
}

/**
 * Idempotently register the AIS repeatable job.
 * Safe to call on every API startup; skips if already registered.
 */
export async function registerAisJob(): Promise<void> {
  try {
    const queue = await getAisQueue();
    const repeatJobs = await queue.getRepeatableJobs();
    const exists = repeatJobs.some((job) => job.name === JOB_NAME);
    if (exists) {
      console.log("[AisQueue] Repeatable job already registered, skipping.");
      return;
    }

    await queue.add(
      JOB_NAME,
      {},
      {
        repeat: { pattern: CRON_PATTERN },
      }
    );
    console.log("[AisQueue] Repeatable job registered:", CRON_PATTERN);
  } catch (err) {
    console.error("[AisQueue] Failed to register repeatable job:", err);
    // Do not block API startup if Redis is temporarily unavailable.
  }
}
