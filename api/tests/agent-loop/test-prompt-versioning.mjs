import assert from "node:assert/strict";
import { z } from "zod";

const {
  buildPromptVersionMetadata,
  hashStableJson,
  previewText,
} = await import("../../src/modules/agent-loop/promptVersioning.ts");
const {
  DEFAULT_PROMPT_COMPONENT_VERSIONS,
  DEFAULT_PROMPT_VERSION,
} = await import("../../src/modules/agent-loop/promptManager.ts");

function makeTool(name, description, extra = {}) {
  return {
    name,
    description,
    kind: "domain",
    inputSchema: z.object({}),
    async execute() {
      return {};
    },
    ...extra,
  };
}

const baseSections = {
  contextSections: [
    { id: "project.database_description", content: "Database catalog text." },
    { id: "transcript.resume_context", content: JSON.stringify({ stoppedBy: "final_answer" }) },
  ],
  runtimeSections: [],
  memorySections: [],
  skillSections: [{ id: "skill.listing", content: "Skill list" }],
  rawMessages: [
    { role: "system", content: "system prompt" },
    { role: "user", content: "query" },
  ],
  preparedMessages: [
    { role: "system", content: "system prompt" },
    { role: "user", content: "query" },
  ],
};

const tools = [
  makeTool("RegionResolve", "Resolve named regions.", {
    aliases: ["region-resolve"],
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    maxResultSizeChars: 40000,
    requiresUserInteraction: false,
    riskLevel: "low",
  }),
  makeTool("RegionMark", "Mark GIS regions.", {
    aliases: ["region-mark"],
    maxResultSizeChars: 40000,
  }),
];

const metadata = buildPromptVersionMetadata({
  promptVersionMetadata: {
    promptVersion: DEFAULT_PROMPT_VERSION,
    componentVersions: DEFAULT_PROMPT_COMPONENT_VERSIONS,
  },
  tools,
  ...baseSections,
});

assert.equal(metadata.promptVersion, DEFAULT_PROMPT_VERSION);
assert.deepEqual(metadata.componentVersions, DEFAULT_PROMPT_COMPONENT_VERSIONS);
assert.equal(metadata.toolCatalog.count, 2);
assert.deepEqual(metadata.toolCatalog.names, ["RegionResolve", "RegionMark"]);
assert.match(metadata.toolCatalog.hash, /^sha256:[a-f0-9]{16}$/);
assert.equal(metadata.contextSections.count, 2);
assert.deepEqual(metadata.contextSections.ids, [
  "project.database_description",
  "transcript.resume_context",
]);
assert.equal(metadata.runtimeSections.count, 0);
assert.equal(metadata.memorySections.count, 0);
assert.equal(metadata.skillSections.count, 1);
assert.deepEqual(metadata.skillSections.ids, ["skill.listing"]);
assert.equal(metadata.messages.rawCount, 2);
assert.equal(metadata.messages.preparedCount, 2);
assert.match(metadata.messages.rawHash, /^sha256:[a-f0-9]{16}$/);
assert.match(metadata.messages.preparedHash, /^sha256:[a-f0-9]{16}$/);

const changedPreparedMessages = buildPromptVersionMetadata({
  promptVersionMetadata: {
    promptVersion: DEFAULT_PROMPT_VERSION,
    componentVersions: DEFAULT_PROMPT_COMPONENT_VERSIONS,
  },
  tools,
  ...baseSections,
  preparedMessages: [
    { role: "system", content: "system prompt with prepared-only context" },
    { role: "user", content: "query" },
  ],
});

assert.notEqual(changedPreparedMessages.messages.preparedHash, metadata.messages.preparedHash);
assert.equal(changedPreparedMessages.messages.rawHash, metadata.messages.rawHash);

const changedToolMetadata = buildPromptVersionMetadata({
  promptVersionMetadata: {
    promptVersion: DEFAULT_PROMPT_VERSION,
    componentVersions: DEFAULT_PROMPT_COMPONENT_VERSIONS,
  },
  tools: [
    makeTool("RegionResolve", "Resolve named regions.", {
      aliases: ["region-resolve"],
      isReadOnly: () => true,
      isDestructive: () => false,
      isConcurrencySafe: () => true,
      maxResultSizeChars: 40000,
      requiresUserInteraction: true,
      riskLevel: "low",
    }),
    makeTool("RegionMark", "Mark GIS regions.", {
      aliases: ["region-mark"],
      maxResultSizeChars: 40000,
    }),
  ],
  ...baseSections,
});

assert.notEqual(changedToolMetadata.toolCatalog.hash, metadata.toolCatalog.hash);

const sameMetadata = buildPromptVersionMetadata({
  promptVersionMetadata: {
    promptVersion: DEFAULT_PROMPT_VERSION,
    componentVersions: DEFAULT_PROMPT_COMPONENT_VERSIONS,
  },
  tools,
  ...baseSections,
});

assert.deepEqual(sameMetadata, metadata);
assert.notEqual(
  hashStableJson({ a: 1, b: 2 }),
  hashStableJson({ a: 1, b: 3 })
);

const unknownPromptMetadata = buildPromptVersionMetadata({
  tools,
  contextSections: [],
  runtimeSections: [],
  memorySections: [],
  skillSections: [],
  rawMessages: [],
  preparedMessages: [],
});

assert.equal(unknownPromptMetadata.promptVersion, "custom-prompt-manager/unknown");
assert.deepEqual(unknownPromptMetadata.componentVersions, {});

const defensiveMetadata = buildPromptVersionMetadata({
  tools: [makeTool("LooseTool", undefined)],
  contextSections: [{ id: "loose.section" }],
  runtimeSections: [],
  memorySections: [],
  skillSections: [],
  rawMessages: [{ role: "assistant" }],
  preparedMessages: [{ role: "assistant" }],
});

assert.match(defensiveMetadata.toolCatalog.hash, /^sha256:[a-f0-9]{16}$/);
assert.match(defensiveMetadata.contextSections.hash, /^sha256:[a-f0-9]{16}$/);
assert.match(defensiveMetadata.messages.rawHash, /^sha256:[a-f0-9]{16}$/);

assert.equal(previewText("hello", 0), "");
assert.equal(previewText("hello", 1), "h");
assert.equal(previewText("hello", 2), "he");
assert.equal(previewText("hello", 3), "...");
assert.equal(previewText("hello", 4), "h...");

console.log("prompt versioning test passed");
