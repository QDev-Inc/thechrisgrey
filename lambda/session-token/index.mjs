/**
 * Session-token issuer — HTTP Function URL handler (non-streaming JSON).
 *
 * Mints short-lived, scoped session tokens (chat + blueprint) that the chat and
 * blueprint Lambdas verify. This replaces the old model where a single HMAC key
 * was shipped in the browser bundle (VITE_*_SIGNING_KEY) — which authenticated
 * nothing, since any visitor could read the key. The signing key now lives ONLY
 * here (SESSION_TOKEN_KEY) and is never exposed to the client.
 *
 * Flow: Origin allowlist -> per-IP issuance rate limit (cheap) -> Cloudflare
 * Turnstile verification (the real bot gate) -> issue device-bound tokens.
 *
 * The core is a dependency-injected factory (createIssuerHandler) so the real
 * rate-limit + token-issuance paths are unit-tested without touching AWS or the
 * network. The default `handler` wires the real clients and env config.
 */

import { randomUUID } from "crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { checkRateLimit } from "lambda-shared/rateLimit";
import { DEVICE_ID_PATTERN, hashDeviceId } from "lambda-shared/deviceId";
import { issueSessionToken } from "lambda-shared/sessionToken";
import { createLogger } from "lambda-shared/logger";
import { verifyTurnstile, isTurnstileConfigured } from "lambda-shared/turnstile";
import { MetricsCollector } from "lambda-shared/metrics";
import { setRequestContext, captureError, addBreadcrumb, flushSentry } from "lambda-shared/errorTracking";
import { captureProductEvent, flushProductAnalytics } from "lambda-shared/productAnalytics";

export { verifyTurnstile } from "lambda-shared/turnstile";

/** @param {unknown} value */
function isRequestObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {{ deviceId?: unknown }} body */
function readDeviceId(body) {
  return typeof body.deviceId === "string" ? body.deviceId : "";
}

/**
 * Build the issuer handler from injected dependencies.
 * @param {object} deps
 * @param {any} deps.docClient
 * @param {any} deps.UpdateCommand
 * @param {(token:string, secret:string, ip?:string)=>Promise<boolean>} deps.verifyTurnstile
 * @param {{ signingKey: string, turnstileSecret: string, allowedOrigins: string[], rateLimitTable: string, chatTtl: number, blueprintTtl: number, maxIssuancePerHour: number, corsOrigin: string }} deps.config
 * @param {{ record: any, flush: any }} [deps.metrics] - optional MetricsCollector; when omitted (tests) metrics are skipped
 */
