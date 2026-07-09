import assert from "node:assert/strict";

const { buildMemoryGovernanceSection } = await import(
  "../../src/modules/agent-loop/memoryGovernance.ts"
);

// ---------------------------------------------------------------------------
// Test 1: buildMemoryGovernanceSection returns a valid PromptSection
// ---------------------------------------------------------------------------

{
  const section = buildMemoryGovernanceSection();

  assert.ok(section, "section should be defined");
  assert.equal(typeof section.id, "string");
  assert.equal(section.id, "memory.governance");
  assert.equal(typeof section.content, "string");
  assert.ok(section.content.length > 0, "content should not be empty");

  console.log("Test 1 passed: buildMemoryGovernanceSection returns valid PromptSection");
}

// ---------------------------------------------------------------------------
// Test 2: content includes WHAT_TO_SAVE section
// ---------------------------------------------------------------------------

{
  const section = buildMemoryGovernanceSection();

  assert.ok(
    section.content.includes("应该保存为记忆的内容"),
    "should include WHAT_TO_SAVE heading"
  );
  assert.ok(
    section.content.includes("user 类型"),
    "should mention user type"
  );
  assert.ok(
    section.content.includes("episodic 类型"),
    "should mention episodic type"
  );

  console.log("Test 2 passed: content includes WHAT_TO_SAVE section");
}

// ---------------------------------------------------------------------------
// Test 3: content includes WHAT_NOT_TO_SAVE section
// ---------------------------------------------------------------------------

{
  const section = buildMemoryGovernanceSection();

  assert.ok(
    section.content.includes("不应该保存为记忆的内容"),
    "should include WHAT_NOT_TO_SAVE heading"
  );
  assert.ok(
    section.content.includes("实时数据"),
    "should mention real-time data"
  );
  assert.ok(
    section.content.includes("敏感凭证"),
    "should mention sensitive credentials"
  );

  console.log("Test 3 passed: content includes WHAT_NOT_TO_SAVE section");
}

// ---------------------------------------------------------------------------
// Test 4: content includes USAGE_RULES section
// ---------------------------------------------------------------------------

{
  const section = buildMemoryGovernanceSection();

  assert.ok(
    section.content.includes("使用记忆时的规则"),
    "should include USAGE_RULES heading"
  );
  assert.ok(
    section.content.includes("记忆是历史快照"),
    "should mention memory may be stale"
  );
  assert.ok(
    section.content.includes("信任当前观察"),
    "should mention trusting current observations"
  );
  assert.ok(
    section.content.includes("忽略记忆"),
    "should mention ignore-memory directive"
  );

  console.log("Test 4 passed: content includes USAGE_RULES section");
}

console.log("All memory-governance tests passed");
