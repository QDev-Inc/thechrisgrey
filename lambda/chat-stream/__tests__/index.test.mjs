import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "crypto";

// --- Isolate from AWS BEFORE importing the handler -------------------------
// The handler constructs module-level SDK clients and, on the signature-reject
// path, records a metric and calls metrics.flush(). We force AWS credential and
// IMDS resolution to fail FAST (no network) so flush() rejects-and-swallows
// instead of calling CloudWatch for real. This keeps the test hermetic.
delete process.env.AWS_ACCESS_KEY_ID;
delete process.env.AWS_SECRET_ACCESS_KEY;
delete process.env.AWS_SESSION_TOKEN;
delete process.env.AWS_PROFILE;
process.env.AWS_SHARED_CREDENTIALS_FILE = "/dev/null";
process.env.AWS_CONFIG_FILE = "/dev/null";
process.env.AWS_EC2_METADATA_DISABLED = "true";
process.env.AWS_REGION = "us-east-1";
const { DynamoDBDocumentClient, UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
DynamoDBDocumentClient.prototype.send = async function (command) {
  if (command instanceof UpdateCommand) return { Attributes: { requestCount: 1 } };
  throw new Error("memory unavailable in this test");
};

// Both auth paths must be ACTIVE for these assertions: legacy HMAC (CHAT_SIGNING_KEY)
// and server-issued session tokens (SESSION_TOKEN_KEY).
const KEY = "test-secret-key";
process.env.CHAT_SIGNING_KEY = KEY;
const SESSION_KEY = "test-session-key";
process.env.SESSION_TOKEN_KEY = SESSION_KEY;

// Stub the Lambda streaming runtime global so `awslambda.streamifyResponse`
// (evaluated at module load, line ~128) returns the bare handler function.
globalThis.awslambda = {
  streamifyResponse: (fn) => fn,
  HttpResponseStream: { from: (s) => s },
};

const { handler, classifyError } = await import("../index.mjs");
const { issueSessionToken } = await import("lambda-shared/sessionToken");

const SYS = "\x00SYS\x00";

// A device id the handler accepts (DEVICE_ID_PATTERN) plus the hash the session
// token issuer binds into the token for it, so a test can mint a token that
// genuinely belongs to a device — or deliberately not.
const DEVICE_A = "device-aaaaaaaa-1111";
const DEVICE_B = "device-bbbbbbbb-2222";
const hashDevice = (id) => createHash("sha256").update(id).digest("hex");

function chatToken(deviceId) {
  return issueSessionToken({ deviceHash: hashDevice(deviceId), scope: "chat" }, SESSION_KEY, 300);
}

function makeStream() {
  return {
    chunks: [],
    ended: false,
    write(c) {
      this.chunks.push(String(c));
    },
    end() {
      this.ended = true;
    },
    get output() {
      return this.chunks.join("");
    },
  };
}

function makeEvent({ method = "POST", headers = {}, body = "{}", path = "/" } = {}) {
  return {
    body,
    headers,
    rawPath: path,
    requestContext: { http: { method, sourceIp: "1.2.3.4", path } },
  };
}

function signHeaders(body, key, { offsetSeconds = 0 } = {}) {
  const ts = String(Math.floor(Date.now() / 1000) + offsetSeconds);
  const sig = createHmac("sha256", key).update(`${ts}.${body}`).digest("hex");
  return { "x-chat-timestamp": ts, "x-chat-signature": sig };
}

test("OPTIONS preflight short-circuits with an empty body and no further processing", async () => {
  const stream = makeStream();
  await handler(makeEvent({ method: "OPTIONS" }), stream, {});
  assert.equal(stream.output, "");
  assert.equal(stream.ended, true);
});

test(
  "rejects a request with MISSING signature headers (verify runs before rate limiting)",
  { timeout: 10000 },
  async () => {
    const stream = makeStream();
    await handler(makeEvent({ headers: {} }), stream, {});
    // The ONLY output is the signature-rejection system message — proving the
    // request never advanced to the rate-limit / processing stage that follows it.
    assert.equal(stream.output, SYS + "Unable to process request.");
    assert.equal(stream.ended, true);
  },
);

test("rejects a request with an INVALID signature", { timeout: 10000 }, async () => {
  const stream = makeStream();
  const headers = {
    "x-chat-timestamp": String(Math.floor(Date.now() / 1000)),
    "x-chat-signature": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  };
  await handler(makeEvent({ headers }), stream, {});
  assert.equal(stream.output, SYS + "Unable to process request.");
  assert.equal(stream.ended, true);
});

test("rejects an EXPIRED signature timestamp", { timeout: 10000 }, async () => {
  const stream = makeStream();
  const body = "{}";
  const headers = signHeaders(body, KEY, { offsetSeconds: -600 });
  await handler(makeEvent({ headers, body }), stream, {});
  assert.equal(stream.output, SYS + "Unable to process request.");
});

test("a VALID signature passes verification and reaches input validation", { timeout: 10000 }, async () => {
  // The legacy HMAC transition window is now gated behind ALLOW_LEGACY_HMAC.
  // Re-enable it here to assert a correctly-signed legacy request is still
  // admitted when the flag is on (rollback / staged-rollout safety).
  //
  // The body is deliberately an EMPTY message list so the admitted request has a
  // deterministic destination: validateInput's rejection copy. Asserting only
  // "not the auth rejection" passed even when the request died on the generic
  // error branch, which is exactly what it does under this credential-less
  // harness — the assertion could not tell admitted from broken.
  process.env.ALLOW_LEGACY_HMAC = "1";
  try {
    const stream = makeStream();
    const body = '{"messages":[]}';
    const headers = signHeaders(body, KEY);
    await handler(makeEvent({ headers, body }), stream, {});
    assert.equal(stream.output, SYS + "Please send a message to start our conversation.");
  } finally {
    delete process.env.ALLOW_LEGACY_HMAC;
  }
});

test(
  "a VALID legacy signature is REJECTED once session tokens are rolled out (ALLOW_LEGACY_HMAC unset)",
  { timeout: 10000 },
  async () => {
    const stream = makeStream();
    const body = '{"messages":[{"role":"user","content":"hi"}]}';
    const headers = signHeaders(body, KEY);
    await handler(makeEvent({ headers, body }), stream, {});
    assert.equal(stream.output, SYS + "Unable to process request.");
  },
);

test("a VALID chat-scoped bearer session token is admitted past the auth front door", { timeout: 10000 }, async () => {
  const stream = makeStream();
  const body = '{"messages":[]}';
  const token = issueSessionToken({ deviceHash: "a".repeat(64), scope: "chat" }, SESSION_KEY, 300);
  await handler(makeEvent({ headers: { authorization: `Bearer ${token}` }, body }), stream, {});
  // Same reasoning as the legacy case: pin the exact post-auth destination, not
  // merely the absence of the rejection copy.
  assert.equal(stream.output, SYS + "Please send a message to start our conversation.");
});

test(
  "a bearer token minted for the WRONG scope (blueprint) is rejected on the chat endpoint",
  { timeout: 10000 },
  async () => {
    const stream = makeStream();
    const body = '{"messages":[{"role":"user","content":"hi"}]}';
    const token = issueSessionToken({ deviceHash: "a".repeat(64), scope: "blueprint" }, SESSION_KEY, 300);
    await handler(makeEvent({ headers: { authorization: `Bearer ${token}` }, body }), stream, {});
    assert.equal(stream.output, SYS + "Unable to process request.");
  },
);

// ---------------------------------------------------------------------------
// Post-auth branches. Every assertion below drives the REAL exported handler;
// the rate limiter fails open under this credential-less harness, so each
// request reaches the branch under test.
// ---------------------------------------------------------------------------

test("a body that is not JSON is rejected with the malformed-request copy", { timeout: 10000 }, async () => {
  const stream = makeStream();
  const body = "{ this is not json";
  await handler(makeEvent({ headers: { authorization: `Bearer ${chatToken(DEVICE_A)}` }, body }), stream, {});
  assert.equal(stream.output, SYS + "Invalid request format.");
});

test("a message with blank content is rejected by validateInput", { timeout: 10000 }, async () => {
  const stream = makeStream();
  const body = '{"messages":[{"role":"user","content":"   "}]}';
  await handler(makeEvent({ headers: { authorization: `Bearer ${chatToken(DEVICE_A)}` }, body }), stream, {});
  assert.equal(stream.output, SYS + "Please enter a message.");
});

test("a history whose last message is the assistant's never reaches the model", { timeout: 10000 }, async () => {
  // validateInput passes (both messages are well-formed), so the ONLY thing that
  // stops this turn is the latest-message guard. Were it removed the request
  // would run on to the model and end on the generic error copy instead.
  const stream = makeStream();
  const body = '{"messages":[{"role":"user","content":"hi"},{"role":"assistant","content":"hello"}]}';
  await handler(makeEvent({ headers: { authorization: `Bearer ${chatToken(DEVICE_A)}` }, body }), stream, {});
  assert.equal(stream.output, SYS + "Please send a message to start our conversation.");
});

// ---------------------------------------------------------------------------
// Generative UI. The branch is reached only from the /chat surface with an
// explicit "gen-ui" command, and it bypasses the conversational agent entirely,
// so its failure copy is the only thing standing between a broken Opus call and
// a silent empty turn.
// ---------------------------------------------------------------------------

const GENUI_FALLBACK =
  "I couldn't compose that visual just now. Try rephrasing, or ask me to describe it in words instead.";

function genUiBody(text = "use gen-ui to compare his military and tech careers") {
  return JSON.stringify({
    messages: [{ role: "user", content: text }],
    // surface === "page" is what gates the branch; validatePageContext
    // normalizes the trailing slash prod serves, so "/chat" is the canonical form.
    pageContext: { currentPage: "/chat", section: "AI Chat", visitedPages: [] },
  });
}

test("a failed gen-ui render writes the fallback copy, never a silent empty turn", { timeout: 20000 }, async () => {
  // Under this credential-less harness the ApplyGuardrail pre-check cannot
  // complete, so renderGenUi fails CLOSED and returns ok:false — the same shape
  // a Bedrock outage or an unparseable block produces. What is being pinned is
  // the handler's response to ok:false, which is the only remediation this
  // branch has: the visitor must be told, in words, that the visual failed.
  const stream = makeStream();
  await handler(
    makeEvent({ headers: { authorization: `Bearer ${chatToken(DEVICE_A)}` }, body: genUiBody() }),
    stream,
    {},
  );
  assert.ok(stream.output.includes(SYS + GENUI_FALLBACK), `expected the gen-ui fallback, got: ${stream.output}`);
});

test("a non-gen-ui message on /chat never reaches the gen-ui branch", { timeout: 20000 }, async () => {
  // Guards the trigger itself: without this, a fallback assertion above would
  // also pass if EVERY /chat turn were being routed to Opus.
  const stream = makeStream();
  await handler(
    makeEvent({
      headers: { authorization: `Bearer ${chatToken(DEVICE_A)}` },
      body: genUiBody("what did he do in the army?"),
    }),
    stream,
    {},
  );
  assert.ok(!stream.output.includes(GENUI_FALLBACK), `gen-ui branch ran for an ordinary question: ${stream.output}`);
});

// ---------------------------------------------------------------------------
// /forget — device binding. The session token carries sha256(deviceId); the body
// names the partition to erase. Erasure is irreversible, so a token that names
// someone else's device is refused.
// ---------------------------------------------------------------------------

test("POST /forget refuses a deviceId the bearer token was not minted for", { timeout: 10000 }, async () => {
  const stream = makeStream();
  const body = JSON.stringify({ deviceId: DEVICE_B });
  await handler(
    makeEvent({ headers: { authorization: `Bearer ${chatToken(DEVICE_A)}` }, body, path: "/forget" }),
    stream,
    {},
  );
  assert.deepEqual(JSON.parse(stream.output), { ok: false, error: "Invalid request." });
});

test("POST /forget admits the deviceId its bearer token WAS minted for", { timeout: 10000 }, async () => {
  // Distinguishes "the binding rejected me" from "the erase itself failed": a
  // matching device gets past the binding and dies on the (credential-less)
  // DynamoDB call, which is a different message. Without this the mismatch test
  // above would also pass a binding that rejected everything.
  const stream = makeStream();
  const body = JSON.stringify({ deviceId: DEVICE_A });
  await handler(
    makeEvent({ headers: { authorization: `Bearer ${chatToken(DEVICE_A)}` }, body, path: "/forget" }),
    stream,
    {},
  );
  assert.deepEqual(JSON.parse(stream.output), { ok: false, error: "Unable to clear memory right now." });
});

test("POST /forget rejects a malformed deviceId before touching the memory table", { timeout: 10000 }, async () => {
  const stream = makeStream();
  const body = JSON.stringify({ deviceId: "short" });
  await handler(
    makeEvent({ headers: { authorization: `Bearer ${chatToken(DEVICE_A)}` }, body, path: "/forget" }),
    stream,
    {},
  );
  assert.deepEqual(JSON.parse(stream.output), { ok: false, error: "Invalid request." });
});

// ---------------------------------------------------------------------------
// Error classification. Asserted against the REAL exported classifier, not a
// copy of its branches: streaming-contract.test.mjs previously kept a hand-made
// duplicate, so deleting a branch from index.mjs failed nothing.
// ---------------------------------------------------------------------------

function namedError(name, message = "boom") {
  const err = new Error(message);
  err.name = name;
  return err;
}

test("classifyError routes an abort to the timeout path, never to validation", () => {
  assert.equal(classifyError(namedError("AbortError", "The operation was aborted")), "abort_timeout");
  assert.notEqual(classifyError(namedError("AbortError")), "guardrail_prestream");
  assert.notEqual(classifyError(namedError("AbortError")), "unhandled");
});

test("classifyError routes only a guardrail ValidationException to the guardrail path", () => {
  assert.equal(
    classifyError(namedError("ValidationException", "Input failed guardrail policy")),
    "guardrail_prestream",
  );
  // A ValidationException that is NOT about the guardrail is a plain failure —
  // answering it with the guardrail decline would blame the visitor for a bug.
  assert.equal(classifyError(namedError("ValidationException", "malformed request payload")), "unhandled");
});

test("classifyError routes both throttling shapes to the busy path", () => {
  assert.equal(classifyError(namedError("ThrottlingException")), "throttled");
  assert.equal(classifyError(namedError("ServiceQuotaExceededException")), "throttled");
});

test("classifyError falls back to unhandled for anything else, including non-Errors", () => {
  assert.equal(classifyError(namedError("TypeError")), "unhandled");
  assert.equal(classifyError("just a string"), "unhandled");
});
