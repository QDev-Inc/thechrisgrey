import crypto from "node:crypto";
import { createClient as createSanityClient } from "@sanity/client";
import { BedrockAgentRuntimeClient, RetrieveCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { ApplyGuardrailCommand, BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { createInferenceClient } from "lambda-shared/inference";
import { createKnowledgeClient } from "lambda-shared/knowledge";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { checkRateLimit, checkCostBudget } from "lambda-shared/rateLimit";
import { createLogger } from "lambda-shared/logger";
import { verifySessionToken } from "lambda-shared/sessionToken";
import { MetricsCollector } from "lambda-shared/metrics";
import { setRequestContext, captureError, addBreadcrumb, flushSentry } from "lambda-shared/errorTracking";
import { captureProductEvent, flushProductAnalytics } from "lambda-shared/productAnalytics";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { buildMcpServer } from "./server.mjs";
import { buildSearchBlogMcpTool } from "./tools/searchBlog.mjs";
import { buildGetBlogPostMcpTool } from "./tools/getBlogPost.mjs";
import { buildAskAltiMcpTool } from "./tools/askAlti.mjs";
import { createKbCache } from "./kbCache.mjs";

const REGION = process.env.AWS_REGION || "us-east-1";
const RATE_LIMIT_TABLE = process.env.CHAT_RATE_LIMIT_TABLE || "thechrisgrey-chat-ratelimit";
const RATE_LIMIT_MAX = Number(process.env.MCP_RATE_LIMIT_MAX || 60);
const RATE_LIMIT_WINDOW_SECONDS = Number(process.env.MCP_RATE_LIMIT_WINDOW || 3600);
const MODEL_ID = process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const KB_ID = process.env.KB_ID || "";
const GUARDRAIL_ID = process.env.GUARDRAIL_ID || "";
const GUARDRAIL_VERSION = process.env.GUARDRAIL_VERSION || "";
const SANITY_PROJECT_ID = process.env.SANITY_PROJECT_ID || "";
const SANITY_DATASET = process.env.SANITY_DATASET || "production";
const SESSION_TOKEN_KEY = process.env.SESSION_TOKEN_KEY || "";
const SESSION_TOKEN_SCOPE = "mcp";

// Long-lived clients (reused across invocations within a warm Lambda container).
const ddbBase = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbBase);
const bedrockClient = createInferenceClient(new BedrockRuntimeClient({ region: REGION }), ApplyGuardrailCommand);
const agentClient = createKnowledgeClient(new BedrockAgentRuntimeClient({ region: REGION }));
const cloudwatchClient = new CloudWatchClient({ region: REGION });
const sanityClient = SANITY_PROJECT_ID
  ? createSanityClient({
      projectId: SANITY_PROJECT_ID,
      dataset: SANITY_DATASET,
      apiVersion: "2024-10-01",
      useCdn: true,
      timeout: 10000,
    })
  : null;
const kbCache = createKbCache();

// CloudWatch metrics via the shared MetricsCollector (same pattern as
// chat-stream and blueprint). The namespace is dedicated so MCP alarms
// are isolated from other services.
const METRICS_NAMESPACE = "TheChrisGrey/McpServer";

/** @param {string} ip */
function hashIp(ip) {
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 24);
}

/** @param {any} raw */
function parseBody(raw) {
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return undefined; // explicit: malformed body
  }
}

/** @param {number} status @param {any} payload @param {string} [_requestOrigin] */
function jsonRpcResponse(status, payload, _requestOrigin) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  };
}

/**
 * Validate the parsed JSON-RPC body. Returns a 400 JSON-RPC rejection response
 * for a malformed/non-object body, or `null` when the body is a valid object.
 * @param {any} body - Result of parseBody (undefined = parse error, null = empty, object = ok).
 * @param {string} requestOrigin
 * @returns {{ statusCode: number, headers: any, body: string } | null}
 */
function validateRpcBody(body, requestOrigin) {
  if (body === undefined) {
    return jsonRpcResponse(
      400,
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      requestOrigin,
    );
  }
  if (body === null || typeof body !== "object") {
    return jsonRpcResponse(
      400,
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } },
      requestOrigin,
    );
  }
  return null;
}

