import assert from "node:assert/strict";
import { z } from "zod";

process.env.NODE_ENV = "test";

const {
  ModelConfigError,
  ModelAuthenticationError,
  ModelRateLimitError,
  ModelResponseParseError,
  ModelTimeoutError,
  createModelGateway,
  loadModelConfig,
  normalizeOpenAIResponse,
} = await import("../../src/modules/agent-loop/model/index.ts");
const { createModelClient } = await import("../../src/modules/agent-loop/modelClient.ts");
const { loadVisionModelConfig } = await import(
  "../../src/modules/agent-loop/tools/domain/satellite/imageAnalysis.ts"
);

function env(overrides = {}) {
  return {
    MODEL_PROVIDER: "openai-compatible",
    MODEL_API_URL: "http://127.0.0.1:8000/v1/chat/completions",
    MODEL_NAME: "test-model",
    MODEL_AUTH_TYPE: "none",
    MODEL_RETRY_COUNT: "0",
    ...overrides,
  };
}

function config(overrides = {}) {
  return { ...loadModelConfig("AGENT", env()), ...overrides };
}

// Retry callbacks expose visible progress without changing gateway retry semantics.
{
  let calls = 0;
  const retries = [];
  const gateway = createModelGateway(config({ retryCount: 1, retryBaseDelayMs: 1 }), {
    provider: {
      async generate() {
        calls += 1;
        if (calls === 1) throw new TypeError("temporary network failure");
        return { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] };
      },
    },
  });
  const response = await gateway.generate({ messages: [], purpose: "text-generation" }, {
    onRetry: (event) => retries.push(event),
  });
  assert.equal(response.content, "ok");
  assert.equal(calls, 2);
  assert.equal(retries.length, 1);
  assert.equal(retries[0].nextAttempt, 2);
  assert.equal(retries[0].maxAttempts, 2);
}

// Role-specific values override global values field by field.
{
  const cfg = loadModelConfig("AGENT", env({
    MODEL_NAME: "global-model",
    MODEL_TIMEOUT_MS: "4321",
    AGENT_MODEL_NAME: "agent-model",
  }));
  assert.equal(cfg.model, "agent-model");
  assert.equal(cfg.timeoutMs, 4321);
  assert.equal(cfg.authType, "none");
}

// Legacy Qwen configuration remains supported and takes priority over DeepSeek fallback.
{
  const cfg = loadModelConfig("AGENT", {
    QWEN_API_URL: "http://127.0.0.1:9000/v1/chat/completions",
    QWEN_MODEL: "qwen-legacy",
    DEEPSEEK_MODEL: "deepseek-legacy",
  });
  assert.equal(cfg.apiUrl, "http://127.0.0.1:9000/v1/chat/completions");
  assert.equal(cfg.model, "qwen-legacy");
  assert.equal(cfg.authType, "none");
}

// Remote bearer endpoints fail before a network request when the key is missing.
assert.throws(
  () => loadModelConfig("AGENT", {
    MODEL_API_URL: "https://example.com/v1/chat/completions",
    MODEL_AUTH_TYPE: "bearer",
    MODEL_NAME: "remote-model",
  }),
  ModelConfigError
);

// No language model is selected implicitly.
assert.throws(
  () => loadModelConfig("AGENT", {
    MODEL_API_URL: "http://127.0.0.1:8000/v1/chat/completions",
    MODEL_AUTH_TYPE: "none",
  }),
  (error) => error instanceof ModelConfigError && error.message.includes("MODEL_NAME")
);

// Vision model selection is independent from the language-model QWEN_MODEL fallback.
{
  const cfg = loadVisionModelConfig({
    QWEN_MODEL: "language-model-must-not-leak",
    VISION_MODEL_NAME: "dedicated-vision-model",
    VISION_MODEL_API_URL: "http://127.0.0.1:9001/v1/chat/completions",
  });
  assert.equal(cfg.model, "dedicated-vision-model");
  assert.equal(cfg.apiUrl, "http://127.0.0.1:9001/v1/chat/completions");

  const withoutVisionName = loadVisionModelConfig({ QWEN_MODEL: "language-only" });
  assert.equal(withoutVisionName.model, "");
}

