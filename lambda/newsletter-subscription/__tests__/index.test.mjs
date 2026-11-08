import assert from "node:assert/strict";
import { test } from "node:test";
import { createNewsletterHandler, subscribeContact } from "../index.mjs";

const ORIGIN = "https://thechrisgrey.com";

function baseConfig(overrides = {}) {
  return {
    allowedOrigins: [ORIGIN],
    turnstileSecret: "turnstile-secret",
    segmentId: "segment_123",
    blueprintSegmentId: "blueprint_segment",
    ...overrides,
  };
}

function makeEvent({ method = "POST", origin = ORIGIN, body, ip = "9.9.9.9" } = {}) {
  return {
    requestContext: { http: { method, sourceIp: ip } },
    headers: { origin, "x-request-id": "request-123" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function makeHandler({ allowed = true, turnstilePass = true, subscribe = async () => {}, config = {} } = {}) {
  return createNewsletterHandler({
    checkRateLimitImpl: async () => ({ allowed }),
    verifyTurnstileImpl: async () => turnstilePass,
    getApiKey: async () => "re_test_key",
    requestConfirmation: subscribe,
    confirmSubscription: async () => ({ ok: true, source: "newsletter" }),
    config: baseConfig(config),
  });
}

test("GET health endpoint succeeds without invoking integrations", async () => {
  const response = await makeHandler()(makeEvent({ method: "GET" }));
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).service, "newsletter-subscription");
});

test("rejects requests from an unapproved origin", async () => {
  const response = await makeHandler()(
    makeEvent({ origin: "https://evil.example", body: { email: "person@example.com" } }),
  );
  assert.equal(response.statusCode, 403);
});

test("rejects invalid email addresses", async () => {
  const response = await makeHandler()(makeEvent({ body: { email: "not-an-email" } }));
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, "invalid_email");
});

test("enforces the rate limit before Turnstile or Resend", async () => {
  const response = await makeHandler({ allowed: false })(makeEvent({ body: { email: "person@example.com" } }));
  assert.equal(response.statusCode, 429);
});

test("rejects an invalid Turnstile token", async () => {
  const response = await makeHandler({ turnstilePass: false })(
    makeEvent({ body: { email: "person@example.com", turnstileToken: "bad" } }),
  );
  assert.equal(response.statusCode, 403);
});

test("accepts a valid subscriber and normalizes their email", async () => {
  let received;
  const response = await makeHandler({
    subscribe: async (input) => {
      received = input;
    },
  })(makeEvent({ body: { email: " Person@Example.com " } }));
  assert.equal(response.statusCode, 202);
  assert.deepEqual(received, {
    apiKey: "re_test_key",
    email: "person@example.com",
    segmentId: "segment_123",
    source: "newsletter",
    origin: ORIGIN,
  });
});

test("returns a generic provider failure", async () => {
  const response = await makeHandler({
    subscribe: async () => {
      throw new Error("provider unavailable");
    },
  })(makeEvent({ body: { email: "person@example.com" } }));
  assert.equal(response.statusCode, 502);
  assert.equal(JSON.parse(response.body).error, "subscription_unavailable");
});

test("subscribeContact creates a Resend contact in its newsletter segment", async () => {
  let request;
  await subscribeContact({
    apiKey: "re_test_key",
    email: "person@example.com",
    segmentId: "segment_123",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return { ok: true, status: 201 };
    },
  });
  assert.equal(request.url, "https://api.resend.com/contacts");
  assert.equal(request.init.headers.Authorization, "Bearer re_test_key");
  assert.deepEqual(JSON.parse(request.init.body), {
    email: "person@example.com",
    unsubscribed: false,
    segments: [{ id: "segment_123" }],
  });
});

test("subscribeContact reactivates an existing contact and ignores an existing segment", async () => {
  const requests = [];
  const responses = [
    { ok: false, status: 409 },
    { ok: true, status: 200 },
    { ok: false, status: 409 },
  ];
  await subscribeContact({
    apiKey: "re_test_key",
    email: "person@example.com",
    segmentId: "segment_123",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return responses.shift();
    },
  });
  assert.equal(requests.length, 3);
  assert.equal(requests[1].init.method, "PATCH");
  assert.equal(requests[2].url, "https://api.resend.com/contacts/person%40example.com/segments/segment_123");
});

test("missing Turnstile configuration rejects requests", async () => {
  const response = await makeHandler({ config: { turnstileSecret: "" } })(
    makeEvent({ body: { email: "person@example.com" } }),
  );
  assert.equal(response.statusCode, 503);
});
