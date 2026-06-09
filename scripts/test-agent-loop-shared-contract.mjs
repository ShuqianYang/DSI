import assert from "node:assert/strict";
import fs from "node:fs/promises";

const frontendSource = await fs.readFile("src/lib/agentLoopEvents.ts", "utf8");
const apiSource = await fs.readFile("api/src/modules/agent-loop/types.ts", "utf8");
const sharedIndex = await fs.readFile("packages/shared/src/index.ts", "utf8");
const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));

assert.match(
  sharedIndex,
  /export \* from "\.\/types\/agent-loop\.js";/,
  "shared package should export the Agent Loop event contract"
);

assert.match(
  frontendSource,
  /from ['"]@datasourceintelligence\/shared['"]/,
  "frontend Agent Loop parser should use the shared event contract"
);
assert.doesNotMatch(
  frontendSource,
  /export interface AgentLoopEvent\b/,
  "frontend should not maintain a parallel AgentLoopEvent interface"
);

assert.match(
  apiSource,
  /from ['"]@datasourceintelligence\/shared['"]/,
  "API Agent Loop types should re-export the shared event contract"
);
assert.doesNotMatch(
  apiSource,
  /export type AgentLoopEvent\s*=/,
  "API should not maintain a second AgentLoopEvent union"
);

for (const scriptName of ["predev", "prebuild", "prets-check"]) {
  assert.match(
    packageJson.scripts?.[scriptName] ?? "",
    /@datasourceintelligence\/shared build/,
    `${scriptName} should build the shared package before frontend tooling consumes package exports`
  );
}

console.log("test-agent-loop-shared-contract passed");
