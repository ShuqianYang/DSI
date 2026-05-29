import "dotenv/config";
import { db } from "../src/config/database.js";
import { tasks } from "../src/db/schema.js";
db.select().from(tasks).then(t => {
  console.log(JSON.stringify(t, null, 2));
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
