/**
 * 清空 BullMQ 队列 + 数据库所有业务数据
 * 用法: npx tsx tests/clean-all.ts
 */
import "dotenv/config";
import { Redis } from "ioredis";
import { Client } from "pg";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const dbUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/datasource";

const TABLES = [
  "events",
  "insights",
  "requirements",
  "subscriptions",
  "job_tasks",
  "task_steps",
  "tasks",
];

async function cleanBullMQ() {
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  // 删除所有 bull:task-execution:* 相关的 key
  const keys = await redis.keys("bull:task-execution:*");
  if (keys.length > 0) {
    await redis.del(...keys);
    console.log(`[Clean] BullMQ: 删除 ${keys.length} 个 key`);
  } else {
    console.log("[Clean] BullMQ: 队列为空，无需清理");
  }

  // 同时清理可能存在的其他队列（如果以后有）
  const otherKeys = await redis.keys("bull:*");
  if (otherKeys.length > 0) {
    await redis.del(...otherKeys);
    console.log(`[Clean] BullMQ: 额外删除 ${otherKeys.length} 个 key`);
  }

  await redis.quit();
}

async function cleanDatabase() {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  // TRUNCATE 所有业务表，CASCADE 处理外键依赖，RESTART IDENTITY 重置自增序列
  const sql = `TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE;`;
  await client.query(sql);
  console.log(`[Clean] DB: 已清空 ${TABLES.length} 张表`);

  await client.end();
}

async function main() {
  console.log("=== 开始清空数据 ===\n");

  try {
    await cleanBullMQ();
  } catch (err) {
    console.error("[Clean] BullMQ 清理失败:", (err as Error).message);
  }

  try {
    await cleanDatabase();
  } catch (err) {
    console.error("[Clean] DB 清理失败:", (err as Error).message);
  }

  console.log("\n=== 清理完成 ===");
}

main();
