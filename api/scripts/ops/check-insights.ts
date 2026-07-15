import "dotenv/config";
import { db } from "../../src/config/database.js";
import { insights } from "../../src/db/schema.js";

async function main() {
  const rows = await db.select().from(insights);
  console.log("Insights count:", rows.length);
  if (rows.length === 0) {
    console.log("No insights found.");
    return;
  }
  rows.forEach((r) => {
    console.log(`- ${r.id} | ${r.title} | ${r.category} | ${r.riskLevel} | ${r.createdAt}`);
  });
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
