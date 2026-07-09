import assert from "node:assert/strict";

const { createEmbeddingClient } = await import(
  "../../src/modules/agent-loop/embeddingClient.ts"
);

// ---------------------------------------------------------------------------
// Mock fetch helper
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

function mockFetch(responseBody, status = 200) {
  globalThis.fetch = async (_url, _init) => {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(responseBody),
      json: async () => responseBody,
    };
  };
}

function mockFetchError(error) {
  globalThis.fetch = async () => {
    throw error;
  };
}

// ---------------------------------------------------------------------------
// Test 1: Normal call returns 1536-dim vector
// ---------------------------------------------------------------------------

{
  const fakeEmbedding = Array.from({ length: 1536 }, (_, i) => i * 0.001);
  mockFetch({
    data: [{ index: 0, embedding: fakeEmbedding }],
  });

  const client = createEmbeddingClient({
    apiBase: "http://localhost:8000/v1",
    apiKey: "test-key",
    model: "gte-Qwen2-1.5B",
  });

  assert.ok(client, "client should be defined when apiBase is set");

  const embedding = await client.embed("测试文本");
  assert.equal(embedding.length, 1536);
  assert.ok(Array.isArray(embedding));
  assert.equal(embedding[0], 0);

  console.log("Test 1 passed: normal call returns 1536-dim vector");
}

// ---------------------------------------------------------------------------
// Test 2: GTE_API_BASE not set → returns undefined (degraded mode)
// ---------------------------------------------------------------------------

{
  // Temporarily clear env
  const savedBase = process.env.GTE_API_BASE;
  delete process.env.GTE_API_BASE;

  const client = createEmbeddingClient({});
  assert.equal(client, undefined, "should return undefined when GTE_API_BASE not set");

  // Restore
  if (savedBase) process.env.GTE_API_BASE = savedBase;

  console.log("Test 2 passed: GTE_API_BASE not set returns undefined");
}

// ---------------------------------------------------------------------------
// Test 3: API error throws exception
// ---------------------------------------------------------------------------

{
  mockFetch({ error: "internal error" }, 500);

  const client = createEmbeddingClient({
    apiBase: "http://localhost:8000/v1",
  });

  await assert.rejects(
    async () => client.embed("test"),
    /Embedding API error: 500/
  );

  console.log("Test 3 passed: API error throws exception");
}

// ---------------------------------------------------------------------------
// Test 4: Network error throws exception
// ---------------------------------------------------------------------------

{
  mockFetchError(new Error("ECONNREFUSED"));

  const client = createEmbeddingClient({
    apiBase: "http://localhost:8000/v1",
  });

  await assert.rejects(
    async () => client.embed("test"),
    /ECONNREFUSED/
  );

  console.log("Test 4 passed: network error throws exception");
}

// ---------------------------------------------------------------------------
// Test 5: embedBatch handles multiple texts
// ---------------------------------------------------------------------------

{
  const emb1 = Array.from({ length: 1536 }, (_, i) => i * 0.001);
  const emb2 = Array.from({ length: 1536 }, (_, i) => i * 0.002);
  mockFetch({
    data: [
      { index: 0, embedding: emb1 },
      { index: 1, embedding: emb2 },
    ],
  });

  const client = createEmbeddingClient({
    apiBase: "http://localhost:8000/v1",
  });

  const results = await client.embedBatch(["text1", "text2"]);
  assert.equal(results.length, 2);
  assert.equal(results[0].length, 1536);
  assert.equal(results[1].length, 1536);

  console.log("Test 5 passed: embedBatch handles multiple texts");
}

// ---------------------------------------------------------------------------
// Test 6: embedBatch with empty array returns empty
// ---------------------------------------------------------------------------

{
  const client = createEmbeddingClient({
    apiBase: "http://localhost:8000/v1",
  });

  const results = await client.embedBatch([]);
  assert.equal(results.length, 0);

  console.log("Test 6 passed: embedBatch with empty array returns empty");
}

// Restore original fetch
globalThis.fetch = originalFetch;

console.log("All embedding-client tests passed");
