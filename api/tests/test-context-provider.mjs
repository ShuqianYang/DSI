import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  defaultContextProvider,
  formatTaskProgressSection,
  formatTaskRequirementSection,
} from "../src/modules/agent-loop/contextProvider.ts";

function setEnv(name, value) {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  return () => {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  };
}

function makeToolUseContext(taskId, query) {
  return {
    taskId,
    query,
    messages: [],
    observations: [],
    options: { tools: [] },
    readFileState: new Map(),
    todoState: [],
    nestedMemoryAttachmentTriggers: new Set(),
    dynamicSkillDirTriggers: new Set(),
    discoveredSkillNames: new Set(),
    invokedSkillSections: [],
  };
}

const baseRoot = path.join(tmpdir(), `dsi-context-provider-test-${Date.now()}`);
const root = path.join(baseRoot, "workspace");
await rm(root, { recursive: true, force: true });
await mkdir(path.join(root, ".claude"), { recursive: true });
await writeFile(path.join(root, "AGENTS.md"), "# Agent Rules\nUse project vocabulary.\n", "utf8");
await writeFile(path.join(root, "CONTEXT.md"), "# Glossary\nTask = agent run.\n", "utf8");
await mkdir(path.join(root, "docs", "adr"), { recursive: true });
await writeFile(path.join(root, "docs", "adr", "0001-context-boundaries.md"), "# ADR 0001 Context Boundaries\nKeep provider boundaries explicit.\n", "utf8");
await writeFile(path.join(root, ".claude", "CLAUDE.md"), "# Local Claude\nPrefer concise replies.\n", "utf8");

const previousRoot = process.env.AGENT_WORKSPACE_ROOT;
process.env.AGENT_WORKSPACE_ROOT = root;

const input = {
  taskId: "task-test",
  query: "测试上下文",
  tools: [],
  toolUseContext: makeToolUseContext("task-test", "测试上下文"),
};

const userContext = await defaultContextProvider.getUserContext(input);
assert.match(userContext.currentDate, /Today's date is \d{4}-\d{2}-\d{2}/);
assert.equal(userContext.projectInstructions, undefined);

const sections = await defaultContextProvider.getContextSections(input);
assert.equal(sections.some((section) => section.id === "project.domain"), true);
assert.match(sections.find((section) => section.id === "project.domain").content, /Task = agent run/);
assert.equal(sections.some((section) => section.id === "project.adr_index"), true);
const adrIndex = sections.find((section) => section.id === "project.adr_index").content;
assert.match(adrIndex, /0001-context-boundaries\.md/);
assert.match(adrIndex, /ADR 0001 Context Boundaries/);

const systemContext = await defaultContextProvider.getSystemContext(input);
assert.equal(systemContext.workspaceRoot, root);
assert.equal(systemContext.taskStatus, undefined);
assert.equal(sections.some((section) => section.id === "task.requirements"), false);
assert.equal(sections.some((section) => section.id === "task.progress"), false);
const diagnosticsSection = sections.find((section) => section.id === "context_provider.diagnostics");
assert.ok(diagnosticsSection);
const diagnostics = JSON.parse(diagnosticsSection.content);
assert.equal(diagnostics.projectInstructionsEnabled, false);
assert.ok(diagnostics.loadedSections.includes("project.domain"));
assert.ok(diagnostics.loadedSections.includes("project.adr_index"));
assert.ok(Array.isArray(diagnostics.skippedSources));
assert.equal(diagnostics.estimateMethod, "chars");

const emptyRoot = path.join(baseRoot, "empty-workspace");
await rm(emptyRoot, { recursive: true, force: true });
await mkdir(emptyRoot, { recursive: true });
process.env.AGENT_WORKSPACE_ROOT = emptyRoot;
const emptyInput = {
  ...input,
  taskId: "missing-task",
  toolUseContext: makeToolUseContext("missing-task", "测试上下文"),
};
const emptyUserContext = await defaultContextProvider.getUserContext(emptyInput);
assert.equal(emptyUserContext.projectInstructions, undefined);
const emptySystemContext = await defaultContextProvider.getSystemContext(emptyInput);
assert.equal(emptySystemContext.gitStatus, undefined);
assert.equal(emptySystemContext.taskStatus, undefined);

const requirementSection = formatTaskRequirementSection({
  id: "task-1",
  status: "running",
  query: "Find project context",
  plan: [{ step: "Inspect files" }],
  actions: [{ type: "Read" }],
});
assert.equal(requirementSection.id, "task.requirements");
assert.match(requirementSection.content, /Find project context/);
assert.match(requirementSection.content, /Inspect files/);

const progressSection = formatTaskProgressSection([
  { id: "step-1", actionType: "Read", actionConfig: {}, status: "completed" },
  { id: "step-2", actionType: "Grep", actionConfig: {}, status: "failed", error: "pattern missing" },
]);
assert.equal(progressSection.id, "task.progress");
assert.match(progressSection.content, /"completed": 1/);
assert.match(progressSection.content, /"failed": 1/);
assert.match(progressSection.content, /pattern missing/);

if (previousRoot === undefined) {
  delete process.env.AGENT_WORKSPACE_ROOT;
} else {
  process.env.AGENT_WORKSPACE_ROOT = previousRoot;
}
await rm(root, { recursive: true, force: true });
await rm(emptyRoot, { recursive: true, force: true });
await rm(baseRoot, { recursive: true, force: true });
console.log("context provider test passed");
