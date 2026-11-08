import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit } from "../rateLimit.mjs";

// N+1 query detection for the shared rate-limit pattern.
//
// Every HTTP Lambda (chat-stream, blueprint, kb-builder, metrics, mcp-server,
// session-token) rate-limits via checkRateLimit, which does a single atomic
// DynamoDB ADD on the per-IP key. These tests assert the rate check is O(1)
// per request — one UpdateCommand — and never scans prior requests or issues
// per-item reads. If someone "improved" rate limiting by querying the last N
// requests and summing them, these tests would fail (call count would scale
// with maxRequests or a Query/Scan would appear).

class UpdateCommand {
  constructor(input) {
    this.input = input;
    this.__name = "UpdateCommand";
  }
}

function countingClient(responses) {
  const calls = [];
  let i = 0;
  return {
    calls,
    send: async (cmd) => {
      calls.push(cmd);
      const r = responses[i++];
      if (r instanceof Error) throw r;
      return r ?? {};
    },
  };
}

test("checkRateLimit makes exactly one DynamoDB call per request (no N+1)", async () => {
  const client = countingClient([{ Attributes: { requestCount: 1 } }]);
  const result = await checkRateLimit(client, UpdateCommand, {
    table: "thechrisgrey-chat-ratelimit",
    ip: "1.2.3.4",
    maxRequests: 100,
    windowSeconds: 3600,
  });
  assert.equal(result.allowed, true);
  assert.equal(client.calls.length, 1, "rate check must be a single atomic ADD, not a loop over prior requests");
  assert.equal(client.calls[0].__name, "UpdateCommand");
});

test("checkRateLimit call count does not scale with maxRequests (O(1), not O(N))", async () => {
  for (const max of [1, 100, 10000]) {
    const client = countingClient([{ Attributes: { requestCount: 1 } }]);
    await checkRateLimit(client, UpdateCommand, {
      table: "thechrisgrey-chat-ratelimit",
      ip: "1.2.3.4",
      maxRequests: max,
      windowSeconds: 3600,
    });
    assert.equal(
      client.calls.length,
      1,
      `maxRequests=${max} must still be 1 DB call (O(1)), got ${client.calls.length}`,
    );
  }
});

test("checkRateLimit reset path makes at most 2 calls (bounded, no N+1 loop)", async () => {
  // First ADD fails with ConditionalCheckFailedException (stale window) -> reset.
  const err = new Error("stale window");
  err.name = "ConditionalCheckFailedException";
  const client = countingClient([err, {}]);
  const result = await checkRateLimit(client, UpdateCommand, {
    table: "thechrisgrey-chat-ratelimit",
    ip: "1.2.3.4",
    maxRequests: 100,
    windowSeconds: 3600,
  });
  assert.equal(result.allowed, true);
  assert.equal(client.calls.length, 2, "reset path: 1 failed ADD + 1 reset SET, not a per-item loop");
});

test("checkRateLimit never uses Query/Scan/Get (single-key access, no read of prior requests)", async () => {
  const client = countingClient([{ Attributes: { requestCount: 1 } }]);
  await checkRateLimit(client, UpdateCommand, {
    table: "thechrisgrey-chat-ratelimit",
    ip: "1.2.3.4",
    maxRequests: 100,
    windowSeconds: 3600,
  });
  const types = client.calls.map((c) => c.__name);
  assert.ok(!types.includes("QueryCommand"), "rate check must not scan the table");
  assert.ok(!types.includes("ScanCommand"), "rate check must not scan the table");
  assert.ok(!types.includes("GetCommand"), "rate check must not per-item get");
  assert.ok(!types.includes("BatchGetCommand"), "rate check must not batch-get prior requests");
});

test("checkRateLimit DynamoDB error fails closed with no retry loop (bounded calls)", async () => {
  // A non-conditional error should fail open (allowed) without retrying N times.
  const client = countingClient([new Error("throttled")]);
  const result = await checkRateLimit(client, UpdateCommand, {
    table: "thechrisgrey-chat-ratelimit",
    ip: "1.2.3.4",
    maxRequests: 100,
    windowSeconds: 3600,
    requestId: "req-1",
  });
  assert.equal(result.allowed, false, "DynamoDB error fails closed");
  assert.equal(client.calls.length, 1, "error path must not retry in a loop");
});
