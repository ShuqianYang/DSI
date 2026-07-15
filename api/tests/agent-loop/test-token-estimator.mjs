import assert from "node:assert/strict";

const { estimateMessagesTokens } = await import(
  "../../src/modules/agent-loop/tokenEstimator.ts"
);

// ---------------------------------------------------------------------------
// Test 1: Empty messages list returns 0 tokens
// ---------------------------------------------------------------------------

{
  const result = estimateMessagesTokens([]);

  assert.ok(result.totalTokens <= 1, "totalTokens should be 0 or 1 for empty list (JSON overhead)");
  assert.equal(result.messageCount, 0);
  assert.equal(result.charCount, 2); // JSON.stringify([]) === "[]"

  console.log("Test 1 passed: empty messages returns 0 tokens");
}

// ---------------------------------------------------------------------------
// Test 2: Known messages return reasonable token estimate
// ---------------------------------------------------------------------------

{
  const messages = [
    { role: "user", content: "Hello, how are you?" },
    { role: "assistant", content: "I'm fine, thank you!" },
  ];

  const result = estimateMessagesTokens(messages);

  assert.ok(result.totalTokens > 0, "should have positive token count");
  assert.equal(result.messageCount, 2);
  assert.ok(result.charCount > 0, "should have positive char count");

  // The JSON string of these messages is roughly 80-100 chars
  // With latin chars / 4, that's roughly 20-25 tokens
  assert.ok(result.totalTokens >= 10, "token estimate should be at least 10");
  assert.ok(result.totalTokens <= 100, "token estimate should be reasonable (< 100)");

  console.log("Test 2 passed: known messages return reasonable token estimate");
}

// ---------------------------------------------------------------------------
// Test 3: Token estimate is consistent with char/4 approach for ASCII
// ---------------------------------------------------------------------------

{
  // Pure ASCII message — token estimate should be ceil(charCount / 4)
  const text = "abcdefghijklmnopqrstuvwxyz0123456789"; // 36 chars
  const messages = [{ role: "user", content: text }];

  const result = estimateMessagesTokens(messages);

  // JSON.stringify adds overhead: [{"role":"user","content":"abcdefghijklmnopqrstuvwxyz0123456789"}]
  // The JSON string is longer than just the text
  // But for pure ASCII, token estimate = ceil(jsonChars / 4)
  const expectedTokens = Math.ceil(result.charCount / 4);
  assert.equal(
    result.totalTokens,
    expectedTokens,
    "for pure ASCII, token estimate should be ceil(charCount / 4)"
  );

  console.log("Test 3 passed: token estimate = ceil(charCount / 4) for ASCII");
}

// ---------------------------------------------------------------------------
// Test 4: CJK characters get higher token weight (* 1.8)
// ---------------------------------------------------------------------------

{
  const cjkMessages = [{ role: "user", content: "台湾海峡风场数据" }];
  const asciiMessages = [{ role: "user", content: "abcdefghij" }]; // 10 chars

  const cjkResult = estimateMessagesTokens(cjkMessages);
  const asciiResult = estimateMessagesTokens(asciiMessages);

  // CJK chars should have higher token weight than ASCII chars
  // Even though both messages have similar content lengths,
  // the CJK message should have more tokens per char
  const cjkTokensPerChar = cjkResult.totalTokens / cjkResult.charCount;
  const asciiTokensPerChar = asciiResult.totalTokens / asciiResult.charCount;

  assert.ok(
    cjkTokensPerChar > asciiTokensPerChar,
    `CJK tokens/char (${cjkTokensPerChar.toFixed(3)}) should be higher than ASCII (${asciiTokensPerChar.toFixed(3)})`
  );

  console.log("Test 4 passed: CJK characters get higher token weight");
}

// ---------------------------------------------------------------------------
// Test 5: Multiple messages accumulate correctly
// ---------------------------------------------------------------------------

{
  const messages = [
    { role: "user", content: "查询天气" },
    { role: "assistant", content: "", toolCalls: [{ id: "call-1", toolName: "Weather", input: {} }] },
    { role: "tool", toolCallId: "call-1", toolName: "Weather", content: '{"temp":25}' },
    { role: "assistant", content: "当前温度25度" },
  ];

  const result = estimateMessagesTokens(messages);

  assert.equal(result.messageCount, 4);
  assert.ok(result.totalTokens > 0);
  assert.ok(result.charCount > 100, "should have substantial char count with 4 messages");

  console.log("Test 5 passed: multiple messages accumulate correctly");
}

console.log("All token-estimator tests passed");
