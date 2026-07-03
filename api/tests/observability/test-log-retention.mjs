import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cleanupAgentLoopLogs } from "../../src/modules/observability/logRetention.ts";

const rootDir = path.join(os.tmpdir(), `agent-loop-log-retention-${Date.now()}`);
const expiredDir = path.join(rootDir, "2026-01-01", "session-a");
const retainedDir = path.join(rootDir, "2026-07-03", "session-b");
const invalidDateDir = path.join(rootDir, "2026-99-99");

await fs.mkdir(expiredDir, { recursive: true });
await fs.mkdir(retainedDir, { recursive: true });
await fs.mkdir(invalidDateDir, { recursive: true });
await fs.writeFile(path.join(expiredDir, "file.jsonl"), "{}\n");
await fs.writeFile(path.join(retainedDir, "file.jsonl"), "{}\n");
await fs.writeFile(path.join(invalidDateDir, "file.jsonl"), "{}\n");
await fs.writeFile(path.join(rootDir, "notes.txt"), "keep me");

const result = await cleanupAgentLoopLogs({
  rootDir,
  retentionDays: 30,
  now: new Date("2026-07-03T12:00:00.000Z"),
});

await assert.rejects(fs.stat(path.join(rootDir, "2026-01-01")));
assert.ok(await fs.stat(path.join(rootDir, "2026-07-03")));
assert.ok(await fs.stat(path.join(rootDir, "2026-99-99")));
assert.equal(await fs.readFile(path.join(rootDir, "notes.txt"), "utf8"), "keep me");

assert.equal(result.scannedDateDirs, 2);
assert.deepEqual(result.deletedDateDirs, ["2026-01-01"]);
assert.ok(result.skipped.includes("2026-99-99"));
assert.ok(result.skipped.includes("notes.txt"));

await fs.rm(rootDir, { recursive: true, force: true });
console.log("test-log-retention passed");