/**
 * Enforce the session-token auth lockdown on `tools/call` requests. Returns a
 * JSON-RPC rejection response (401/403) when the bearer token is missing or
 * invalid, or `null` when the request is authenticated and should proceed to
 * tool dispatch. Discovery methods (`initialize`, `tools/list`, `ping`) are
 * not gated here — only methods that invoke Bedrock / KB / Sanity.
 *
 * @param {any} body - Parsed JSON-RPC request body.
 * @param {Record<string, string>} headers - Request headers (case-insensitive lookup done upstream).
 * @param {string} requestOrigin - Origin to echo back on the CORS response.
 * @param {{ record: (name: string, value?: number, unit?: string) => void }} metrics
 * @param {string} requestId
 * @returns {Promise<{ statusCode: number, headers: any, body: string } | null>}
 */
async function enforceToolsCallAuth(body, headers, requestOrigin, metrics, requestId) {
  if (body.method !== "tools/call") return null;

  const authHeader = headers?.authorization || headers?.Authorization || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!bearer) {
    metrics.record("McpAuthRejection");
    addBreadcrumb("auth", "missing_token", { method: body.method });
    return jsonRpcResponse(
      401,
      {
        jsonrpc: "2.0",
        id: body.id ?? null,
        error: {
          code: -32001,
          message: "Unauthorized: a valid Authorization: Bearer <token> is required for tools/call.",
        },
      },
      requestOrigin,
    );
  }

  const tokenResult = verifySessionToken(bearer, SESSION_TOKEN_KEY, { scope: SESSION_TOKEN_SCOPE });
  if (!tokenResult.valid) {
    metrics.record("McpAuthRejection");
    addBreadcrumb("auth", "invalid_token", { method: body.method, reason: tokenResult.error });
    return jsonRpcResponse(
      403,
      {
        jsonrpc: "2.0",
        id: body.id ?? null,
        error: {
          code: -32001,
          message: "Forbidden: the supplied session token was rejected.",
          data: { reason: tokenResult.error },
        },
      },
      requestOrigin,
    );
  }
  addBreadcrumb("auth", "request_authenticated", { method: body.method });
  metrics.record("McpAuthSessionToken");
  return enforceCostBudget(body, requestOrigin, metrics, requestId);
}

/**
 * Apply the per-source-IP rate limit. Returns a 429 JSON-RPC response when the
 * caller has exceeded the limit, or `null` when the request is allowed (or the
 * limiter is unavailable, which fails closed).
 * @param {string} sourceIp
 * @param {string} requestOrigin
 * @param {any} log
 * @param {{ record: (name: string, value?: number, unit?: string) => void, flush: () => Promise<void> }} metrics
 * @param {string} requestId
 * @returns {Promise<{ statusCode: number, headers: any, body: string } | null>}
 */
async function applyRateLimit(sourceIp, requestOrigin, log, metrics, requestId) {
  try {
    const rlResult = await checkRateLimit(docClient, UpdateCommand, {
      table: RATE_LIMIT_TABLE,
      ip: hashIp(sourceIp),
      prefix: "mcp-",
      maxRequests: RATE_LIMIT_MAX,
      windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
      ttlBuffer: 3600,
      requestId,
    });
    if (rlResult && !rlResult.allowed) {
      metrics.record("McpRateLimitRejection");
      await metrics.flush();
      return jsonRpcResponse(
        429,
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32000,
            message: "Rate limit exceeded. Try again in an hour.",
            data: { retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS },
          },
        },
        requestOrigin,
      );
    }
  } catch (err) {
    // An unexpected limiter exception must not enable unmetered access.
    log.error("mcp_ratelimit_error", { message: err instanceof Error ? err.message : String(err) });
    return jsonRpcResponse(
      503,
      { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Temporarily unavailable" } },
      requestOrigin,
    );
  }
  return null;
}

/** @param {any} body @param {string} origin @param {any} metrics @param {string} requestId */
async function enforceCostBudget(body, origin, metrics, requestId) {
  if (body.method !== "tools/call") return null;
  const allowed = await checkCostBudget(docClient, UpdateCommand, {
    table: RATE_LIMIT_TABLE,
    service: "mcp",
    hourly: 100,
    daily: 400,
    requestId,
  });
  if (allowed) return null;
  metrics.record("McpCostBudgetRejection");
  await metrics.flush();
  return jsonRpcResponse(
    429,
    {
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: { code: -32000, message: "Shared usage limit reached. Please try again later." },
    },
    origin,
  );
}

