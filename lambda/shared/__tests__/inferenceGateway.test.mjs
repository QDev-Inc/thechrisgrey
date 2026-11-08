import { test } from "node:test";
import assert from "node:assert/strict";
import gateway, { MODEL_ID } from "../../../workers/inference/index.mjs";

const key = "a".repeat(64);
const body = { model: MODEL_ID, messages: [{ role: "user", content: "Hello" }], max_tokens: 50 };
const request = (data = body, bearer = key) =>
  new Request("https://inference.example/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(data),
  });
const environment = (overrides = {}) => ({
  GATEWAY_KEY: key,
  LIMITER: {
    async limit() {
      return { success: true };
    },
  },
  AI: {
    async run() {
      return { choices: [{ message: { role: "assistant", content: "Hello" } }], usage: {} };
    },
  },
  ...overrides,
});

test("gateway rejects missing, wrong, and oversized credentials before calling the model", async () => {
  const env = environment({
    AI: {
      async run() {
        assert.fail("unauthorized inference");
      },
    },
  });
  for (const bearer of ["", "b".repeat(64), "x".repeat(1000)])
    assert.equal((await gateway.fetch(request(body, bearer), env)).status, 401);
  assert.equal((await gateway.fetch(request(), environment({ GATEWAY_KEY: "" }))).status, 401);
});

test("gateway fixes the model, restricts output size, and rejects streaming bypasses", async () => {
  for (const invalid of [
    null,
    { ...body, model: "expensive-model" },
    { ...body, max_tokens: 100000 },
    { ...body, max_tokens: -1 },
    { ...body, stream: true },
    { ...body, messages: [] },
    { ...body, tools: Array(41).fill({}) },
  ]) {
    assert.equal((await gateway.fetch(request(invalid), environment())).status, 400);
  }
});

test("actual request-body bytes are bounded without trusting Content-Length", async () => {
  assert.equal((await gateway.fetch(request({ ...body, padding: "x".repeat(262144) }), environment())).status, 400);
});

test("gateway fails closed on missing or failed rate limiting", async () => {
  assert.equal((await gateway.fetch(request(), environment({ LIMITER: undefined }))).status, 503);
  assert.equal(
    (
      await gateway.fetch(
        request(),
        environment({
          LIMITER: {
            async limit() {
              throw new Error("down");
            },
          },
        }),
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await gateway.fetch(
        request(),
        environment({
          LIMITER: {
            async limit() {
              return { success: false };
            },
          },
        }),
      )
    ).status,
    429,
  );
});

test("successful inference returns only the application contract and no-cache headers", async () => {
  const response = await gateway.fetch(request(), environment());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal((await response.json()).choices[0].message.content, "Hello");
});

test("provider failures are generic and health does not expose configuration", async () => {
  const response = await gateway.fetch(
    request(),
    environment({
      AI: {
        async run() {
          throw new Error("secret-provider-details");
        },
      },
    }),
  );
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes("secret-provider-details"), false);
  assert.equal((await gateway.fetch(new Request("https://inference.example/health"), environment())).status, 200);
  assert.equal((await gateway.fetch(new Request("https://inference.example/unknown"), environment())).status, 404);
});
