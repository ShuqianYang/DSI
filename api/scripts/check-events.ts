import "dotenv/config";
import { db } from "../src/config/database.js";
import { events, insights } from "../src/db/schema.js";

async function check() {
  const e = await db.select().from(events);
  const i = await db.select().from(insights);
  console.log("events count:", e.length);
  console.log("insights count:", i.length);
  e.forEach((ev) => console.log("Event:", ev.title, "|", ev.taskName));
  i.forEach((ins) => console.log("Insight:", ins.title, "|", ins.riskLevel));
  process.exit(0);
}

check().catch((err) => { console.error(err); process.exit(1); });