export function createIssuerHandler({ docClient, UpdateCommand, verifyTurnstile, config, metrics }) {
  const { signingKey, turnstileSecret, allowedOrigins, rateLimitTable, chatTtl, blueprintTtl, maxIssuancePerHour } =
    config;

  // CORS is handled SOLELY by the Lambda Function URL CORS config (single source
  // of truth). The handler must NOT also emit Access-Control-* headers, or the
  // response carries DUPLICATE Access-Control-Allow-Origin values and browsers
  // reject it ("Failed to fetch") — which silently broke token issuance in prod.
  /** @param {number} statusCode @param {any} body */
  const reply = (statusCode, body) => ({
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  /** @param {any} event */
  return async function issuerHandler(event) {
    const requestId = event.headers?.["x-request-id"] || randomUUID();
    const method = event.requestContext?.http?.method;

    if (method === "OPTIONS") {
      // Preflight is normally answered by the Function URL CORS layer (the handler
      // isn't invoked for OPTIONS when CORS is configured); this is a safe fallback.
      return { statusCode: 204, body: "" };
    }
    if (!signingKey || !isTurnstileConfigured(turnstileSecret)) {
      return reply(503, { error: "service_unavailable" });
    }

    // Health check (no auth required — used by post-deploy checks and monitoring)
    if (method === "GET") {
      return reply(200, { ok: true, service: "session-token", version: "1.0.0" });
    }

    if (method !== "POST") {
      return reply(405, { error: "method_not_allowed" });
    }

    const origin = event.headers?.origin || event.headers?.Origin || "";
    const log = createLogger(requestId, { service: "session-token" });
    setRequestContext(requestId, "session-token", { method });

    try {
      if (allowedOrigins.length && !allowedOrigins.includes(origin)) {
        log.info("origin_rejected", { origin });
        metrics?.record("OriginRejected");
        return reply(403, { error: "forbidden_origin" });
      }

      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return reply(400, { error: "invalid_json" });
      }

      if (!isRequestObject(body)) return reply(400, { error: "invalid_request" });
      const deviceId = readDeviceId(body);
      if (!DEVICE_ID_PATTERN.test(deviceId)) {
        metrics?.record("InvalidDeviceId");
        return reply(400, { error: "invalid_device_id" });
      }

      const clientIp = event.requestContext?.http?.sourceIp || "unknown";

      // Cheap gate first: per-IP issuance rate limit (conserves Turnstile calls).
      const rl = await checkRateLimit(docClient, UpdateCommand, {
        table: rateLimitTable,
        ip: clientIp,
        prefix: "session-",
        maxRequests: maxIssuancePerHour,
        windowSeconds: 3600,
        ttlBuffer: 3600,
        requestId,
      });
      if (!rl.allowed) {
        log.info("issuance_rate_limited");
        metrics?.record("IssuanceRateLimited");
        return reply(429, { error: "rate_limited" });
      }
      addBreadcrumb("ratelimit", "issuance_allowed");

      // Real bot gate: Cloudflare Turnstile. Skipped only when no secret is set
      // (local/dev), mirroring the empty-key-disables convention in hmac.mjs.
      if (turnstileSecret) {
        const ok = await verifyTurnstile(body.turnstileToken, turnstileSecret, clientIp);
        if (!ok) {
          log.info("turnstile_failed");
          metrics?.record("TurnstileFailed");
          return reply(403, { error: "turnstile_failed" });
        }
        addBreadcrumb("turnstile", "challenge_verified");
      }

      const deviceHash = hashDeviceId(deviceId);
      const chatToken = issueSessionToken({ deviceHash, scope: "chat" }, signingKey, chatTtl);
      const blueprintToken = issueSessionToken({ deviceHash, scope: "blueprint" }, signingKey, blueprintTtl);

      log.info("tokens_issued");
      metrics?.record("TokensIssued");
      captureProductEvent("SessionTokenIssued", { outcome: "success" });
      return reply(200, {
        chatToken,
        blueprintToken,
        mcpToken: issueSessionToken({ deviceHash, scope: "mcp" }, signingKey, chatTtl),
        mcpExpiresIn: chatTtl,
        chatExpiresIn: chatTtl,
        blueprintExpiresIn: blueprintTtl,
      });
    } catch (error) {
      log.error("handler_error", {
        error: error instanceof Error ? error.name : "Unknown",
        message: error instanceof Error ? error.message : "",
      });
      captureError(error, { handler: "session-token" });
      return reply(500, { error: "internal_error" });
    } finally {
      await metrics?.flush();
      await flushSentry();
      await flushProductAnalytics();
    }
  };
}

// ── Real wiring (module scope so warm invocations reuse clients) ─────────────

const REGION = process.env.AWS_REGION || "us-east-1";
const SIGNING_KEY = process.env.SESSION_TOKEN_KEY || "";
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || "";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "https://thechrisgrey.com";
const RATE_LIMIT_TABLE =
  process.env.SESSION_RATE_LIMIT_TABLE || process.env.CHAT_RATE_LIMIT_TABLE || "thechrisgrey-chat-ratelimit";
const CHAT_TTL = parseInt(process.env.SESSION_CHAT_TTL || "1800", 10); // 30 min
const BLUEPRINT_TTL = parseInt(process.env.SESSION_BLUEPRINT_TTL || "600", 10); // 10 min
const MAX_ISSUANCE_PER_HOUR = parseInt(process.env.SESSION_MAX_ISSUANCE || "60", 10);

const startupLog = createLogger(null, { service: "session-token" });

if (!SIGNING_KEY) {
  startupLog.warn("startup_warning", {
    message: "SESSION_TOKEN_KEY not set — issued tokens will not be verifiable by the chat/blueprint Lambdas",
  });
}
if (!TURNSTILE_SECRET) {
  startupLog.warn("startup_warning", {
    message: "TURNSTILE_SECRET not set — Turnstile verification DISABLED (dev only)",
  });
}

const dynamoClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cloudwatchClient = new CloudWatchClient({ region: REGION });
// A single collector is reused across warm invocations. This is safe because
// the handler awaits `metrics.flush()` in a finally block on every request and
// flush() drains its buffer, so no request re-emits a prior request's metrics.
const metrics = new MetricsCollector(cloudwatchClient, "TheChrisGrey/SessionToken");

export const handler = createIssuerHandler({
  docClient,
  UpdateCommand,
  verifyTurnstile,
  config: {
    signingKey: SIGNING_KEY,
    turnstileSecret: TURNSTILE_SECRET,
    corsOrigin: CORS_ORIGIN,
    allowedOrigins: CORS_ORIGIN.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    rateLimitTable: RATE_LIMIT_TABLE,
    chatTtl: CHAT_TTL,
    blueprintTtl: BLUEPRINT_TTL,
    maxIssuancePerHour: MAX_ISSUANCE_PER_HOUR,
  },
  metrics,
});

export default { handler };
