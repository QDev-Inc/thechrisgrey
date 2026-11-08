/**
 * MCP server auth lockdown (VAL-SEC-006).
 *
 * Asserts the `tools/call` method requires a valid server-issued session token
 * before reaching Bedrock / KB retrieval, while discovery methods (`initialize`,
 * `tools/list`, `ping`) remain open. Also asserts CORS is tightened to the
 * production origin (never `*`) and echoes only allowlisted request origins.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// --- Isolate from AWS BEFORE importing the handler -------------------------
delete process.env.AWS_ACCESS_KEY_ID;
delete process.env.AWS_SECRET_ACCESS_KEY;
delete process.env.AWS_SESSION_TOKEN;
delete process.env.AWS_PROFILE;
process.env.AWS_SHARED_CREDENTIALS_FILE = "/dev/null";
process.env.AWS_CONFIG_FILE = "/dev/null";
process.env.AWS_EC2_METADATA_DISABLED = "true";
process.env.AWS_REGION = "us-east-1";

delete process.env.SANITY_PROJECT_ID;
const SESSION_KEY = "mcp-lockdown-session-key";
process.env.SESSION_TOKEN_KEY = SESSION_KEY;

const { DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb");
const { BedrockRuntimeClient } = await import("@aws-sdk/client-bedrock-runtime");
const { BedrockAgentRuntimeClient } = await import("@aws-sdk/client-bedrock-agent-runtime");

// DynamoDB rate-limit check always passes.
DynamoDBDocumentClient.prototype.send = async () => ({ Attributes: { requestCount: 1 } });
// Bedrock clients should never be reached in the rejection tests — throw if they are.
let bedrockCalled = false;
BedrockRuntimeClient.prototype.send = async () => {
  bedrockCalled = true;
  throw new Error("Bedrock must not be invoked without a valid session token");
};
BedrockAgentRuntimeClient.prototype.send = async () => {
  bedrockCalled = true;
  throw new Error("Bedrock Agent must not be invoked without a valid session token");
};

const { handler } = await import("../index.mjs");
const { issueSessionToken } = await import("lambda-shared/sessionToken");

function makeEvent({ method = "POST", body, headers = {} } = {}) {
  return {
    requestContext: { http: { method, sourceIp: "9.9.9.9", requestId: "r1" } },
    rawPath: "/",
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  };
}

function parseBody(res) {
  return JSON.parse(res.body);
}

function validTokenHeaders(scope = "mcp") {
  const token = issueSessionToken({ deviceHash: "a".repeat(64), scope }, SESSION_KEY, 300);
  return { authorization: `Bearer ${token}` };
}

test("tools/call without an Authorization header returns 401 and does NOT invoke Bedrock", async () => {
  bedrockCalled = false;
  const res = await handler(
    makeEvent({
      headers: {},
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "ask_alti", arguments: { question: "Who is Christian?" } },
      },
    }),
  );
  assert.equal(res.statusCode, 401);
  assert.equal(bedrockCalled, false, "Bedrock was invoked despite missing auth");
  const body = parseBody(res);
  assert.equal(body.error.code, -32001);
  assert.match(body.error.message, /Unauthorized/);
});

test("tools/call with an invalid bearer token returns 403 and does NOT invoke Bedrock", async () => {
  bedrockCalled = false;
  const res = await handler(
    makeEvent({
      headers: { authorization: "Bearer v1.0.chat.deadbeef.deadbeef" },
      body: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "ask_alti", arguments: { question: "Who is Christian?" } },
      },
    }),
  );
  assert.equal(res.statusCode, 403);
  assert.equal(bedrockCalled, false, "Bedrock was invoked despite invalid auth");
  const body = parseBody(res);
  assert.equal(body.error.code, -32001);
  assert.ok(body.error.data?.reason, "rejection reason is surfaced");
});

test("tools/call with a wrong-scope (blueprint) token is rejected with 403", async () => {
  bedrockCalled = false;
  const res = await handler(
    makeEvent({
      headers: validTokenHeaders("blueprint"),
      body: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "ask_alti", arguments: { question: "Who is Christian?" } },
      },
    }),
  );
  assert.equal(res.statusCode, 403);
  assert.equal(bedrockCalled, false);
  const body = parseBody(res);
  assert.equal(body.error.data?.reason, "scope_mismatch");
});

test("initialize remains open (no auth required) — MCP discovery handshake", async () => {
  const res = await handler(
    makeEvent({
      headers: {},
      body: { jsonrpc: "2.0", id: 4, method: "initialize", params: {} },
    }),
  );
  assert.equal(res.statusCode, 200);
  const body = parseBody(res);
  assert.equal(body.result.protocolVersion !== undefined, true);
});

test("tools/list remains open (no auth required) — MCP tool discovery", async () => {
  const res = await handler(
    makeEvent({
      headers: {},
      body: { jsonrpc: "2.0", id: 5, method: "tools/list" },
    }),
  );
  assert.equal(res.statusCode, 200);
  const body = parseBody(res);
  assert.ok(Array.isArray(body.result.tools));
  assert.ok(body.result.tools.some((t) => t.name === "ask_alti"));
});

test("ping remains open (no auth required)", async () => {
  const res = await handler(
    makeEvent({
      headers: {},
      body: { jsonrpc: "2.0", id: 6, method: "ping" },
    }),
  );
  assert.equal(res.statusCode, 200);
});

test("CORS Access-Control-Allow-Origin is never '*' on a tools/call rejection", async () => {
  const res = await handler(
    makeEvent({
      headers: {},
      body: { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "ask_alti" } },
    }),
  );
  assert.notEqual(res.headers["Access-Control-Allow-Origin"], "*");
  assert.equal(res.headers["Access-Control-Allow-Origin"], undefined);
});

test("a valid mcp-scoped token is admitted past auth (reaches tool dispatch, not 401/403)", async () => {
  // ask_alti with a 2-char question triggers the tool's own input validation,
  // returning an isError result (not 401/403) — proving auth admitted it.
  const res = await handler(
    makeEvent({
      headers: validTokenHeaders("mcp"),
      body: {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "ask_alti", arguments: { question: "hi" } },
      },
    }),
  );
  assert.equal(res.statusCode, 200);
  const body = parseBody(res);
  assert.equal(body.error, undefined);
  assert.ok(body.result?.content, "tool dispatched and returned a result");
});
