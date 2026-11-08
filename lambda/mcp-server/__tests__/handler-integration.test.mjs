/**
 * MCP-server handler INTEGRATION test.
 *
 * Exercises the REAL `handler` in index.mjs end-to-end: CORS preflight, health
 * probe, JSON-RPC method routing (initialize / tools/list / tools/call), rate
 * limiting, and error shaping. External services (DynamoDB, Bedrock, Sanity) are
 * intercepted at the SDK prototype level so the real handler body runs against
 * scripted responses — no reimplemented logic.
 *
 * WHAT IS REAL
 *   - The entire handler body: event parsing, CORS, method routing, rate-limit
 *     call, body parsing, tool wiring, MCP server construction + handle, response
 *     shaping.
 *   - The REAL buildMcpServer + REAL tool descriptors (searchBlog, getBlogPost,
 *     askAlti) are constructed with the real factory functions.
 *
 * WHERE THE FAKE SITS
 *   DynamoDB send() returns a scripted rate-limit count.
 *   BedrockRuntime / BedrockAgentRuntime send() return scripted Converse/Retrieve
 *   responses. Sanity is disabled (no SANITY_PROJECT_ID) so blog tools are not
 *   wired — this keeps the integration test focused on the handler's transport
 *   and protocol contract without coupling to the Sanity API shape.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// ── Intercept AWS SDK clients BEFORE importing the handler ──────────────────
delete process.env.AWS_ACCESS_KEY_ID;
delete process.env.AWS_SECRET_ACCESS_KEY;
delete process.env.AWS_SESSION_TOKEN;
delete process.env.AWS_PROFILE;
process.env.AWS_SHARED_CREDENTIALS_FILE = "/dev/null";
process.env.AWS_CONFIG_FILE = "/dev/null";
process.env.AWS_EC2_METADATA_DISABLED = "true";
process.env.AWS_REGION = "us-east-1";

// Disable Sanity so only askAlti is wired (no blog tools).
delete process.env.SANITY_PROJECT_ID;

// Configure a session-token signing key so the tools/call auth lockdown uses
// real verification. The handler reads SESSION_TOKEN_KEY at module load.
const SESSION_KEY = "mcp-session-key-for-tests";
process.env.SESSION_TOKEN_KEY = SESSION_KEY;

const { DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb");
const { BedrockRuntimeClient } = await import("@aws-sdk/client-bedrock-runtime");
const { BedrockAgentRuntimeClient } = await import("@aws-sdk/client-bedrock-agent-runtime");

let dynamoBehavior = null;
let bedrockBehavior = null;
let agentBehavior = null;

// Override DynamoDBDocumentClient.prototype.send — the handler uses docClient.send()
// for rate limiting, and DocumentClient has its own send method (not inherited from
// DynamoDBClient).
DynamoDBDocumentClient.prototype.send = async function (cmd) {
  if (dynamoBehavior) return dynamoBehavior(cmd);
  return { Attributes: { requestCount: 1 } };
};

BedrockRuntimeClient.prototype.send = async function (cmd) {
  if (bedrockBehavior) return bedrockBehavior(cmd);
  throw new Error("BedrockRuntime behavior not set for this test");
};

BedrockAgentRuntimeClient.prototype.send = async function (cmd) {
  if (agentBehavior) return agentBehavior(cmd);
  throw new Error("BedrockAgentRuntime behavior not set for this test");
};

const { handler } = await import("../index.mjs");
const { issueSessionToken } = await import("lambda-shared/sessionToken");

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeEvent({ method = "POST", path = "/", body, ip = "9.9.9.9", headers = {} } = {}) {
  return {
    requestContext: {
      http: { method, sourceIp: ip, requestId: "test-req-1" },
    },
    rawPath: path,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  };
}

function parseBody(res) {
  return JSON.parse(res.body);
}

/** A valid chat-scoped session token for the tools/call auth lockdown. */
function authHeaders() {
  const token = issueSessionToken({ deviceHash: "a".repeat(64), scope: "mcp" }, SESSION_KEY, 300);
  return { authorization: `Bearer ${token}` };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test("OPTIONS fallback leaves CORS to the Function URL for every origin", async () => {
  for (const origin of [undefined, "https://thechrisgrey.com", "https://evil.example.com"]) {
    const res = await handler(makeEvent({ method: "OPTIONS", headers: origin ? { origin } : {} }));
    assert.equal(res.statusCode, 204);
    assert.equal(res.headers["Access-Control-Allow-Origin"], undefined);
  }
});

test("GET /health returns 200 with server info", async () => {
  const res = await handler(makeEvent({ method: "GET", path: "/health" }));
  assert.equal(res.statusCode, 200);
  const body = parseBody(res);
  assert.equal(body.ok, true);
  assert.equal(body.server, "alti-mcp");
  assert.ok(typeof body.version === "string");
});

test("non-POST, non-OPTIONS, non-GET-health returns 405 JSON-RPC error", async () => {
  const res = await handler(makeEvent({ method: "DELETE" }));
  assert.equal(res.statusCode, 405);
  const body = parseBody(res);
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.error.code, -32600);
});

