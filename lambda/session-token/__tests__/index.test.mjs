import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { verifySessionToken } from "lambda-shared/sessionToken";
import { createIssuerHandler, verifyTurnstile } from "../index.mjs";

const SIGNING_KEY = "server-only-signing-secret";
const ORIGIN = "https://thechrisgrey.com";

// Fake DynamoDBDocumentClient that drives the REAL checkRateLimit logic:
// returns ALL_NEW Attributes with a scripted requestCount so we exercise the
// genuine allowed/denied branch rather than mocking the limiter itself.
function fakeDocClient(requestCount) {
  return {
    sent: [],
    async send(cmd) {
      this.sent.push(cmd);
      return { Attributes: { requestCount } };
    },
  };
}
class FakeUpdateCommand {
  constructor(input) {
    this.input = input;
  }
}

function baseConfig(overrides = {}) {
  return {
    signingKey: SIGNING_KEY,
    turnstileSecret: "turnstile-secret",
    corsOrigin: ORIGIN,
    allowedOrigins: [ORIGIN],
    rateLimitTable: "thechrisgrey-chat-ratelimit",
    chatTtl: 1800,
    blueprintTtl: 600,
    maxIssuancePerHour: 60,
    ...overrides,
  };
}

function makeHandler({ requestCount = 1, turnstilePass = true, config = {} } = {}) {
  return createIssuerHandler({
    docClient: fakeDocClient(requestCount),
    UpdateCommand: FakeUpdateCommand,
    verifyTurnstile: async () => turnstilePass,
    config: baseConfig(config),
  });
}

