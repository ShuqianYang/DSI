import "dotenv/config";
import { db } from "./src/config/database.js";
import { taskSteps } from "./src/db/schema.js";
import { eq } from "drizzle-orm";

async function main() {
  const steps = await db.select().from(taskSteps).where(eq(taskSteps.taskId, "59742df5-91a9-4c27-98d7-830446ca25ae"));
  console.log(JSON.stringify(steps, null, 2));
}
main();
