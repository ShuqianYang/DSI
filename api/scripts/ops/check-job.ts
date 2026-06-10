import "dotenv/config";
import { db } from "./src/config/database.js";
import { jobTasks } from "./src/db/schema.js";
import { eq } from "drizzle-orm";

async function main() {
  const jobs = await db.select().from(jobTasks).where(eq(jobTasks.agentTaskId, "5beb0ac1-ed1a-4e22-a970-2e7bc1d37141"));
  console.log(JSON.stringify(jobs, null, 2));
}
main();
