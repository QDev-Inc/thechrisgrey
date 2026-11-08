import assert from "node:assert/strict";
import { test } from "node:test";
import { createContactEmailHandler, sendContactEmail } from "../index.mjs";

const ORIGIN = "https://thechrisgrey.com";

function baseConfig(overrides = {}) {
  return {
    allowedOrigins: [ORIGIN],
    turnstileSecret: "turnstile-secret",
    from: "Christian <contact@thechrisgrey.com>",
    recipient: "christian@example.com",
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

function validBody(overrides = {}) {
  return {
    name: "Taylor Jones",
    email: "taylor@example.com",
    message: "I would like to discuss a keynote.",
    ...overrides,
  };
}

function makeHandler({ allowed = true, turnstilePass = true, sendEmail = async () => {}, config = {} } = {}) {
  return createContactEmailHandler({
    checkRateLimitImpl: async () => ({ allowed }),
    verifyTurnstileImpl: async () => turnstilePass,
    getApiKey: async () => "re_test_key",
    sendEmail,
    config: baseConfig(config),
  });
}

test("GET health endpoint succeeds without invoking integrations", async () => {
  const response = await makeHandler()(makeEvent({ method: "GET" }));
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).service, "contact-email");
});

test("rejects requests from an unapproved origin", async () => {
  const response = await makeHandler()(makeEvent({ origin: "https://evil.example", body: validBody() }));
  assert.equal(response.statusCode, 403);
});

test("rejects malformed contact details before calling external services", async () => {
  let called = false;
  const handler = makeHandler({
    sendEmail: async () => {
      called = true;
    },
  });
  const response = await handler(makeEvent({ body: validBody({ email: "not-an-email" }) }));
  assert.equal(response.statusCode, 400);
  assert.equal(called, false);
});

test("accepts a honeypot submission without delivering an email", async () => {
  let called = false;
  const handler = makeHandler({
    sendEmail: async () => {
      called = true;
    },
  });
  const response = await handler(makeEvent({ body: validBody({ website: "https://spam.example" }) }));
  assert.equal(response.statusCode, 202);
  assert.equal(called, false);
});

test("enforces the rate limit before Turnstile or Resend", async () => {
  const response = await makeHandler({ allowed: false })(makeEvent({ body: validBody() }));
  assert.equal(response.statusCode, 429);
});

test("rejects an invalid Turnstile token", async () => {
  const response = await makeHandler({ turnstilePass: false })(
    makeEvent({ body: validBody({ turnstileToken: "bad" }) }),
  );
  assert.equal(response.statusCode, 403);
  assert.equal(JSON.parse(response.body).error, "turnstile_failed");
});

test("accepts a valid message and sends the normalized payload", async () => {
  let sent;
  const handler = makeHandler({
    sendEmail: async (input) => {
      sent = input;
    },
  });
  const response = await handler(makeEvent({ body: validBody({ email: "  Taylor@Example.com " }) }));
  assert.equal(response.statusCode, 202);
  assert.deepEqual(sent.contact, {
    name: "Taylor Jones",
    email: "taylor@example.com",
    message: "I would like to discuss a keynote.",
  });
  assert.equal(sent.requestId, "request-123");
});

test("returns 503 when delivery configuration is incomplete", async () => {
  const response = await makeHandler({ config: { from: "", recipient: "" } })(makeEvent({ body: validBody() }));
  assert.equal(response.statusCode, 503);
});

test("sendContactEmail uses Resend's email endpoint with an idempotency key", async () => {
  let request;
  await sendContactEmail({
    apiKey: "re_test_key",
    from: "Christian <contact@thechrisgrey.com>",
    recipient: "christian@example.com",
    contact: { name: "Taylor <Jones>", email: "taylor@example.com", message: "Hello <there>" },
    requestId: "request-123",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return { ok: true };
    },
  });
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.init.headers.Authorization, "Bearer re_test_key");
  assert.equal(request.init.headers["Idempotency-Key"], "contact-request-123");
  const payload = JSON.parse(request.init.body);
  assert.equal(payload.reply_to, "taylor@example.com");
  assert.match(payload.html, /Taylor &lt;Jones&gt;/);
  assert.match(payload.html, /Hello &lt;there&gt;/);
});

test("sendContactEmail surfaces a Resend failure without exposing its response", async () => {
  await assert.rejects(
    () =>
      sendContactEmail({
        apiKey: "re_test_key",
        from: "from@example.com",
        recipient: "to@example.com",
        contact: validBody(),
        requestId: "request-123",
        fetchImpl: async () => ({ ok: false, status: 422 }),
      }),
    /resend_email_422/,
  );
});

test("missing Turnstile configuration rejects requests", async () => {
  const response = await makeHandler({ config: { turnstileSecret: "" } })(makeEvent({ body: validBody() }));
  assert.equal(response.statusCode, 503);
});
