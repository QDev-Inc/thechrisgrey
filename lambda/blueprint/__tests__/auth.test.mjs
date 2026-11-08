import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";

// --- Isolate from AWS BEFORE importing the handler -------------------------
delete process.env.AWS_ACCESS_KEY_ID;
delete process.env.AWS_SECRET_ACCESS_KEY;
delete process.env.AWS_SESSION_TOKEN;
delete process.env.AWS_PROFILE;
process.env.AWS_SHARED_CREDENTIALS_FILE = "/dev/null";
process.env.AWS_CONFIG_FILE = "/dev/null";
process.env.AWS_EC2_METADATA_DISABLED = "true";
process.env.AWS_REGION = "us-east-1";

// Both auth paths active.
const LEGACY_KEY = "blueprint-legacy-key";
process.env.BLUEPRINT_SIGNING_KEY = LEGACY_KEY;
const SESSION_KEY = "blueprint-session-key";
process.env.SESSION_TOKEN_KEY = SESSION_KEY;

// Capture the committed HTTP response metadata + body from the streaming handler.
const committed = [];
function makeStream() {
  return {
    writes: [],
    ended: false,
    write(c) {
      this.writes.push(String(c));
    },
    end() {
      this.ended = true;
    },
    get body() {
      return this.writes.join("");
    },
  };
}
globalThis.awslambda = {
  streamifyResponse: (fn) => fn,
  HttpResponseStream: {
    from: (stream, meta) => {
      committed.push(meta);
      return stream;
    },
  },
};

const { handler } = await import("../index.mjs");
const { issueSessionToken } = await import("lambda-shared/sessionToken");
const { hashDeviceId } = await import("lambda-shared/deviceId");

function makeEvent({ headers = {}, body = "{}", method = "POST" } = {}) {
  return {
    body,
    headers,
    requestContext: { http: { method, sourceIp: "1.2.3.4" } },
  };
}
function legacySign(body, key) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", key).update(`${ts}.${body}`).digest("hex");
  return { "x-blueprint-timestamp": ts, "x-blueprint-signature": sig };
}

async function run(event) {
  committed.length = 0;
  const stream = makeStream();
  await handler(event, stream, {});
  return { status: committed[0]?.statusCode, body: stream.body };
}

test("rejects an unauthenticated request with 401 unauthorized", async () => {
  const { status, body } = await run(makeEvent({ headers: {} }));
  assert.equal(status, 401);
  assert.match(body, /unauthorized/);
});

test("a valid blueprint-scoped session token passes auth (reaches body validation, not 401)", async () => {
  // Missing-spec body so the request short-circuits at 400 missing_spec AFTER
  // auth — proving auth admitted it without invoking Bedrock.
  const token = issueSessionToken({ deviceHash: "d".repeat(64), scope: "blueprint" }, SESSION_KEY, 300);
  const { status, body } = await run(makeEvent({ headers: { authorization: `Bearer ${token}` }, body: "{}" }));
  assert.notEqual(status, 401);
  assert.equal(status, 400);
  assert.match(body, /missing_spec/);
});

test("a chat-scoped token is rejected on the blueprint endpoint (401)", async () => {
  const token = issueSessionToken({ deviceHash: "d".repeat(64), scope: "chat" }, SESSION_KEY, 300);
  const { status } = await run(makeEvent({ headers: { authorization: `Bearer ${token}` }, body: "{}" }));
  assert.equal(status, 401);
});

test("a valid token cannot select another device's quota", async () => {
  const token = issueSessionToken(
    { deviceHash: hashDeviceId("device-aaaaaaaaaaaa"), scope: "blueprint" },
    SESSION_KEY,
    300,
  );
  const result = await run(
    makeEvent({
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ spec: {}, deviceId: "device-bbbbbbbbbbbb" }),
    }),
  );
  assert.equal(result.status, 401);
  assert.match(result.body, /device_mismatch/);
});

test("invalid specs are rejected before a device allowance is reserved", async () => {
  const deviceId = "device-aaaaaaaaaaaa";
  const token = issueSessionToken({ deviceHash: hashDeviceId(deviceId), scope: "blueprint" }, SESSION_KEY, 300);
  const result = await run(
    makeEvent({ headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ spec: {}, deviceId }) }),
  );
  assert.equal(result.status, 400);
  assert.match(result.body, /invalid_input/);
});

test("a valid legacy x-blueprint-* signature is REJECTED once session tokens are rolled out", async () => {
  // With SESSION_TOKEN_KEY configured and ALLOW_LEGACY_HMAC unset, legacy HMAC
  // alone (no bearer) is no longer accepted — tokens are required.
  const body = "{}";
  const { status } = await run(makeEvent({ headers: legacySign(body, LEGACY_KEY), body }));
  assert.equal(status, 401);
});

test("ALLOW_LEGACY_HMAC=1 re-enables the legacy transition window", async () => {
  process.env.ALLOW_LEGACY_HMAC = "1";
  try {
    const body = "{}";
    const { status } = await run(makeEvent({ headers: legacySign(body, LEGACY_KEY), body }));
    assert.notEqual(status, 401);
    assert.equal(status, 400); // missing_spec, i.e. past auth
  } finally {
    delete process.env.ALLOW_LEGACY_HMAC;
  }
});

for (const body of ["null", "[]", "42"]) {
  test(`rejects non-object JSON ${body} before quota reservation`, async () => {
    const token = issueSessionToken({ deviceHash: "d".repeat(64), scope: "blueprint" }, SESSION_KEY, 300);
    assert.equal((await run(makeEvent({ headers: { authorization: `Bearer ${token}` }, body }))).status, 400);
  });
}
