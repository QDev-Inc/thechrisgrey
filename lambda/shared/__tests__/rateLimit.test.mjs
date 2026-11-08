import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit } from "../rateLimit.mjs";

// Minimal stand-in for UpdateCommand: records input so we can assert on the
// expression used (the over-limit reset uses a different UpdateExpression).
class FakeUpdateCommand {
  constructor(input) {
    this.input = input;
  }
}

// Client that returns a fixed requestCount on the FIRST send, then {} on the
// reset send. Records every command's input for assertions.
function countingClient(count) {
  const calls = [];
  let n = 0;
  return {
    calls,
    send: async (cmd) => {
      calls.push(cmd.input);
      n += 1;
      if (n === 1) return { Attributes: { requestCount: count } };
      return {};
    },
  };
}

// Client whose first send throws `error`; if `resetThrows` is true the reset
// send (used by the ConditionalCheckFailed branch) also throws.
function throwingClient(error, { resetThrows = false } = {}) {
  const calls = [];
  let n = 0;
  return {
    calls,
    send: async (cmd) => {
      calls.push(cmd.input);
      n += 1;
      if (n === 1) throw error;
      if (resetThrows) throw new Error("reset-also-failed");
      return {};
    },
  };
}

const OPTS = { table: "rl", ip: "1.2.3.4", maxRequests: 20, windowSeconds: 3600 };
const conditionalFail = () => Object.assign(new Error("stale"), { name: "ConditionalCheckFailedException" });

test("allows the maxRequests-th request (strict >, boundary is allowed)", async () => {
  const client = countingClient(20);
  const result = await checkRateLimit(client, FakeUpdateCommand, OPTS);
  assert.deepEqual(result, { allowed: true, remaining: 0 });
  assert.equal(client.calls.length, 1);
});

test("denies the maxRequests+1-th request", async () => {
  const client = countingClient(21);
  const result = await checkRateLimit(client, FakeUpdateCommand, OPTS);
  assert.deepEqual(result, { allowed: false, remaining: 0 });
});

test("reports remaining = maxRequests - count below the limit", async () => {
  const client = countingClient(5);
  const result = await checkRateLimit(client, FakeUpdateCommand, OPTS);
  assert.deepEqual(result, { allowed: true, remaining: 15 });
});

test("defaults count to 1 when Attributes is absent", async () => {
  const client = { calls: [], send: async () => ({}) };
  const result = await checkRateLimit(client, FakeUpdateCommand, OPTS);
  assert.deepEqual(result, { allowed: true, remaining: 19 });
});

test("ConditionalCheckFailed resets the stale window and re-allows", async () => {
  const client = throwingClient(conditionalFail());
  const result = await checkRateLimit(client, FakeUpdateCommand, OPTS);
  assert.deepEqual(result, { allowed: true, remaining: 19 });
  assert.equal(client.calls.length, 2, "expected a reset send after the conditional failure");
  // The reset uses SET requestCount = :one, not the ADD increment.
  assert.match(client.calls[1].UpdateExpression, /SET requestCount = :one/);
});

test("ConditionalCheckFailed whose reset also throws fails closed with remaining -1", async () => {
  const client = throwingClient(conditionalFail(), { resetThrows: true });
  const result = await checkRateLimit(client, FakeUpdateCommand, OPTS);
  assert.deepEqual(result, { allowed: false, remaining: -1 });
});

test("any other DynamoDB error fails closed with remaining -1", async () => {
  const client = throwingClient(Object.assign(new Error("boom"), { name: "ProvisionedThroughputExceededException" }));
  const result = await checkRateLimit(client, FakeUpdateCommand, OPTS);
  assert.deepEqual(result, { allowed: false, remaining: -1 });
  assert.equal(client.calls.length, 1, "non-conditional errors must NOT trigger a reset send");
});

test("applies the prefix to the partition key", async () => {
  const client = countingClient(1);
  await checkRateLimit(client, FakeUpdateCommand, { ...OPTS, prefix: "metrics-vitals-" });
  assert.ok(client.calls[0].Key.pk.startsWith("metrics-vitals-"));
});

test("a concurrent window reset retries the increment instead of overwriting the winner", async () => {
  const calls = [];
  const client = {
    send: async (command) => {
      calls.push(command.input);
      if (calls.length <= 2) throw conditionalFail();
      return { Attributes: { requestCount: 2 } };
    },
  };
  const result = await checkRateLimit(client, FakeUpdateCommand, { ...OPTS, maxRequests: 1 });
  assert.deepEqual(result, { allowed: false, remaining: 0 });
  assert.equal(calls[1].ConditionExpression, "windowStart < :ws");
  assert.equal(calls.length, 3);
});

test("a failed retry after losing a reset race denies the request", async () => {
  const client = {
    send: async () => {
      throw conditionalFail();
    },
  };
  assert.deepEqual(await checkRateLimit(client, FakeUpdateCommand, OPTS), { allowed: false, remaining: -1 });
});

test("telemetry may explicitly choose availability when storage is unavailable", async () => {
  const client = throwingClient(new Error("unavailable"));
  assert.deepEqual(await checkRateLimit(client, FakeUpdateCommand, { ...OPTS, failOpen: true }), {
    allowed: true,
    remaining: -1,
  });
});
