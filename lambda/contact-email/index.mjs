import { randomUUID } from "crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { checkRateLimit } from "lambda-shared/rateLimit";
import { createLogger } from "lambda-shared/logger";
import { readSecretString } from "lambda-shared/secrets";
import { verifyTurnstile } from "lambda-shared/turnstile";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_API_URL = "https://api.resend.com/emails";

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function escapeHtml(value) {
  return value.replace(
    /[&<>'"]/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[char],
  );
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

function validateBody(body) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (name.length < 2 || name.length > 100) return null;
  if (!EMAIL_PATTERN.test(email) || email.length > 254) return null;
  if (message.length < 10 || message.length > 5000) return null;
  return { name, email, message };
}

export async function sendContactEmail({ apiKey, from, recipient, contact, requestId, fetchImpl = fetch }) {
  const response = await fetchImpl(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `contact-${requestId}`,
    },
    body: JSON.stringify({
      from,
      to: [recipient],
      reply_to: contact.email,
      subject: `Website inquiry from ${contact.name}`,
      text: `Name: ${contact.name}\nEmail: ${contact.email}\n\n${contact.message}`,
      html: `<p><strong>Name:</strong> ${escapeHtml(contact.name)}</p><p><strong>Email:</strong> ${escapeHtml(contact.email)}</p><hr><pre style="white-space:pre-wrap;font:inherit">${escapeHtml(contact.message)}</pre>`,
      tags: [{ name: "source", value: "thechrisgrey-contact" }],
    }),
  });
  if (!response.ok) throw new Error(`resend_email_${response.status}`);
}

/**
 * Create the contact-form handler with injectable integrations for testing.
 */
export function createContactEmailHandler({ checkRateLimitImpl, verifyTurnstileImpl, getApiKey, sendEmail, config }) {
  return async function contactEmailHandler(event) {
    const method = event.requestContext?.http?.method;
    if (method === "OPTIONS") return { statusCode: 204, body: "" };
    if (method === "GET") return reply(200, { ok: true, service: "contact-email", version: "1.0.0" });
    if (method !== "POST") return reply(405, { error: "method_not_allowed" });

    const requestId = getHeader(event, "x-request-id") || randomUUID();
    const log = createLogger(requestId, { service: "contact-email" });
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

    if (typeof body.website === "string" && body.website.trim()) return reply(202, { ok: true });

    const contact = validateBody(body);
    if (!contact) return reply(400, { error: "invalid_request" });

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

    if (!config.from || !config.recipient) {
      log.error("contact_service_misconfigured");
      return reply(503, { error: "service_unavailable" });
    }

    try {
      const apiKey = await getApiKey();
      await sendEmail({ apiKey, from: config.from, recipient: config.recipient, contact, requestId });
      log.info("contact_accepted");
      return reply(202, { ok: true });
    } catch (error) {
      log.error("contact_delivery_failed", { error: error instanceof Error ? error.name : "Unknown" });
      return reply(502, { error: "delivery_unavailable" });
    }
  };
}

const REGION = process.env.AWS_REGION || "us-east-1";
const rateLimitClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const secretsClient = new SecretsManagerClient({ region: REGION });
const RATE_LIMIT_TABLE = process.env.CONTACT_RATE_LIMIT_TABLE || "thechrisgrey-chat-ratelimit";
const RESEND_SECRET_ARN = process.env.RESEND_API_KEY_SECRET_ARN || "";

export const handler = createContactEmailHandler({
  checkRateLimitImpl: (ip, requestId) =>
    checkRateLimit(rateLimitClient, UpdateCommand, {
      table: RATE_LIMIT_TABLE,
      ip,
      prefix: "contact-",
      maxRequests: Number(process.env.CONTACT_RATE_LIMIT_MAX || 5),
      windowSeconds: 3600,
      requestId,
    }),
  verifyTurnstileImpl: verifyTurnstile,
  getApiKey: async () => extractApiKey(await readSecretString(secretsClient, GetSecretValueCommand, RESEND_SECRET_ARN)),
  sendEmail: sendContactEmail,
  config: {
    allowedOrigins: parseOrigins(process.env.CORS_ORIGIN || "https://thechrisgrey.com"),
    turnstileSecret: process.env.TURNSTILE_SECRET || "",
    from: process.env.RESEND_FROM_EMAIL || "",
    recipient: process.env.CONTACT_RECIPIENT_EMAIL || "",
  },
});
