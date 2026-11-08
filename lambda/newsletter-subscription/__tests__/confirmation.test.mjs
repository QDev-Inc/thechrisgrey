import { test } from "node:test";
import assert from "node:assert/strict";
import { createConfirmationService } from "../confirmation.mjs";

test("a signup sends a confirmation without activating the contact and stores only the token hash", async () => {
  let stored, sent;
  const service = createConfirmationService({
    client: {
      send: async (command) => {
        stored = command.input.Item;
      },
    },
    table: "confirmations",
    from: "sender@example.com",
    subscribe: async () => assert.fail("signup must not subscribe"),
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(init.body);
      return { ok: true };
    },
  });
  await service.request({
    apiKey: "test",
    email: "person@example.com",
    source: "blueprint",
    segmentId: "blueprint",
    origin: "https://thechrisgrey.com",
  });
  const link = sent.text.match(/https:\/\/[^\s]+/)[0];
  const token = new URL(link).hash.slice(1);
  assert.equal(token.length, 43);
  assert.equal(JSON.stringify(stored).includes(token), false);
  assert.equal(stored.source, "blueprint");
  assert.equal(stored.segmentId, "blueprint");
  assert.match(sent.text, /Blueprint waitlist/);
});

test("only a valid unconsumed confirmation can activate a contact", async () => {
  let subscribed = 0,
    consumed = false;
  const service = createConfirmationService({
    client: {
      send: async (command) => {
        assert.match(command.input.ConditionExpression, /attribute_not_exists\(consumedAt\)/);
        assert.match(command.input.ConditionExpression, /#ttl > :now/);
        if (consumed) throw Object.assign(new Error("used"), { name: "ConditionalCheckFailedException" });
        consumed = true;
        return { Attributes: { email: "person@example.com", source: "blueprint", segmentId: "blueprint" } };
      },
    },
    table: "confirmations",
    from: "sender@example.com",
    subscribe: async (input) => {
      subscribed++;
      assert.equal(input.segmentId, "blueprint");
    },
  });
  assert.deepEqual(await service.confirm({ apiKey: "test", token: "invalid" }), { ok: false });
  const token = "a".repeat(43);
  assert.deepEqual(await service.confirm({ apiKey: "test", token }), { ok: true, source: "blueprint" });
  assert.deepEqual(await service.confirm({ apiKey: "test", token }), { ok: false });
  assert.equal(subscribed, 1);
});

test("provider failures cannot be retried with the same consumed token", async () => {
  let consumed = false;
  const service = createConfirmationService({
    client: {
      send: async () => {
        if (consumed) throw Object.assign(new Error("used"), { name: "ConditionalCheckFailedException" });
        consumed = true;
        return { Attributes: { email: "person@example.com", source: "newsletter", segmentId: "newsletter" } };
      },
    },
    table: "confirmations",
    from: "sender@example.com",
    subscribe: async () => {
      throw new Error("provider unavailable");
    },
  });
  await assert.rejects(service.confirm({ apiKey: "test", token: "a".repeat(43) }), /provider unavailable/);
  assert.deepEqual(await service.confirm({ apiKey: "test", token: "a".repeat(43) }), { ok: false });
});
