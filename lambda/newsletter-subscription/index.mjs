import { randomUUID } from "crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { checkRateLimit } from "lambda-shared/rateLimit";
import { createLogger } from "lambda-shared/logger";
import { readSecretString } from "lambda-shared/secrets";
import { verifyTurnstile, isTurnstileConfigured } from "lambda-shared/turnstile";
import { createConfirmationService } from "./confirmation.mjs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_API_URL = "https://api.resend.com";

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function getHeader(event, name) {
  return event.headers?.[name] || event.headers?.[name.toLowerCase()] || event.headers?.[name.toUpperCase()] || "";
}

function parseOrigins(value) {
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function extractApiKey(secret) {
  try {
    const parsed = JSON.parse(secret);
    if (typeof parsed.RESEND_API_KEY === "string" && parsed.RESEND_API_KEY) return parsed.RESEND_API_KEY;
  } catch {
    // Plaintext API keys are supported for a minimal Secrets Manager setup.
  }
  return secret;
}

async function resendRequest(fetchImpl, apiKey, path, init) {
  return fetchImpl(`${RESEND_API_URL}${path}`, {
    ...init,
    signal: AbortSignal.timeout(8000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...init.headers,
    },
  });
}

/**
 * Activate a contact only after a single-use mailbox confirmation is consumed.
 */
export async function subscribeContact({ apiKey, email, segmentId, fetchImpl = fetch }) {
  const createResponse = await resendRequest(fetchImpl, apiKey, "/contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      unsubscribed: false,
      ...(segmentId ? { segments: [{ id: segmentId }] } : {}),
    }),
  });

  if (!createResponse.ok && createResponse.status !== 409) {
    throw new Error(`resend_contact_${createResponse.status}`);
  }

  if (createResponse.status === 409) {
    const contactPath = `/contacts/${encodeURIComponent(email)}`;
    const reactivateResponse = await resendRequest(fetchImpl, apiKey, contactPath, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unsubscribed: false }),
    });
    if (!reactivateResponse.ok) throw new Error(`resend_contact_update_${reactivateResponse.status}`);

    if (segmentId) {
      const segmentResponse = await resendRequest(
        fetchImpl,
        apiKey,
        `${contactPath}/segments/${encodeURIComponent(segmentId)}`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
      );
      if (!segmentResponse.ok && segmentResponse.status !== 409) {
        throw new Error(`resend_segment_${segmentResponse.status}`);
      }
    }
  }
}

/**
 * Create the newsletter handler with injectable integrations for unit tests.
 */
export function createNewsletterHandler({
  checkRateLimitImpl,
  verifyTurnstileImpl,
  getApiKey,
  requestConfirmation,
  confirmSubscription,
  config,
}) {
  async function handleConfirmation(token, event, requestId) {
    try {
      const limit = await checkRateLimitImpl(event.requestContext?.http?.sourceIp || "unknown", requestId);
      if (!limit.allowed) return reply(429, { error: "rate_limited" });
      const result = await confirmSubscription({ apiKey: await getApiKey(), token });
      return result.ok ? reply(200, result) : reply(400, { error: "confirmation_invalid" });
    } catch {
      return reply(502, { error: "confirmation_unavailable" });
    }
  }
  return async function newsletterHandler(event) {
    const method = event.requestContext?.http?.method;
    if (method === "OPTIONS") return { statusCode: 204, body: "" };
    if (!isTurnstileConfigured(config.turnstileSecret)) return reply(503, { error: "service_unavailable" });
    if (method === "GET") return reply(200, { ok: true, service: "newsletter-subscription", version: "1.0.0" });
    if (method !== "POST") return reply(405, { error: "method_not_allowed" });

    const requestId = getHeader(event, "x-request-id") || randomUUID();
    const log = createLogger(requestId, { service: "newsletter-subscription" });
    const origin = getHeader(event, "origin");
    if (config.allowedOrigins.length && !config.allowedOrigins.includes(origin)) {
      log.info("origin_rejected", { origin });
      return reply(403, { error: "forbidden_origin" });
    }

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return reply(400, { error: "invalid_json" });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply(400, { error: "invalid_request" });
    if (body.confirmationToken !== undefined) {
      return handleConfirmation(body.confirmationToken, event, requestId);
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!EMAIL_PATTERN.test(email) || email.length > 254) return reply(400, { error: "invalid_email" });
    const source = body.source ?? "newsletter";
    if (source !== "newsletter" && source !== "blueprint") return reply(400, { error: "invalid_source" });
    const segmentId = source === "blueprint" ? config.blueprintSegmentId : config.segmentId;
    if (!segmentId) return reply(503, { error: "service_unavailable" });

    const clientIp = event.requestContext?.http?.sourceIp || "unknown";
    const limit = await checkRateLimitImpl(clientIp, requestId);
    if (!limit.allowed) {
      log.info("rate_limited");
      return reply(429, { error: "rate_limited" });
    }

    if (config.turnstileSecret) {
      const isValid = await verifyTurnstileImpl(body.turnstileToken || "", config.turnstileSecret, clientIp);
      if (!isValid) {
        log.info("turnstile_failed");
        return reply(403, { error: "turnstile_failed" });
      }
    }

    try {
      await requestConfirmation({ apiKey: await getApiKey(), email, segmentId, source, origin });
      log.info("confirmation_requested", { source });
      return reply(202, { ok: true, confirmationRequired: true });
    } catch (error) {
      log.error("subscription_failed", { error: error instanceof Error ? error.name : "Unknown" });
      return reply(502, { error: "subscription_unavailable" });
    }
  };
}

const REGION = process.env.AWS_REGION || "us-east-1";
const rateLimitClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const secretsClient = new SecretsManagerClient({ region: REGION });
const RATE_LIMIT_TABLE = process.env.NEWSLETTER_RATE_LIMIT_TABLE || "thechrisgrey-chat-ratelimit";
const RESEND_SECRET_ARN = process.env.RESEND_API_KEY_SECRET_ARN || "";
const confirmation = createConfirmationService({
  client: rateLimitClient,
  table: process.env.NEWSLETTER_CONFIRMATION_TABLE || "",
  from: process.env.RESEND_FROM_EMAIL || "",
  subscribe: subscribeContact,
});

export const handler = createNewsletterHandler({
  checkRateLimitImpl: (ip, requestId) =>
    checkRateLimit(rateLimitClient, UpdateCommand, {
      table: RATE_LIMIT_TABLE,
      ip,
      prefix: "newsletter-",
      maxRequests: Number(process.env.NEWSLETTER_RATE_LIMIT_MAX || 5),
      windowSeconds: 3600,
      requestId,
    }),
  verifyTurnstileImpl: (token, secret, ip) => verifyTurnstile(token, secret, ip, fetch, { action: "newsletter" }),
  getApiKey: async () => extractApiKey(await readSecretString(secretsClient, GetSecretValueCommand, RESEND_SECRET_ARN)),
  requestConfirmation: confirmation.request,
  confirmSubscription: confirmation.confirm,
  config: {
    allowedOrigins: parseOrigins(process.env.CORS_ORIGIN || "https://thechrisgrey.com"),
    turnstileSecret: process.env.TURNSTILE_SECRET || "",
    segmentId: process.env.RESEND_NEWSLETTER_SEGMENT_ID || "",
    blueprintSegmentId: process.env.RESEND_BLUEPRINT_SEGMENT_ID || "",
  },
});
