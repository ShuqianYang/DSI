import assert from "node:assert/strict";
import { getTableColumns, getTableName } from "drizzle-orm";

const { agentTranscriptEntries } = await import("../../src/db/schema.ts");

assert.ok(agentTranscriptEntries, "agentTranscriptEntries table should be exported");
assert.equal(getTableName(agentTranscriptEntries), "agent_transcript_entries");

const columns = getTableColumns(agentTranscriptEntries);
assert.deepEqual(Object.keys(columns).sort(), [
  "createdAt",
  "error",
  "finalAnswer",
  "id",
  "kind",
  "message",
  "messages",
  "metadata",
  "sequence",
  "stoppedBy",
  "taskId",
  "turn",
]);

assert.equal(columns.kind.enumValues.join(","), "model_request,assistant_message,tool_message,loop_stop");

console.log("transcript store shape test passed");
