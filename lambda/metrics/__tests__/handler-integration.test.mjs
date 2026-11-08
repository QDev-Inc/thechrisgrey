/**
 * Metrics handler INTEGRATION test.
 *
 * Exercises the REAL `handler` in index.mjs end-to-end across its full HTTP
 * surface: CORS preflight (none — metrics has no OPTIONS handler), POST /vitals,
 * POST /csp-report, GET /health (Cognito-auth'd), rate limiting, route dispatch,
 * input validation, CloudWatch metric publishing, and error handling. External
 * services (CloudWatch, DynamoDB, Cognito) are intercepted at the SDK prototype
 * level so the real handler body runs against scripted responses.
 *
 * WHAT IS REAL
 *   - The entire handler body: event parsing, rate limiting via checkRateLimit,
 *     route dispatch, validation via validateVitals/validateCspUri, CloudWatch
 *     PutMetricData/GetMetricStatistics calls, Cognito token validation, health
 *     aggregation, CSP bucketing, and all response shaping.
 *
 * WHERE THE FAKE SITS
 *   CloudWatchClient.prototype.send returns scripted PutMetricData / GetMetricStatistics
 *   responses. DynamoDBDocumentClient.prototype.send returns a scripted rate-limit
 *   count. CognitoIdentityProviderClient.prototype.send returns a verified admin user.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { accessToken, configureCognito, SUBJECT } from "../../shared/__fixtures__/cognito.mjs";
configureCognito((await import("lambda-shared/auth")).getCognitoVerifier);
const adminToken = accessToken();

// ── Isolate from AWS BEFORE importing the handler ──────────────────────────
delete process.env.AWS_ACCESS_KEY_ID;
delete process.env.AWS_SECRET_ACCESS_KEY;
delete process.env.AWS_SESSION_TOKEN;
delete process.env.AWS_PROFILE;
process.env.AWS_SHARED_CREDENTIALS_FILE = "/dev/null";
process.env.AWS_CONFIG_FILE = "/dev/null";
process.env.AWS_EC2_METADATA_DISABLED = "true";
process.env.AWS_REGION = "us-east-1";
process.env.ADMIN_ALLOWLIST = "admin@altivum.ai";

const { CloudWatchClient, PutMetricDataCommand, GetMetricStatisticsCommand } =
  await import("@aws-sdk/client-cloudwatch");
const { CognitoIdentityProviderClient } = await import("@aws-sdk/client-cognito-identity-provider");
const { DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb");

// ── SDK prototype overrides ─────────────────────────────────────────────────

let cloudwatchBehavior = null;
let dynamoBehavior = null;
let cognitoBehavior = null;
let cloudwatchCalls = [];

CloudWatchClient.prototype.send = async function cloudwatchStub(command) {
  cloudwatchCalls.push(command);
  if (cloudwatchBehavior) return cloudwatchBehavior(command);
  // Default: empty success for PutMetricData, empty Datapoints for GetMetricStatistics
  if (command instanceof GetMetricStatisticsCommand) {
    return { Datapoints: [] };
  }
  return {};
};

DynamoDBDocumentClient.prototype.send = async function dynamoStub() {
  if (dynamoBehavior) return dynamoBehavior();
  return { Attributes: { requestCount: 1 } };
};

CognitoIdentityProviderClient.prototype.send = async function cognitoStub() {
  if (cognitoBehavior) return cognitoBehavior();
  return {
    Username: "admin",
    UserAttributes: [
      { Name: "sub", Value: SUBJECT },
      { Name: "email", Value: "admin@altivum.ai" },
      { Name: "email_verified", Value: "true" },
    ],
  };
};

// Mute console output during tests
const origLog = console.log;
const origError = console.error;
console.log = () => {};
console.error = () => {};

const { handler } = await import("../index.mjs");

// Restore console after import
console.log = origLog;
console.error = origError;

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeEvent({ method = "POST", path = "/vitals", body, ip = "9.9.9.9", headers = {} } = {}) {
  return {
    requestContext: { http: { method, sourceIp: ip, requestId: "test-req-1" } },
    rawPath: path,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  };
}

function parseBody(res) {
  return JSON.parse(res.body);
}

// ── Tests: POST /vitals ─────────────────────────────────────────────────────

test("POST /vitals with valid LCP data returns 200 and publishes CloudWatch metric", async () => {
  cloudwatchCalls = [];
  const res = await handler(makeEvent({ body: { name: "LCP", value: 1200, rating: "good" } }));
  assert.equal(res.statusCode, 200);
  const body = parseBody(res);
  assert.equal(body.received, true);

  // Verify a PutMetricDataCommand was sent with the correct namespace
  const putCmds = cloudwatchCalls.filter((c) => c instanceof PutMetricDataCommand);
  assert.equal(putCmds.length, 1);
  assert.equal(putCmds[0].input.Namespace, "TheChrisGrey/SiteMetrics");
  assert.equal(putCmds[0].input.MetricData[0].MetricName, "LCP");
  assert.equal(putCmds[0].input.MetricData[0].Value, 1200);
  assert.equal(putCmds[0].input.MetricData[1].Value, 1200);
  assert.equal(putCmds[0].input.MetricData[1].Dimensions, undefined);
  assert.deepEqual(putCmds[0].input.MetricData[0].Dimensions, [{ Name: "Rating", Value: "good" }]);
});

test("POST /vitals with valid CLS data (no rating) returns 200 with no dimensions", async () => {
  cloudwatchCalls = [];
  const res = await handler(makeEvent({ body: { name: "CLS", value: 0.1 } }));
  assert.equal(res.statusCode, 200);
  const putCmds = cloudwatchCalls.filter((c) => c instanceof PutMetricDataCommand);
  assert.equal(putCmds.length, 1);
  assert.deepEqual(putCmds[0].input.MetricData[0].Dimensions, []);
});

test("POST /vitals with missing name returns 400", async () => {
  const res = await handler(makeEvent({ body: { value: 10 } }));
  assert.equal(res.statusCode, 400);
  const body = parseBody(res);
  assert.match(body.error, /name and numeric value are required/);
});

test("POST /vitals with non-numeric value returns 400", async () => {
  const res = await handler(makeEvent({ body: { name: "LCP", value: "fast" } }));
  assert.equal(res.statusCode, 400);
  const body = parseBody(res);
  assert.match(body.error, /name and numeric value are required/);
});

test("POST /vitals with out-of-range value returns 400", async () => {
  const res = await handler(makeEvent({ body: { name: "LCP", value: 60001 } }));
  assert.equal(res.statusCode, 400);
  const body = parseBody(res);
  assert.match(body.error, /finite number between 0 and 60000/);
});

test("POST /vitals with unknown metric name returns 400", async () => {
  const res = await handler(makeEvent({ body: { name: "BOGUS", value: 10 } }));
  assert.equal(res.statusCode, 400);
  const body = parseBody(res);
  assert.match(body.error, /Invalid metric name/);
});

test("POST /vitals with invalid JSON body returns 400", async () => {
  const res = await handler(makeEvent({ body: "{not valid json" }));
  assert.equal(res.statusCode, 400);
  const body = parseBody(res);
  assert.equal(body.error, "Invalid JSON");
});

// ── Tests: POST /csp-report ─────────────────────────────────────────────────

test("POST /csp-report with valid blocked-uri returns 200 and publishes CSPViolation metric", async () => {
  cloudwatchCalls = [];
  const res = await handler(
    makeEvent({
      path: "/csp-report",
      body: { "csp-report": { "blocked-uri": "inline" } },
    }),
  );
  assert.equal(res.statusCode, 200);
  const body = parseBody(res);
  assert.equal(body.received, true);

  const putCmds = cloudwatchCalls.filter((c) => c instanceof PutMetricDataCommand);
  assert.equal(putCmds.length, 1);
  assert.equal(putCmds[0].input.MetricData[0].MetricName, "CSPViolation");
  assert.equal(putCmds[0].input.MetricData[0].Value, 1);
  // The blocked-uri is bucketed into one of 10 buckets to cap dimension cardinality
  assert.match(putCmds[0].input.MetricData[0].Dimensions[0].Value, /^csp-bucket-[0-9]$/);
});

test("POST /csp-report with http blocked-uri returns 200", async () => {
  const res = await handler(
    makeEvent({
      path: "/csp-report",
      body: { "csp-report": { "blocked-uri": "https://evil.example.com" } },
    }),
  );
  assert.equal(res.statusCode, 200);
});

test("POST /csp-report with invalid blocked-uri returns 400", async () => {
  const res = await handler(
    makeEvent({
      path: "/csp-report",
      body: { "csp-report": { "blocked-uri": "javascript:alert(1)" } },
    }),
  );
  assert.equal(res.statusCode, 400);
  const body = parseBody(res);
  assert.match(body.error, /Invalid blocked-uri format/);
});

test("POST /csp-report with invalid JSON returns 400", async () => {
  const res = await handler(makeEvent({ path: "/csp-report", body: "{bad json" }));
  assert.equal(res.statusCode, 400);
  const body = parseBody(res);
  assert.equal(body.error, "Invalid JSON");
});

// ── Tests: GET /health ──────────────────────────────────────────────────────

test("GET /health without Authorization header returns 401", async () => {
  const res = await handler(makeEvent({ method: "GET", path: "/health" }));
  assert.equal(res.statusCode, 401);
  const body = parseBody(res);
  assert.equal(body.error, "Unauthorized");
});

test("GET /health with valid Cognito token returns 200 with aggregated health data", async () => {
  // Script CloudWatch GetMetricStatistics to return some datapoints
  cloudwatchBehavior = (cmd) => {
    if (cmd instanceof GetMetricStatisticsCommand) {
      const metricName = cmd.input.MetricName;
      if (["LCP", "CLS", "INP", "FCP", "TTFB"].includes(metricName)) {
        return { Datapoints: [{ Average: 1200, SampleCount: 50 }] };
      }
      if (["KBRetrievalLatency", "BedrockInvocationLatency", "TotalRequestLatency"].includes(metricName)) {
        return { Datapoints: [{ Average: 250, SampleCount: 100 }] };
      }
      // Distinct sums for the four retrieval outcomes so kbSuccessRate is an
      // arithmetic assertion rather than a coincidence of equal stubs: an empty
      // or unparseable retrieval grounds a turn no better than a failure, so all
      // four belong in the denominator (60 of 100 → "60.0").
      const KB_OUTCOME_SUMS = {
        KBRetrievalSuccess: 60,
        KBRetrievalFailure: 20,
        KBRetrievalEmpty: 15,
        KBRetrievalUnparseable: 5,
      };
      if (metricName in KB_OUTCOME_SUMS) {
        return { Datapoints: [{ Sum: KB_OUTCOME_SUMS[metricName] }] };
      }
      // Every other sum-based metric
      return { Datapoints: [{ Sum: 5 }] };
    }
    return {};
  };

  try {
    const res = await handler(
      makeEvent({
        method: "GET",
        path: "/health",
        headers: { authorization: `Bearer ${adminToken}` },
      }),
    );
    assert.equal(res.statusCode, 200);
    const body = parseBody(res);

    // Verify vitals structure
    assert.ok(body.vitals, "vitals object present");
    assert.equal(body.vitals.lcp.average, 1200);
    assert.equal(body.vitals.lcp.count, 50);

    // Verify chat metrics
    assert.ok(body.chat, "chat object present");
    assert.equal(body.chat.kbFailures, 20);
    assert.equal(body.chat.kbSuccesses, 60);
    assert.equal(body.chat.kbEmpties, 15);
    assert.equal(body.chat.kbUnparseables, 5);
    assert.equal(body.chat.kbSuccessRate, "60.0");
    // Stream + mid-stream + pre-stream, all stubbed at 5. A turn blocked after
    // text had already shipped counts under its own name; the panel wants the sum.
    assert.equal(body.chat.guardrailInterventions, 15);

    // Verify costs
    assert.ok(body.costs, "costs object present");
    assert.equal(body.costs.bedrockInputTokens, 5);

    // Verify security
    assert.ok(body.security, "security object present");
    assert.equal(body.security.cspViolations, 5);

    assert.equal(body.periodHours, 24);
    assert.ok(body.timestamp, "timestamp present");
  } finally {
    cloudwatchBehavior = null;
  }
});

test("GET /health with invalid Cognito token returns 401", async () => {
  cognitoBehavior = () => {
    throw Object.assign(new Error("Not authorized"), { name: "NotAuthorizedException" });
  };
  try {
    const res = await handler(
      makeEvent({
        method: "GET",
        path: "/health",
        headers: { authorization: "Bearer bad-token" },
      }),
    );
    assert.equal(res.statusCode, 401);
  } finally {
    cognitoBehavior = null;
  }
});

// ── Tests: Rate limiting ────────────────────────────────────────────────────

test("rate-limited POST /vitals returns 429", async () => {
  dynamoBehavior = () => ({ Attributes: { requestCount: 999 } });
  try {
    const res = await handler(makeEvent({ body: { name: "LCP", value: 1200 } }));
    assert.equal(res.statusCode, 429);
    const body = parseBody(res);
    assert.equal(body.error, "Too many requests");
  } finally {
    dynamoBehavior = null;
  }
});

test("rate-limited POST /csp-report returns 429", async () => {
  dynamoBehavior = () => ({ Attributes: { requestCount: 999 } });
  try {
    const res = await handler(makeEvent({ path: "/csp-report", body: { "csp-report": { "blocked-uri": "inline" } } }));
    assert.equal(res.statusCode, 429);
    const body = parseBody(res);
    assert.equal(body.error, "Too many requests");
  } finally {
    dynamoBehavior = null;
  }
});

// ── Tests: Routing ──────────────────────────────────────────────────────────

test("unknown route returns 404", async () => {
  const res = await handler(makeEvent({ method: "GET", path: "/unknown" }));
  assert.equal(res.statusCode, 404);
  const body = parseBody(res);
  assert.equal(body.error, "Not found");
});

test("unsupported method on known path returns 404", async () => {
  const res = await handler(makeEvent({ method: "DELETE", path: "/vitals" }));
  assert.equal(res.statusCode, 404);
});

// ── Tests: Error resilience ─────────────────────────────────────────────────

test("CloudWatch put failure on /vitals returns 202 (accepted but deferred)", async () => {
  cloudwatchBehavior = () => {
    throw new Error("CloudWatch throttled");
  };
  try {
    const res = await handler(makeEvent({ body: { name: "LCP", value: 1200 } }));
    assert.equal(res.statusCode, 202);
    const body = parseBody(res);
    assert.equal(body.received, true);
    assert.match(body.note, /deferred/);
  } finally {
    cloudwatchBehavior = null;
  }
});
