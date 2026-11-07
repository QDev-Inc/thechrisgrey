import assert from "node:assert/strict";
import { test } from "node:test";
import { readSecretString } from "../secrets.mjs";

class FakeGetSecretValueCommand {
  constructor(input) {
    this.input = input;
  }
}

test("readSecretString retrieves a non-empty plaintext secret", async () => {
  let input;
  const value = await readSecretString(
    {
      send: async (command) => {
        input = command.input;
        return { SecretString: "re_test_key" };
      },
    },
    FakeGetSecretValueCommand,
    "arn:aws:secretsmanager:us-east-1:123:secret:resend",
  );
  assert.equal(value, "re_test_key");
  assert.equal(input.SecretId, "arn:aws:secretsmanager:us-east-1:123:secret:resend");
});

test("readSecretString rejects missing identifiers and empty values", async () => {
  await assert.rejects(() => readSecretString({}, FakeGetSecretValueCommand, ""), /missing_secret_id/);
  await assert.rejects(
    () => readSecretString({ send: async () => ({}) }, FakeGetSecretValueCommand, "secret-id"),
    /secret_value_unavailable/,
  );
});
