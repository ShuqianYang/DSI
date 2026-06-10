import "dotenv/config";
import { connectAisStream } from "../src/modules/ais/client.js";
import { replaceAll } from "../src/modules/ais/repository.js";
import { normalizeAisShips } from "../src/modules/ais/ingestion.js";

console.log("[AIS] Starting manual ingestion...");
const data = await connectAisStream(15000);
console.log("[AIS] Fetched", data.ships.length, "ships");

if (data.ships.length === 0) {
  console.log("[AIS] Empty response, nothing to store.");
  process.exit(0);
}

const normalized = normalizeAisShips(data);
console.log("[AIS] Normalized", normalized.stats.normalized, "/", normalized.stats.total, "ships");

const result = await replaceAll(normalized.states);
console.log("[AIS] Stored:", result.deleted, "deleted,", result.inserted, "inserted");
