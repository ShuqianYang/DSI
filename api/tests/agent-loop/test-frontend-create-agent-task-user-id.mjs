import assert from "node:assert/strict";

const { createAgentTask, AGENT_LOOP_FIXED_USER_ID } = await import(
  "../../../src/lib/api.ts"
);

let requestBody;
globalThis.fetch = async (_url, init) => {
  requestBody = JSON.parse(String(init.body));
  return {
    ok: true,
    async json() {
      return { taskId: "task-1", status: "pending" };
    },
  };
};

const result = await createAgentTask("北京明天会下雨吗");

assert.deepEqual(result, { taskId: "task-1", status: "pending" });
assert.equal(requestBody.query, "北京明天会下雨吗");
assert.equal(requestBody.userId, AGENT_LOOP_FIXED_USER_ID);
assert.equal(AGENT_LOOP_FIXED_USER_ID, "agent-loop-local-user");

console.log("frontend create agent task user id test passed");
