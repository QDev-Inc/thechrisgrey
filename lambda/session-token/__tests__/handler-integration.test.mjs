/**
 * Session-token handler INTEGRATION test.
 *
 * Exercises the REAL `handler` export in index.mjs end-to-end: the module-level
 * wiring (env var parsing, SDK client construction, MetricsCollector setup) and
 * the full HTTP surface (OPTIONS preflight, GET health, POST token issuance,
 * origin allowlist, rate limiting, Turnstile verification, deviceId validation,
 * and error handling). External services are intercepted at the SDK prototype
 * level and global fetch is stubbed for Turnstile.
 *
 * WHAT IS REAL
 *   - The entire module-level wiring: env var parsing, DynamoDB/CloudWatch
 *     client construction, MetricsCollector creation, and createIssuerHandler
 *     assembly with the real config.
 *   - The entire handler body: origin check, JSON parsing, deviceId validation,
 *     rate limiting via checkRateLimit, Turnstile verification, token issuance
 *     via issueSessionToken, and response shaping.
 *
 * WHERE THE FAKE SITS
 *   DynamoDBDocumentClient.prototype.send returns a scripted rate-limit count.
 *   CloudWatchClient.prototype.send swallows PutMetricData (metrics are best-effort).
 *   globalThis.fetch is stubbed to return scripted Turnstile siteverify responses.
 *
 * This complements index.test.mjs (which tests createIssuerHandler with injected
 * deps) by verifying the real module-level wiring and the real handler export.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { verifySessionToken } from "lambda-shared/sessionToken";

// ── Env setup BEFORE importing the handler ──────────────────────────────────
process.env.SESSION_TOKEN_KEY = "integration-test-signing-secret";
process.env.TURNSTILE_SECRET = "test-turnstile-secret";
process.env.CORS_ORIGIN = "https://thechrisgrey.com, https://main.example.amplifyapp.com";
process.env.SESSION_RATE_LIMIT_TABLE = "thechrisgrey-chat-ratelimit";
process.env.SESSION_CHAT_TTL = "1800";
process.env.SESSION_BLUEPRINT_TTL = "600";
process.env.SESSION_MAX_ISSUANCE = "60";

// ── Isolate from AWS ────────────────────────────────────────────────────────
delete process.env.AWS_ACCESS_KEY_ID;
delete process.env.AWS_SECRET_ACCESS_KEY;
delete process.env.AWS_SESSION_TOKEN;
delete process.env.AWS_PROFILE;
process.env.AWS_SHARED_CREDENTIALS_FILE = "/dev/null";
process.env.AWS_CONFIG_FILE = "/dev/null";
process.env.AWS_EC2_METADATA_DISABLED = "true";
process.env.AWS_REGION = "us-east-1";

const { DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb");
const { CloudWatchClient } = await import("@aws-sdk/client-cloudwatch");

// ── SDK prototype overrides ─────────────────────────────────────────────────

let dynamoBehavior = null;

DynamoDBDocumentClient.prototype.send = async function dynamoStub() {
  if (dynamoBehavior) return dynamoBehavior();
  return { Attributes: { requestCount: 1 } };
};

CloudWatchClient.prototype.send = async function cloudwatchStub() {
  return {};
};

// ── Turnstile fetch stub ────────────────────────────────────────────────────

let turnstileSuccess = true;

globalThis.fetch = async function fakeFetch() {
  return {
    ok: true,
    json: async () => ({ success: turnstileSuccess, hostname: "thechrisgrey.com", action: "session" }),
  };
};

// Mute console warnings from startup
const origWarn = console.warn;
const origLog = console.log;
console.warn = () => {};
console.log = () => {};

const { handler } = await import("../index.mjs");

// Restore console after import
console.warn = origWarn;
console.log = origLog;

// ── Helpers ─────────────────────────────────────────────────────────────────

const ORIGIN = "https://thechrisgrey.com";
const DEVICE_ID = "device-ABC_123-xyz";
const deviceHashOf = (id) => createHash("sha256").update(id).digest("hex");

function makeEvent({ method = "POST", origin = ORIGIN, body, ip = "9.9.9.9" } = {}) {
  return {
    requestContext: { http: { method, sourceIp: ip } },
    headers: { origin },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  };
}

function parseBody(res) {
  return JSON.parse(res.body);
}

// ── Tests: CORS and health ──────────────────────────────────────────────────

test("OPTIONS preflight returns 204 (CORS headers come from Function URL layer)", async () => {
  const res = await handler(makeEvent({ method: "OPTIONS" }));
  assert.equal(res.statusCode, 204);
  assert.equal(res.body, "");
});

test("GET health returns 200 with service info (no auth required)", async () => {
  const res = await handler(makeEvent({ method: "GET" }));
  assert.equal(res.statusCode, 200);
  const body = parseBody(res);
  assert.equal(body.ok, true);
  assert.equal(body.service, "session-token");
  assert.equal(body.version, "1.0.0");
});

test("non-POST/GET/OPTIONS method returns 405", async () => {
  const res = await handler(makeEvent({ method: "DELETE" }));
  assert.equal(res.statusCode, 405);
  const body = parseBody(res);
  assert.equal(body.error, "method_not_allowed");
});

// ── Tests: Origin validation ────────────────────────────────────────────────

test("request from disallowed origin returns 403", async () => {
  const res = await handler(
    makeEvent({ origin: "https://evil.example", body: { deviceId: DEVICE_ID, turnstileToken: "t" } }),
  );
  assert.equal(res.statusCode, 403);
  const body = parseBody(res);
  assert.equal(body.error, "forbidden_origin");
});

// ── Tests: Input validation ─────────────────────────────────────────────────

test("invalid JSON body returns 400", async () => {
  const res = await handler(makeEvent({ body: "{not valid json" }));
  assert.equal(res.statusCode, 400);
  const body = parseBody(res);
  assert.equal(body.error, "invalid_json");
});

test("missing deviceId returns 400", async () => {
  const res = await handler(makeEvent({ body: { turnstileToken: "t" } }));
  assert.equal(res.statusCode, 400);
  const body = parseBody(res);
  assert.equal(body.error, "invalid_device_id");
});

test("deviceId with invalid characters returns 400", async () => {
  const res = await handler(makeEvent({ body: { deviceId: "bad id with spaces!", turnstileToken: "t" } }));
  assert.equal(res.statusCode, 400);
  const body = parseBody(res);
  assert.equal(body.error, "invalid_device_id");
});

test("deviceId too short (< 8 chars) returns 400", async () => {
  const res = await handler(makeEvent({ body: { deviceId: "short", turnstileToken: "t" } }));
  assert.equal(res.statusCode, 400);
});

// ── Tests: Rate limiting ────────────────────────────────────────────────────

test("exceeding per-IP issuance limit returns 429", async () => {
  dynamoBehavior = () => ({ Attributes: { requestCount: 999 } });
  try {
    const res = await handler(makeEvent({ body: { deviceId: DEVICE_ID, turnstileToken: "t" } }));
    assert.equal(res.statusCode, 429);
    const body = parseBody(res);
    assert.equal(body.error, "rate_limited");
  } finally {
    dynamoBehavior = null;
  }
});

// ── Tests: Turnstile verification ───────────────────────────────────────────

test("failing Turnstile check returns 403", async () => {
  turnstileSuccess = false;
  try {
    const res = await handler(makeEvent({ body: { deviceId: DEVICE_ID, turnstileToken: "bad" } }));
    assert.equal(res.statusCode, 403);
    const body = parseBody(res);
    assert.equal(body.error, "turnstile_failed");
  } finally {
    turnstileSuccess = true;
  }
});

// ── Tests: Token issuance (happy path) ──────────────────────────────────────

test("happy path mints scoped chat + blueprint tokens bound to device hash", async () => {
  turnstileSuccess = true;
  const res = await handler(makeEvent({ body: { deviceId: DEVICE_ID, turnstileToken: "good" } }));
  assert.equal(res.statusCode, 200);
  const body = parseBody(res);

  assert.ok(body.chatToken, "chatToken present");
  assert.ok(body.blueprintToken, "blueprintToken present");
  assert.equal(body.chatExpiresIn, 1800);
  assert.equal(body.blueprintExpiresIn, 600);

  // Verify the chat token is valid and device-bound
  const chat = verifySessionToken(body.chatToken, "integration-test-signing-secret", { scope: "chat" });
  assert.equal(chat.valid, true);
  assert.equal(chat.deviceHash, deviceHashOf(DEVICE_ID));

  // Verify the blueprint token is valid and device-bound
  const bp = verifySessionToken(body.blueprintToken, "integration-test-signing-secret", { scope: "blueprint" });
  assert.equal(bp.valid, true);
  assert.equal(bp.deviceHash, deviceHashOf(DEVICE_ID));

  // Cross-scope rejection: chat token must not work for blueprint scope
  assert.equal(
    verifySessionToken(body.chatToken, "integration-test-signing-secret", { scope: "blueprint" }).valid,
    false,
  );
});

for (const origin of ["https://thechrisgrey.com", "https://main.example.amplifyapp.com"]) {
  test(`configured origin ${origin} reaches validation`, async () => {
    const response = await handler(makeEvent({ origin, body: {} }));
    assert.equal(response.statusCode, 400);
    assert.equal(parseBody(response).error, "invalid_device_id");
  });
}

test("null JSON body is a client error", async () => {
  assert.equal((await handler(makeEvent({ body: "null" }))).statusCode, 400);
});