/** @param {any} event */
export const handler = async (event) => {
  const method = event?.requestContext?.http?.method || "POST";
  const path = event?.rawPath || "/";
  const requestId = event.headers?.["x-request-id"] || event?.requestContext?.requestId || crypto.randomUUID();
  const log = createLogger(requestId, { service: "mcp-server" });
  const metrics = new MetricsCollector(cloudwatchClient, METRICS_NAMESPACE);
  setRequestContext(requestId, "mcp-server", { method, path });
  // Capture the request Origin once so every response (including rejections)
  // echoes an allowlisted origin instead of a wildcard.
  const requestOrigin = event.headers?.origin || event.headers?.Origin || "";

  // CORS preflight
  if (method === "OPTIONS") {
    return { statusCode: 204, headers: {}, body: "" };
  }

  // Health probe (handy for monitoring and Route 53 health checks).
  if (method === "GET" && path === "/health") {
    return jsonRpcResponse(200, { ok: true, server: "alti-mcp", version: "1.0.0" }, requestOrigin);
  }

  if (method !== "POST") {
    return jsonRpcResponse(
      405,
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Only POST is accepted on this endpoint." },
      },
      requestOrigin,
    );
  }

  // Rate limit per source IP
  const sourceIp = event?.requestContext?.http?.sourceIp || "unknown";
  const rateLimitRejection = await applyRateLimit(sourceIp, requestOrigin, log, metrics, requestId);
  if (rateLimitRejection) return rateLimitRejection;

  addBreadcrumb("ratelimit", "rate_limit_checked");

  const body = parseBody(event.body);
  const bodyRejection = validateRpcBody(body, requestOrigin);
  if (bodyRejection) return bodyRejection;

  // ── Auth lockdown ──────────────────────────────────────────────────────
  // `tools/call` invokes Bedrock / Sanity / KB retrieval — server-side cost
  // and PII-adjacent retrieval — so it requires a valid server-issued session
  // token (same model as chat-stream). Discovery methods (`initialize`,
  // `tools/list`, `ping`) remain open so MCP clients can negotiate the
  // protocol and list available tools before presenting credentials. With
  // SESSION_TOKEN_KEY unset the verifier fails closed in production and open
  // in local/dev (see sessionToken.mjs), preserving the dev-loop.
  const authRejection = await enforceToolsCallAuth(body, event.headers, requestOrigin, metrics, requestId);
  if (authRejection) {
    await metrics.flush();
    return authRejection;
  }

  try {
    const tools = [];
    if (sanityClient) {
      tools.push(buildSearchBlogMcpTool({ sanityClient, metrics, requestId }));
      tools.push(buildGetBlogPostMcpTool({ sanityClient, metrics, requestId }));
    }
    tools.push(
      buildAskAltiMcpTool({
        bedrockClient,
        ConverseCommand,
        agentClient,
        RetrieveCommand,
        kbId: KB_ID,
        modelId: MODEL_ID,
        guardrailId: GUARDRAIL_ID,
        guardrailVersion: GUARDRAIL_VERSION,
        kbCache,
        metrics,
        requestId,
      }),
    );

    const server = buildMcpServer({
      tools,
      serverInfo: { name: "alti-mcp", version: "1.0.0" },
    });

    const rpcResponse = await server.handle(body, { requestId, sourceIp });

    // Notifications (null response) should return 202 Accepted per MCP guidance.
    if (rpcResponse === null) {
      await metrics.flush();
      return { statusCode: 202, headers: {}, body: "" };
    }

    metrics.record("McpRequestComplete");
    captureProductEvent("McpToolCalled", { method: body.method, hasResult: !("error" in rpcResponse) });
    addBreadcrumb("rpc", "request_complete", { id: body.id });
    await metrics.flush();
    return jsonRpcResponse(200, rpcResponse, requestOrigin);
  } catch (error) {
    log.error("mcp_handler_error", {
      error: error instanceof Error ? error.name : String(error),
      message: error instanceof Error ? error.message : "",
    });
    metrics.record("McpHandlerError");
    captureError(error, { handler: "mcp-server", method: body?.method });
    await metrics.flush();
    return jsonRpcResponse(
      500,
      {
        jsonrpc: "2.0",
        id: body?.id ?? null,
        error: { code: -32603, message: "Internal error" },
      },
      requestOrigin,
    );
  } finally {
    await flushSentry();
    await flushProductAnalytics();
  }
};
