import assert from "node:assert/strict";

const {
  hasReferentialPatterns,
  buildRecentTaskContext,
  resolveQueryReferences,
} = await import("../../src/modules/agent-loop/referenceResolver.ts");

// ---------------------------------------------------------------------------
// Test 1: hasReferentialPatterns — 检测到指代表达式
// ---------------------------------------------------------------------------

{
  assert.equal(hasReferentialPatterns("上一轮说的地方"), true);
  assert.equal(hasReferentialPatterns("刚才提到的区域有船吗"), true);
  assert.equal(hasReferentialPatterns("那个地方现在怎么样了"), true);
  assert.equal(hasReferentialPatterns("之前那个位置"), true);
  assert.equal(hasReferentialPatterns("前面你说的船舶"), true);
  assert.equal(hasReferentialPatterns("上面提到的航班"), true);
  assert.equal(hasReferentialPatterns("刚刚聊到的那个飞机"), true);
  assert.equal(hasReferentialPatterns("这个区域有风场吗"), true);
  assert.equal(hasReferentialPatterns("这一轮说的区域"), false);

  console.log("Test 1 passed: hasReferentialPatterns detects referential expressions");
}

// ---------------------------------------------------------------------------
// Test 2: hasReferentialPatterns — 无指代表达式返回 false
// ---------------------------------------------------------------------------

{
  assert.equal(hasReferentialPatterns("查询台海的风场情况"), false);
  assert.equal(hasReferentialPatterns("今天天气怎么样"), false);
  assert.equal(hasReferentialPatterns("东海有哪些船舶"), false);
  assert.equal(hasReferentialPatterns("help me find ships"), false);
  assert.equal(hasReferentialPatterns(""), false);

  console.log("Test 2 passed: hasReferentialPatterns returns false for non-referential queries");
}

// ---------------------------------------------------------------------------
// Test 3: buildRecentTaskContext — 构建上下文字符串
// ---------------------------------------------------------------------------

{
  const context = buildRecentTaskContext([
    { query: "查询台海的风场" },
    { query: "东海有哪些船舶", summary: "东海区域有3艘货轮" },
  ]);

  assert.ok(context.includes("第1轮"));
  assert.ok(context.includes("查询台海的风场"));
  assert.ok(context.includes("第2轮"));
  assert.ok(context.includes("东海有哪些船舶"));
  assert.ok(context.includes("东海区域有3艘货轮"));

  console.log("Test 3 passed: buildRecentTaskContext builds context string correctly");
}

// ---------------------------------------------------------------------------
// Test 4: buildRecentTaskContext — 空列表返回空字符串
// ---------------------------------------------------------------------------

{
  assert.equal(buildRecentTaskContext([]), "");
  console.log("Test 4 passed: buildRecentTaskContext returns empty string for empty list");
}

// ---------------------------------------------------------------------------
// Test 5: resolveQueryReferences — 无指代、直接返回原始 query（零延迟路径）
// ---------------------------------------------------------------------------

{
  const result = await resolveQueryReferences({
    query: "查询台海的风场",
    recentTaskContext: "[第1轮]\n用户查询: 查询台海的风场\n回答摘要: 台海区域风场已获取",
  });

  assert.equal(result.resolvedQuery, "查询台海的风场");
  assert.equal(result.wasResolved, false);
  console.log("Test 5 passed: resolveQueryReferences skips when no referential patterns");
}

// ---------------------------------------------------------------------------
// Test 6: resolveQueryReferences — 空上下文时返回原始 query
// ---------------------------------------------------------------------------

{
  const result = await resolveQueryReferences({
    query: "上一轮说的地方",
    recentTaskContext: "",
  });

  assert.equal(result.resolvedQuery, "上一轮说的地方");
  assert.equal(result.wasResolved, false);
  console.log("Test 6 passed: resolveQueryReferences skips when context is empty");
}

// ---------------------------------------------------------------------------
// Test 7: resolveQueryReferences — 空查询时返回原始 query
// ---------------------------------------------------------------------------

{
  const result = await resolveQueryReferences({
    query: "",
    recentTaskContext: "some context",
  });

  assert.equal(result.resolvedQuery, "");
  assert.equal(result.wasResolved, false);
  console.log("Test 7 passed: resolveQueryReferences skips when query is empty");
}

// ---------------------------------------------------------------------------
// Test 8: resolveQueryReferences — 统一模型客户端完成指代消解
// ---------------------------------------------------------------------------

{
  const calls = [];
  const result = await resolveQueryReferences({
    query: "上一轮说的地方现在有船吗",
    recentTaskContext: "[第1轮]\n用户查询: 查询台海风场",
  }, {
    modelClient: {
      async generateText(messages, options) {
        calls.push({ messages, options });
        return "台海现在有船吗";
      },
    },
  });

  assert.equal(result.resolvedQuery, "台海现在有船吗");
  assert.equal(result.wasResolved, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.temperature, 0);
  assert.equal(calls[0].options.maxTokens, 500);
  console.log("Test 8 passed: resolveQueryReferences uses the unified model client");
}

// ---------------------------------------------------------------------------
// Test 9: resolveQueryReferences — 统一模型配置不可用时降级
// ---------------------------------------------------------------------------

{
  const result = await resolveQueryReferences({
      query: "上一轮说的地方现在有船吗",
      recentTaskContext: "[第1轮]\n用户查询: 查询台海风场",
    }, {
      modelClient: {
        async generateText() {
          throw new Error("model unavailable");
        },
      },
    });

  assert.equal(result.resolvedQuery, "上一轮说的地方现在有船吗");
  assert.equal(result.wasResolved, false);
  console.log("Test 9 passed: resolveQueryReferences falls back when model resolution fails");
}

console.log("\nAll reference resolver tests passed!");