test("initialize returns protocol version and server info", async () => {
  const res = await handler(
    makeEvent({
      body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    }),
  );
  assert.equal(res.statusCode, 200);
  const body = parseBody(res);
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, 1);
  assert.ok(body.result.protocolVersion, "protocolVersion present");
  assert.equal(body.result.serverInfo.name, "alti-mcp");
  assert.deepEqual(body.result.capabilities, { tools: {} });
});

test("tools/list returns the askAlti tool descriptor", async () => {
  // initialize first (not strictly required by our stateless server, but realistic)
  await handler(
    makeEvent({
      body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    }),
  );

  const res = await handler(
    makeEvent({
      body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
    }),
  );
  assert.equal(res.statusCode, 200);
  const body = parseBody(res);
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, 2);
  assert.ok(Array.isArray(body.result.tools), "tools is an array");
  const toolNames = body.result.tools.map((t) => t.name);
  assert.ok(toolNames.includes("ask_alti"), "ask_alti tool is present");
  // Blog tools should NOT be present since SANITY_PROJECT_ID is unset
  assert.ok(!toolNames.includes("search_blog"), "search_blog absent without Sanity config");
  assert.ok(!toolNames.includes("get_blog_post"), "get_blog_post absent without Sanity config");
});

test("tools/call ask_alti returns a text response from Bedrock", async () => {
  // Mock Bedrock Converse to return a simple text response.
  bedrockBehavior = async () => ({
    output: {
      message: {
        role: "assistant",
        content: [{ text: "Christian Perez is the founder of Altivum Inc." }],
      },
    },
    usage: { inputTokens: 50, outputTokens: 20 },
    stopReason: "end_turn",
  });

  // Mock Bedrock Agent Retrieve to return KB context.
  agentBehavior = async () => ({
    retrievalResults: [{ content: { text: "Christian Perez founded Altivum Inc." }, score: 0.95 }],
  });

  try {
    const res = await handler(
      makeEvent({
        headers: authHeaders(),
        body: {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "ask_alti",
            arguments: { question: "Who is Christian Perez?" },
          },
        },
      }),
    );

    assert.equal(res.statusCode, 200);
    const body = parseBody(res);
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.id, 3);
    assert.ok(body.result?.content, "result has content");
    assert.equal(body.result.content[0].type, "text");
    assert.ok(body.result.content[0].text.includes("Christian Perez"), "response mentions Christian Perez");
  } finally {
    bedrockBehavior = null;
    agentBehavior = null;
  }
});

test("malformed JSON body returns -32700 parse error", async () => {
  const res = await handler(
    makeEvent({
      body: "{not valid json",
    }),
  );
  assert.equal(res.statusCode, 400);
  const body = parseBody(res);
  assert.equal(body.error.code, -32700);
});

test("null body returns -32600 invalid request", async () => {
  const res = await handler(
    makeEvent({
      body: "null",
    }),
  );
  assert.equal(res.statusCode, 400);
  const body = parseBody(res);
  assert.equal(body.error.code, -32600);
});

test("rate-limited request returns 429 with retry info", async () => {
  dynamoBehavior = async () => ({ Attributes: { requestCount: 999 } });
  try {
    const res = await handler(
      makeEvent({
        body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      }),
    );
    assert.equal(res.statusCode, 429);
    const body = parseBody(res);
    assert.equal(body.error.code, -32000);
    assert.ok(body.error.data?.retryAfterSeconds, "retryAfterSeconds present");
  } finally {
    dynamoBehavior = null;
  }
});

test("notification (no id) returns 202 Accepted", async () => {
  const res = await handler(
    makeEvent({
      body: { jsonrpc: "2.0", method: "notifications/initialized" },
    }),
  );
  assert.equal(res.statusCode, 202);
  assert.equal(res.body, "");
});