// Structured reasoning is separated from final content.
{
  const result = normalizeOpenAIResponse({
    id: "response-1",
    model: "deepseek-test",
    choices: [{
      finish_reason: "stop",
      message: { reasoning_content: "internal reasoning", content: "final answer" },
    }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 7,
      total_tokens: 17,
      completion_tokens_details: { reasoning_tokens: 3 },
    },
  }, config());
  assert.equal(result.reasoning, "internal reasoning");
  assert.equal(result.reasoningSource, "field");
  assert.equal(result.content, "final answer");
  assert.equal(result.usage?.reasoningTokens, 3);
}

// Alternative structured reasoning and analysis tags use the same normalized fields.
{
  const structured = normalizeOpenAIResponse({
    choices: [{ message: { reasoning: "reasoning field", content: "answer" }, finish_reason: "stop" }],
  }, config());
  assert.equal(structured.reasoning, "reasoning field");
  assert.equal(structured.content, "answer");

  const analysisTag = normalizeOpenAIResponse({
    choices: [{ message: { content: "<analysis>analysis body</analysis>visible" }, finish_reason: "stop" }],
  }, config());
  assert.equal(analysisTag.reasoning, "analysis body");
  assert.equal(analysisTag.reasoningSource, "analysis_tag");
  assert.equal(analysisTag.content, "visible");
  assert.equal(analysisTag.usage, undefined);
}

// Complete think tags are removed; incomplete tags are preserved with a warning.
{
  const complete = normalizeOpenAIResponse({
    choices: [{ message: { content: "<think>reason</think>answer" }, finish_reason: "stop" }],
  }, config());
  assert.equal(complete.reasoning, "reason");
  assert.equal(complete.content, "answer");

  const incomplete = normalizeOpenAIResponse({
    choices: [{ message: { content: "<think>unfinished reasoning" }, finish_reason: "stop" }],
  }, config());
  assert.equal(incomplete.content, "<think>unfinished reasoning");
  assert.ok(incomplete.metadata?.warnings?.some((warning) => warning.includes("Unclosed")));
}

// Native tool calls accept string and object arguments and generate stable IDs.
{
  const result = normalizeOpenAIResponse({
    choices: [{
      finish_reason: "tool_calls",
      message: {
        content: null,
        tool_calls: [
          { id: "call-1", function: { name: "Read", arguments: "{\"path\":\"a.txt\"}" } },
          { function: { name: "Search", arguments: { query: "alarm" } } },
        ],
      },
    }],
  }, config(), "turn-7");
  assert.deepEqual(result.toolCalls[0], {
    id: "call-1",
    toolName: "Read",
    input: { path: "a.txt" },
  });
  assert.equal(result.toolCalls[1].id, "turn-7-2");
  assert.deepEqual(result.toolCalls[1].input, { query: "alarm" });
}

assert.throws(
  () => normalizeOpenAIResponse({
    choices: [{ message: { tool_calls: [{ function: { name: "Read", arguments: "not-json" } }] } }],
  }, config()),
  ModelResponseParseError
);

assert.throws(
  () => normalizeOpenAIResponse({
    choices: [{ message: { tool_calls: [{ function: { name: "Read", arguments: [] } }] } }],
  }, config()),
  ModelResponseParseError
);

assert.throws(
  () => normalizeOpenAIResponse({
    choices: [{ message: { content: "" }, finish_reason: "stop" }],
  }, config()),
  ModelResponseParseError
);

// JSON decision mode reuses the existing Agent Loop decision contract.
{
  const result = normalizeOpenAIResponse({
    choices: [{
      finish_reason: "stop",
      message: {
        content: "```json\n{\"type\":\"tool_call\",\"toolName\":\"Read\",\"input\":{\"path\":\"x.txt\"}}\n```",
      },
    }],
  }, config({ toolCallMode: "json" }), "json-call");
  assert.equal(result.toolCalls[0].toolName, "Read");
  assert.deepEqual(result.toolCalls[0].input, { path: "x.txt" });
}