function makeEvent({ method = "POST", origin = ORIGIN, body, ip = "9.9.9.9" } = {}) {
  return {
    requestContext: { http: { method, sourceIp: ip } },
    headers: { origin },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

const DEVICE_ID = "device-ABC_123-xyz";
const deviceHashOf = (id) => createHash("sha256").update(id).digest("hex");

test("OPTIONS preflight returns 204 (CORS headers come from the Function URL layer, not the handler)", async () => {
  const res = await makeHandler()(makeEvent({ method: "OPTIONS" }));
  assert.equal(res.statusCode, 204);
  // The handler must NOT emit its own Access-Control-* headers — doing so duplicates
  // the Function URL CORS headers and browsers reject the response.
  assert.equal(res.headers?.["Access-Control-Allow-Origin"], undefined);
});

test("GET /health returns 200 with service info (no auth required)", async () => {
  const res = await makeHandler()(makeEvent({ method: "GET" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.service, "session-token");
});

test("non-POST, non-GET, non-OPTIONS is rejected with 405", async () => {
  const res = await makeHandler()(makeEvent({ method: "DELETE" }));
  assert.equal(res.statusCode, 405);
});

test("a request from a disallowed Origin is rejected with 403", async () => {
  const res = await makeHandler()(
    makeEvent({ origin: "https://evil.example", body: { deviceId: DEVICE_ID, turnstileToken: "t" } }),
  );
  assert.equal(res.statusCode, 403);
});

test("missing deviceId is rejected with 400", async () => {
  const res = await makeHandler()(makeEvent({ body: { turnstileToken: "t" } }));
  assert.equal(res.statusCode, 400);
});

test("an invalid deviceId shape is rejected with 400", async () => {
  const res = await makeHandler()(makeEvent({ body: { deviceId: "bad id with spaces!", turnstileToken: "t" } }));
  assert.equal(res.statusCode, 400);
});

test("a failing Turnstile check is rejected with 403", async () => {
  const res = await makeHandler({ turnstilePass: false })(
    makeEvent({ body: { deviceId: DEVICE_ID, turnstileToken: "bad-token" } }),
  );
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).error, "turnstile_failed");
});

test("exceeding the per-IP issuance limit is rejected with 429", async () => {
  // requestCount above maxIssuancePerHour => checkRateLimit returns not allowed
  const res = await makeHandler({ requestCount: 61 })(
    makeEvent({ body: { deviceId: DEVICE_ID, turnstileToken: "t" } }),
  );
  assert.equal(res.statusCode, 429);
});

test("happy path mints independently scoped chat, blueprint, and MCP tokens", async () => {
  const res = await makeHandler()(makeEvent({ body: { deviceId: DEVICE_ID, turnstileToken: "good" } }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(body.chatToken, "chatToken present");
  assert.ok(body.blueprintToken, "blueprintToken present");

  const chat = verifySessionToken(body.chatToken, SIGNING_KEY, { scope: "chat" });
  assert.equal(chat.valid, true);
  assert.equal(chat.deviceHash, deviceHashOf(DEVICE_ID));

  const bp = verifySessionToken(body.blueprintToken, SIGNING_KEY, { scope: "blueprint" });
  assert.equal(bp.valid, true);
  assert.equal(bp.deviceHash, deviceHashOf(DEVICE_ID));

  const mcp = verifySessionToken(body.mcpToken, SIGNING_KEY, { scope: "mcp" });
  assert.equal(mcp.valid, true);
  assert.equal(mcp.deviceHash, deviceHashOf(DEVICE_ID));
  assert.equal(verifySessionToken(body.mcpToken, SIGNING_KEY, { scope: "chat" }).valid, false);

  // A chat token must NOT be accepted on the blueprint scope and vice versa.
  assert.equal(verifySessionToken(body.chatToken, SIGNING_KEY, { scope: "blueprint" }).valid, false);
});

test("missing TURNSTILE_SECRET fails closed", async () => {
  const handler = createIssuerHandler({
    docClient: fakeDocClient(1),
    UpdateCommand: FakeUpdateCommand,
    // verifyTurnstile would return false, but an empty secret must short-circuit it.
    verifyTurnstile: async () => false,
    config: baseConfig({ turnstileSecret: "" }),
  });
  const res = await handler(makeEvent({ body: { deviceId: DEVICE_ID } }));
  assert.equal(res.statusCode, 503);
});

// ── verifyTurnstile (real implementation, injected fetch) ───────────────────

test("verifyTurnstile returns true when siteverify reports success", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ success: true, hostname: "thechrisgrey.com", action: "session" }),
  });
  assert.equal(await verifyTurnstile("token", "secret", "1.2.3.4", fakeFetch), true);
});

test("verifyTurnstile returns false when siteverify reports failure", async () => {
  const fakeFetch = async () => ({ json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }) });
  assert.equal(await verifyTurnstile("token", "secret", "1.2.3.4", fakeFetch), false);
});

test("verifyTurnstile fails closed when the network call throws", async () => {
  const fakeFetch = async () => {
    throw new Error("network down");
  };
  assert.equal(await verifyTurnstile("token", "secret", "1.2.3.4", fakeFetch), false);
});

for (const invalidResult of [
  { success: true, hostname: "attacker.example", action: "session" },
  { success: true, hostname: "thechrisgrey.com", action: "contact" },
]) {
  test(`rejects Turnstile context ${JSON.stringify(invalidResult)}`, async () => {
    const fakeFetch = async () => ({ ok: true, json: async () => invalidResult });
    assert.equal(await verifyTurnstile("token", "secret", "1.2.3.4", fakeFetch), false);
  });
}

test("a local Turnstile bypass cannot disable verification in Lambda", async () => {
  process.env.ALLOW_LOCAL_TURNSTILE_BYPASS = "true";
  process.env.AWS_LAMBDA_FUNCTION_NAME = "issuer";
  try {
    const handler = makeHandler({ config: { turnstileSecret: "" } });
    assert.equal((await handler(makeEvent({ body: { deviceId: DEVICE_ID } }))).statusCode, 503);
  } finally {
    delete process.env.ALLOW_LOCAL_TURNSTILE_BYPASS;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  }
});
