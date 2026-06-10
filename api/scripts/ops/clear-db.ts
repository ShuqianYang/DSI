import "dotenv/config";
import { db } from "../../src/config/database.js";
import { sql } from "drizzle-orm";
import { Queue } from "bullmq";
import { redisConnection } from "../../src/config/redis.js";

const TASK_QUEUE_NAME = "task-execution";

async function clear() {
  // 1. 清空 PostgreSQL 表
  await db.execute(sql`TRUNCATE TABLE tasks, task_steps, job_tasks, events, subscriptions, requirements, insights RESTART IDENTITY CASCADE`);
  console.log("[DB] All tables cleared");

  // 2. 清空 BullMq 队列
  const queue = new Queue(TASK_QUEUE_NAME, { connection: redisConnection });
  await queue.obliterate({ force: true });
  console.log(`[BullMq] Queue "${TASK_QUEUE_NAME}" obliterated`);

  // 3. 清理 Redis 中的 SSE 相关 key
  const keys = await redisConnection.keys("bull:*");
  if (keys.length > 0) {
    await redisConnection.del(...keys);
    console.log(`[Redis] Removed ${keys.length} bull:* keys`);
  }

  await queue.close();
  await redisConnection.quit();
  process.exit(0);
}

clear().catch((e) => { console.error(e); process.exit(1); });