// Gateway sends OpenAI-compatible requests and normalizes the response without real network access.
{
  let captured;
  const gateway = createModelGateway(config(), {
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init, body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({
        id: "mock-response",
        choices: [{ message: { content: "mock answer" }, finish_reason: "stop" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const result = await gateway.generate({
    purpose: "text-generation",
    messages: [{ role: "user", content: "hello" }],
  });
  assert.equal(result.content, "mock answer");
  assert.equal(captured.url, "http://127.0.0.1:8000/v1/chat/completions");
  assert.equal(captured.body.model, "test-model");
  assert.equal(captured.body.stream, false);
}

// Retryable 503 responses are retried up to the configured limit.
{
  let calls = 0;
  const gateway = createModelGateway(config({ retryCount: 1, retryBaseDelayMs: 1 }), {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response("temporarily unavailable", { status: 503 });
      return new Response(JSON.stringify({
        choices: [{ message: { content: "recovered" }, finish_reason: "stop" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const result = await gateway.generate({
    purpose: "text-generation",
    messages: [{ role: "user", content: "retry" }],
  });
  assert.equal(result.content, "recovered");
  assert.equal(calls, 2);
}

// HTTP authentication and rate-limit responses map to stable error types.
{
  const authGateway = createModelGateway(config(), {
    fetchImpl: async () => new Response("unauthorized", { status: 401 }),
  });
  await assert.rejects(
    authGateway.generate({ purpose: "text-generation", messages: [{ role: "user", content: "auth" }] }),
    ModelAuthenticationError
  );

  const rateLimitGateway = createModelGateway(config(), {
    fetchImpl: async () => new Response("slow down", { status: 429 }),
  });
  await assert.rejects(
    rateLimitGateway.generate({ purpose: "text-generation", messages: [{ role: "user", content: "rate" }] }),
    ModelRateLimitError
  );
}

// Gateway timeout aborts an in-flight transport and surfaces a typed error.
{
  const gateway = createModelGateway(config({ timeoutMs: 5 }), {
    fetchImpl: async (_url, init) => await new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }),
  });
  await assert.rejects(
    gateway.generate({
      purpose: "text-generation",
      messages: [{ role: "user", content: "timeout" }],
    }),
    ModelTimeoutError
  );
}

// The legacy modelClient facade keeps the Agent Loop contract and converts Zod tool schemas.
{
  const keys = [
    "AGENT_MODEL_API_URL",
    "AGENT_MODEL_NAME",
    "AGENT_MODEL_AUTH_TYPE",
    "AGENT_MODEL_RETRY_COUNT",
  ];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.AGENT_MODEL_API_URL = "http://127.0.0.1:8000/v1/chat/completions";
  process.env.AGENT_MODEL_NAME = "facade-model";
  process.env.AGENT_MODEL_AUTH_TYPE = "none";
  process.env.AGENT_MODEL_RETRY_COUNT = "0";

  let requestBody;
  try {
    const client = createModelClient({
      fetchImpl: async (_url, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{
                id: "facade-call",
                function: { name: "Lookup", arguments: "{\"id\":7}" },
              }],
            },
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });
    const decision = await client.decide({
      messages: [{ role: "user", content: "lookup 7" }],
      tools: [{
        name: "Lookup",
        description: "Look up one item",
        inputSchema: z.object({ id: z.number() }),
        async execute() { return {}; },
      }],
      query: "lookup 7",
      observations: [],
      callId: "facade-turn",
    });
    assert.equal(decision.type, "tool_calls");
    assert.deepEqual(decision.toolCalls[0].input, { id: 7 });
    assert.equal(requestBody.tools[0].function.parameters.type, "object");
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

console.log("model adapter phase-one tests passed");
