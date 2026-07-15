import assert from "node:assert/strict";
import crypto from "node:crypto";

const { extractRequestMetadata } = await import(
  "../../src/modules/observability/requestMetadata.ts"
);

const receivedAt = new Date("2026-07-03T00:00:00.000Z");

const forwardedReq = {
  method: "POST",
  originalUrl: "/tasks?source=chat",
  path: "/tasks",
  ip: "10.0.0.9",
  headers: {
    "x-request-id": "req-123",
    "x-forwarded-for": "203.0.113.42, 198.51.100.7",
    "user-agent": "agent-test/1.0",
  },
};

const forwardedMetadata = extractRequestMetadata(forwardedReq, receivedAt);

assert.equal(forwardedMetadata.requestId, "req-123");
assert.equal(forwardedMetadata.method, "POST");
assert.equal(forwardedMetadata.path, "/tasks?source=chat");
assert.equal(forwardedMetadata.userAgent, "agent-test/1.0");
assert.equal(forwardedMetadata.ipMasked, "203.0.113.0");
assert.equal(
  forwardedMetadata.ipHash,
  crypto.createHash("sha256").update("203.0.113.42").digest("hex")
);
assert.notEqual(forwardedMetadata.ipHash, "203.0.113.42");
assert.equal(forwardedMetadata.receivedAt, "2026-07-03T00:00:00.000Z");

const ipv6Req = {
  method: "GET",
  originalUrl: "",
  path: "/health",
  ip: "2001:db8:85a3:0000:0000:8a2e:0370:7334",
  headers: {},
};

const ipv6Metadata = extractRequestMetadata(ipv6Req, receivedAt);

assert.equal(ipv6Metadata.path, "/health");
assert.equal(ipv6Metadata.ipMasked, "2001:db8:85a3:0000:0000:8a2e:0000:0000");

console.log("test-request-metadata passed");
