import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultContextProvider } from "../src/modules/agent-loop/contextProvider.ts";

const baseRoot = path.join(tmpdir(), `dsi-context-provider-test-${Date.now()}`);
const root = path.join(baseRoot, "workspace");
await rm(root, { recursive: true, force: true });
await mkdir(path.join(root, ".claude"), { recursive: true });
await writeFile(path.join(root, "AGENTS.md"), "# Agent Rules\nUse project vocabulary.\n", "utf8");
await writeFile(path.join(root, "CONTEXT.md"), "# Glossary\nTask = agent run.\n", "utf8");
await writeFile(path.join(root, ".claude", "CLAUDE.md"), "# Local Claude\nPrefer concise replies.\n", "utf8");

const previousRoot = process.env.AGENT_WORKSPACE_ROOT;
process.env.AGENT_WORKSPACE_ROOT = root;

const input = {
  taskId: "task-test",
  query: "测试上下文",
  tools: [],
  toolUseContext: {
    taskId: "task-test",
    query: "测试上下文",
    messages: [],
    observations: [],
    options: { tools: [] },
    readFileState: new Map(),
    nestedMemoryAttachmentTriggers: new Set(),
    dynamicSkillDirTriggers: new Set(),
    discoveredSkillNames: new Set(),
  },
};

const userContext = await defaultContextProvider.getUserContext(input);
assert.match(userContext.currentDate, /Today's date is \d{4}-\d{2}-\d{2}/);
assert.match(userContext.projectInstructions, /AGENTS\.md/);
assert.match(userContext.projectInstructions, /Use project vocabulary/);
assert.match(userContext.projectInstructions, /\.claude\/CLAUDE\.md/);

const sections = await defaultContextProvider.getContextSections(input);
assert.equal(sections.some((section) => section.id === "project.domain"), true);
assert.match(sections.find((section) => section.id === "project.domain").content, /Task = agent run/);

const systemContext = await defaultContextProvider.getSystemContext(input);
assert.equal(systemContext.taskStatus, undefined);

const emptyRoot = path.join(baseRoot, "empty-workspace");
await rm(emptyRoot, { recursive: true, force: true });
await mkdir(emptyRoot, { recursive: true });
process.env.AGENT_WORKSPACE_ROOT = emptyRoot;
const emptyInput = {
  ...input,
  taskId: "missing-task",
  toolUseContext: { ...input.toolUseContext, taskId: "missing-task" },
};
const emptyUserContext = await defaultContextProvider.getUserContext(emptyInput);
assert.equal(emptyUserContext.projectInstructions, undefined);
const emptySystemContext = await defaultContextProvider.getSystemContext(emptyInput);
assert.equal(emptySystemContext.gitStatus, undefined);
assert.equal(emptySystemContext.taskStatus, undefined);

const longRoot = path.join(baseRoot, "long-workspace");
await rm(longRoot, { recursive: true, force: true });
await mkdir(longRoot, { recursive: true });
await writeFile(path.join(longRoot, "AGENTS.md"), "A".repeat(20_000), "utf8");
process.env.AGENT_WORKSPACE_ROOT = longRoot;
const longUserContext = await defaultContextProvider.getUserContext(input);
assert.match(longUserContext.projectInstructions, /\[truncated /);

if (previousRoot === undefined) {
  delete process.env.AGENT_WORKSPACE_ROOT;
} else {
  process.env.AGENT_WORKSPACE_ROOT = previousRoot;
}
await rm(root, { recursive: true, force: true });
await rm(emptyRoot, { recursive: true, force: true });
await rm(longRoot, { recursive: true, force: true });
await rm(baseRoot, { recursive: true, force: true });
console.log("context provider test passed");
