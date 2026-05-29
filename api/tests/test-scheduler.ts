import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  await client.connect();
  console.log("[Test] Connected to DB");

  // Clean up old test subscriptions
  await client.query(`DELETE FROM subscriptions WHERE name LIKE 'test-scheduler%'`);
  await client.query(`DELETE FROM events WHERE title LIKE '订阅任务「test-scheduler%'`);

  // Insert a test subscription with nextExecuteTime in the past
  const pastTime = new Date(Date.now() - 60_000); // 1 minute ago
  const insertResult = await client.query(
    `INSERT INTO subscriptions (
      name, type, schedule, next_execute_time, status, tool_type, query_params, user_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id`,
    [
      "test-scheduler-daily-report",
      "daily",
      "0 9 * * *",
      pastTime,
      "running",
      "daily_report",
      JSON.stringify({ report_type: "all" }),
      "test-user",
    ]
  );

  const subId = insertResult.rows[0].id;
  console.log(`[Test] Created subscription ${subId} with nextExecuteTime = ${pastTime.toISOString()}`);

  // Also test a failure case: unknown tool type
  const insertResult2 = await client.query(
    `INSERT INTO subscriptions (
      name, type, schedule, next_execute_time, status, tool_type, query_params, user_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id`,
    [
      "test-scheduler-fail",
      "daily",
      "0 9 * * *",
      pastTime,
      "running",
      "nonexistent_tool",
      JSON.stringify({}),
      "test-user",
    ]
  );
  const subId2 = insertResult2.rows[0].id;
  console.log(`[Test] Created failing subscription ${subId2} with unknown tool_type`);

  console.log("[Test] Waiting 70s for scheduler to scan...");

  setTimeout(async () => {
    console.log("\n[Test] Checking results...");

    // Check subscription 1
    const sub1 = await client.query(`SELECT * FROM subscriptions WHERE id = $1`, [subId]);
    console.log("\n--- Subscription 1 (daily_report) ---");
    console.log("  Status:", sub1.rows[0].status);
    console.log("  LastExecuteTime:", sub1.rows[0].last_execute_time);
    console.log("  NextExecuteTime:", sub1.rows[0].next_execute_time);
    console.log("  LastResult:", JSON.stringify(sub1.rows[0].last_result)?.slice(0, 200));

    // Check subscription 2
    const sub2 = await client.query(`SELECT * FROM subscriptions WHERE id = $1`, [subId2]);
    console.log("\n--- Subscription 2 (nonexistent tool) ---");
    console.log("  Status:", sub2.rows[0].status);
    console.log("  LastExecuteTime:", sub2.rows[0].last_execute_time);

    // Check events
    const ev1 = await client.query(
      `SELECT * FROM events WHERE title LIKE '订阅任务「test-scheduler%' ORDER BY created_at`
    );
    console.log("\n--- Events created ---");
    for (const ev of ev1.rows) {
      console.log(`  [${ev.status}] ${ev.title}`);
      console.log(`    Content: ${ev.content?.slice(0, 120)}...`);
    }

    // Cleanup
    await client.query(`DELETE FROM subscriptions WHERE name LIKE 'test-scheduler%'`);
    await client.query(`DELETE FROM events WHERE title LIKE '订阅任务「test-scheduler%' OR title LIKE '订阅任务「test-scheduler-fail%'`);
    console.log("\n[Test] Cleaned up test data");

    await client.end();
    process.exit(0);
  }, 70_000);
}

main().catch((err) => {
  console.error("[Test] Error:", err);
  process.exit(1);
});
