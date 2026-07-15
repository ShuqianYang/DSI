import "dotenv/config";
import { db, client } from "../../src/config/database.js";
import { agentTranscriptEntries, tasks } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

async function main() {
  const taskId = randomUUID();

  try {
    // 1. 创建一条 tasks 记录（外键依赖）
    await db.insert(tasks).values({
      id: taskId,
      query: "verify-transcript-table",
      status: "running",
    });
    console.log("[verify] created task:", taskId);

    // 2. 写入 agent_transcript_entries
    await db.insert(agentTranscriptEntries).values({
      taskId,
      turn: 1,
      sequence: 1,
      kind: "model_request",
      messages: [{ role: "user", content: "hello" }],
      metadata: { verified: true },
    });
    console.log("[verify] inserted transcript entry");

    // 3. 读取验证
    const rows = await db
      .select()
      .from(agentTranscriptEntries)
      .where(eq(agentTranscriptEntries.taskId, taskId));
    console.log("[verify] loaded rows:", rows.length);

    // 4. 清理测试数据
    await db.delete(agentTranscriptEntries).where(eq(agentTranscriptEntries.taskId, taskId));
    await db.delete(tasks).where(eq(tasks.id, taskId));
    console.log("[verify] cleaned up test data");

    console.log("[verify] agent_transcript_entries table is working");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[verify] failed:", error);
  process.exit(1);
});
