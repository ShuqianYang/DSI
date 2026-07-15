import assert from "node:assert/strict";
import { shouldRegisterOpenSkyJob } from "../../src/modules/opensky/queue.js";

const original = process.env.OPENSKY_COLLECTOR_ENABLED;

try {
  delete process.env.OPENSKY_COLLECTOR_ENABLED;
  assert.equal(shouldRegisterOpenSkyJob(), false);

  process.env.OPENSKY_COLLECTOR_ENABLED = "0";
  assert.equal(shouldRegisterOpenSkyJob(), false);

  process.env.OPENSKY_COLLECTOR_ENABLED = "1";
  assert.equal(shouldRegisterOpenSkyJob(), true);
} finally {
  if (original === undefined) delete process.env.OPENSKY_COLLECTOR_ENABLED;
  else process.env.OPENSKY_COLLECTOR_ENABLED = original;
}

console.log("opensky queue config test passed");
