import assert from "node:assert/strict";

process.env.AGENT_MODEL_PROVIDER = "openai-compatible";
process.env.AGENT_MODEL_API_URL = "http://localhost:8000/v1/chat/completions";
process.env.AGENT_MODEL_NAME = "episode-extractor-test";
process.env.AGENT_MODEL_AUTH_TYPE = "none";
process.env.AGENT_MODEL_RETRY_COUNT = "0";

const { createEpisodeExtractor } = await import(
  "../../src/modules/agent-loop/episodeExtractor.ts"
);

// ---------------------------------------------------------------------------
// Mock fetch helper
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

function mockChatCompletion(content) {
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const isRetry = body.messages?.[0]?.content?.includes("请只输出JSON，不要输出任何其他内容。");
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content }),
      json: async () => ({
        choices: [
          {
            message: { content },
          },
        ],
      }),
    };
  };
}

function mockChatCompletionSequence(responses) {
  let callIndex = 0;
  globalThis.fetch = async (_url, _init) => {
    const content = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content }),
      json: async () => ({
        choices: [{ message: { content } }],
      }),
    };
  };
}

function mockChatError(status = 500) {
  globalThis.fetch = async () => ({
    ok: false,
    status,
    text: async () => "Internal Server Error",
    json: async () => ({ error: "server error" }),
  });
}

function mockNetworkError() {
  globalThis.fetch = async () => {
    throw new Error("ECONNREFUSED");
  };
}

// ---------------------------------------------------------------------------
// Test input factory
// ---------------------------------------------------------------------------

