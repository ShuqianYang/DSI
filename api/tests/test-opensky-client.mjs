import assert from "node:assert/strict";
import { fetchStates, getToken, getOpenSkyRequestTimeoutMs } from "../src/modules/opensky/client.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const originalFetch = globalThis.fetch;
const originalClientId = process.env.OPENSKY_CLIENT_ID;
const originalClientSecret = process.env.OPENSKY_CLIENT_SECRET;
const originalTimeout = process.env.OPENSKY_REQUEST_TIMEOUT_MS;

try {
  process.env.OPENSKY_CLIENT_ID = "test-client";
  process.env.OPENSKY_CLIENT_SECRET = "test-secret";
  process.env.OPENSKY_REQUEST_TIMEOUT_MS = "1234";

  assert.equal(getOpenSkyRequestTimeoutMs(), 1234);

  let tokenFetchSignal;
  globalThis.fetch = async (_url, init) => {
    tokenFetchSignal = init?.signal;
    return jsonResponse({ access_token: "token-123" });
  };

  assert.equal(await getToken(), "token-123");
  assert(tokenFetchSignal instanceof AbortSignal, "getToken should pass an AbortSignal timeout");

  let statesFetchSignal;
  globalThis.fetch = async (_url, init) => {
    statesFetchSignal = init?.signal;
    return jsonResponse({ time: 1_710_000_000, states: [["abc123"]] });
  };

  const states = await fetchStates("token-123");
  assert.equal(states.time, 1_710_000_000);
  assert.equal(states.states.length, 1);
  assert(statesFetchSignal instanceof AbortSignal, "fetchStates should pass an AbortSignal timeout");
} finally {
  globalThis.fetch = originalFetch;
  restoreEnv("OPENSKY_CLIENT_ID", originalClientId);
  restoreEnv("OPENSKY_CLIENT_SECRET", originalClientSecret);
  restoreEnv("OPENSKY_REQUEST_TIMEOUT_MS", originalTimeout);
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

console.log("opensky client test passed");