function createTestInput(overrides = {}) {
  return {
    query: "评估台湾花莲7.2级地震的影响",
    finalAnswer: "花莲7.2级地震，影响半径50km，建议启动二级应急响应",
    result: {
      finalAnswer: "花莲7.2级地震，影响半径50km，建议启动二级应急响应",
      turns: 2,
      observations: [
        {
          toolCallId: "call-1",
          toolName: "EarthquakeAssessment",
          ok: true,
          output: { magnitude: 7.2, location: "花莲", impactRadius: 50 },
        },
      ],
      stoppedBy: "final_answer",
    },
    messages: [
      { role: "user", content: "评估台湾花莲7.2级地震的影响" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-1",
            toolName: "EarthquakeAssessment",
            input: { magnitude: 7.2, location: "花莲" },
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "call-1",
        toolName: "EarthquakeAssessment",
        content: JSON.stringify({ magnitude: 7.2, location: "花莲", impactRadius: 50 }),
      },
      { role: "assistant", content: "花莲7.2级地震，影响半径50km，建议启动二级应急响应" },
    ],
    observations: [
      {
        toolCallId: "call-1",
        toolName: "EarthquakeAssessment",
        ok: true,
        output: { magnitude: 7.2, location: "花莲", impactRadius: 50 },
      },
    ],
    toolUseContext: {
      taskId: "test-task-1",
      query: "评估台湾花莲7.2级地震的影响",
      messages: [],
      observations: [],
      options: { tools: [] },
      readFileState: new Map(),
      todoState: [],
      nestedMemoryAttachmentTriggers: new Set(),
      dynamicSkillDirTriggers: new Set(),
      discoveredSkillNames: new Set(),
      invokedSkillSections: [],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 1: LLM returns valid JSON → correctly parsed
// ---------------------------------------------------------------------------

{
  const validJson = JSON.stringify({
    scene: "地震评估",
    userQuery: "评估台湾花莲7.2级地震的影响",
    toolSequence: [
      {
        toolName: "EarthquakeAssessment",
        inputParams: { magnitude: 7.2, location: "花莲" },
        outputSummary: "震中位于花莲以东30km，影响半径50km",
        success: true,
      },
    ],
    finalResult: "花莲7.2级地震，影响半径50km，建议启动二级应急响应",
    importance: 0.9,
    tags: ["地震", "花莲", "应急响应"],
    relatedEntities: ["花莲", "台湾"],
  });
  mockChatCompletion(validJson);

  const extractor = createEpisodeExtractor();
  assert.ok(extractor, "extractor should be defined");

  const episode = await extractor.extract(createTestInput());

  assert.equal(episode.scene, "地震评估");
  assert.equal(episode.userQuery, "评估台湾花莲7.2级地震的影响");
  assert.equal(episode.toolSequence.length, 1);
  assert.equal(episode.toolSequence[0].toolName, "EarthquakeAssessment");
  assert.equal(episode.toolSequence[0].success, true);
  assert.equal(episode.importance, 0.9);
  assert.deepEqual(episode.tags, ["地震", "花莲", "应急响应"]);
  assert.deepEqual(episode.relatedEntities, ["花莲", "台湾"]);

  console.log("Test 1 passed: LLM returns valid JSON → correctly parsed");
}

// ---------------------------------------------------------------------------
// Test 2: LLM returns invalid JSON on first try → retry succeeds
// ---------------------------------------------------------------------------

{
  mockChatCompletionSequence([
    "This is not JSON at all",
    JSON.stringify({
      scene: "溢油溯源",
      userQuery: "追踪东海海域溢油源头",
      toolSequence: [],
      finalResult: "溢油源头疑为油轮",
      importance: 0.8,
      tags: ["溢油"],
      relatedEntities: ["东海"],
    }),
  ]);

  const warnings = [];
  const extractor = createEpisodeExtractor({
    logger: { warn: (...args) => warnings.push(args) },
  });

  const episode = await extractor.extract(createTestInput());

  assert.equal(episode.scene, "溢油溯源");
  assert.equal(episode.importance, 0.8);
  // Should have logged a warning about first attempt failure
  assert.ok(warnings.length >= 1, "should warn about first attempt failure");

  console.log("Test 2 passed: LLM returns invalid JSON → retry succeeds");
}

// ---------------------------------------------------------------------------
// Test 3: Both attempts fail → rule-based fallback
// ---------------------------------------------------------------------------

{
  mockChatCompletionSequence([
    "not json",
    "still not json",
  ]);

  const warnings = [];
  const extractor = createEpisodeExtractor({
    logger: { warn: (...args) => warnings.push(args) },
  });

  const episode = await extractor.extract(createTestInput());

  // Fallback values
  assert.equal(episode.scene, "日常监测");
  assert.equal(episode.importance, 0.5);
  assert.deepEqual(episode.tags, []);
  assert.deepEqual(episode.relatedEntities, []);
  // Should have toolSequence from observations
  assert.equal(episode.toolSequence.length, 1);
  assert.equal(episode.toolSequence[0].toolName, "EarthquakeAssessment");
  assert.equal(episode.toolSequence[0].success, true);

  console.log("Test 3 passed: both attempts fail → rule-based fallback");
}

// ---------------------------------------------------------------------------
// Test 4: Fallback result contains correct userQuery and finalResult
// ---------------------------------------------------------------------------

{
  mockNetworkError();

  const extractor = createEpisodeExtractor({
    logger: { warn: () => {} },
  });

  const input = createTestInput({
    query: "追踪东海海域溢油源头",
    finalAnswer: "溢油源头疑为油轮MMSI:412000001，建议进一步核查",
  });
  const episode = await extractor.extract(input);

  assert.equal(episode.userQuery, "追踪东海海域溢油源头");
  assert.ok(
    episode.finalResult.includes("溢油源头疑为油轮"),
    "finalResult should contain the answer text"
  );

  console.log("Test 4 passed: fallback contains correct userQuery and finalResult");
}

// ---------------------------------------------------------------------------
// Test 5: LLM returns JSON wrapped in ```json code block
// ---------------------------------------------------------------------------

{
  const validJson = JSON.stringify({
    scene: "船舶追踪",
    userQuery: "追踪MMSI:412000001的位置",
    toolSequence: [],
    finalResult: "船舶位于28.5N 122.3E",
    importance: 0.7,
    tags: ["船舶"],
    relatedEntities: ["MMSI:412000001"],
  });

  // Wrap in code block
  const wrappedContent = "```json\n" + validJson + "\n```";
  mockChatCompletion(wrappedContent);

  const extractor = createEpisodeExtractor();

  const episode = await extractor.extract(createTestInput());

  assert.equal(episode.scene, "船舶追踪");
  assert.equal(episode.importance, 0.7);

  console.log("Test 5 passed: LLM returns JSON in code block → correctly parsed");
}

// Restore original fetch
globalThis.fetch = originalFetch;

console.log("All episode-extractor tests passed");
