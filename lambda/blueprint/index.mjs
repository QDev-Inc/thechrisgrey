/**
 * Blueprint Lambda — HTTP Function URL handler (streaming).
 *
 * Flow:
 *   1. Handle CORS preflight.
 *   2. Verify HMAC signature.
 *   3. Parse payload and rate-limit by deviceHash (1 blueprint / 30 days).
 *   4. Open a streaming NDJSON response and delegate to engine.generateBlueprint
 *      with an onProgress callback so status events + Opus token deltas flow
 *      to the client in real time.
 *   5. Emit a final {type:"complete", output, meta} (success) or
 *      {type:"error", error, message} (failure) and close the stream.
 *
 * Wire format: newline-delimited JSON. Each line is one event:
 *   {"type":"ready","requestId":"..."}
 *   {"type":"status","phase":"generating","attempt":1,"examplesUsed":3}
 *   {"type":"token","text":"..."}
 *   ...
 *   {"type":"complete","ok":true,"output":{...},"meta":{...}}
 *
 * The engine is transport-agnostic (see engine.mjs). A future MCP tool wrapper
 * under lambda/mcp-server imports the same engine directly and does not go
 * through this handler.
 */

import { randomUUID } from "crypto";
import { ApplyGuardrailCommand, BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { createInferenceClient } from "lambda-shared/inference";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { createClient as createSanityClient } from "@sanity/client";
import { checkRateLimit } from "lambda-shared/rateLimit";
import { validateDeviceId, hashDeviceId } from "lambda-shared/deviceId";

import { authenticateRequest } from "lambda-shared/requestAuth";
import { MetricsCollector } from "lambda-shared/metrics";
import { createLogger } from "lambda-shared/logger";
import { setRequestContext, captureError, addBreadcrumb, flushSentry } from "lambda-shared/errorTracking";
import { captureProductEvent, flushProductAnalytics } from "lambda-shared/productAnalytics";
import { generateBlueprint } from "./engine.mjs";
import { resolveOpusDeadlineMs } from "./bedrock.mjs";
import { createGoldenExamplesFetcher } from "./goldenExamples.mjs";
import { BlueprintInputSchema } from "./schema.mjs";
import { createBlueprintQuota } from "./quota.mjs";

const REGION = process.env.AWS_REGION || "us-east-1";
const SIGNING_KEY = process.env.BLUEPRINT_SIGNING_KEY || "";
const SESSION_TOKEN_KEY = process.env.SESSION_TOKEN_KEY || "";
const RATE_LIMIT_TABLE =
  process.env.BLUEPRINT_RATE_LIMIT_TABLE || process.env.CHAT_RATE_LIMIT_TABLE || "thechrisgrey-chat-ratelimit";
// Max raw body size accepted before JSON parsing. Guards against oversized spec
// payloads that would otherwise consume Bedrock Opus budget / trigger deep
// validation on adversarial input. Default 1 MiB; override via env for tuning.
const MAX_BODY_BYTES = Number(process.env.BLUEPRINT_MAX_BODY_BYTES || 1024 * 1024);

const bedrockClient = createInferenceClient(new BedrockRuntimeClient({ region: REGION }), ApplyGuardrailCommand, {
  timeoutMs: 45000,
});
const dynamoClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cloudwatchClient = new CloudWatchClient({ region: REGION });

const sanityProjectId = process.env.SANITY_PROJECT_ID || "k5950b3w";
const sanityDataset = process.env.SANITY_DATASET || "production";
const sanityClient = sanityProjectId
  ? createSanityClient({
      projectId: sanityProjectId,
      dataset: sanityDataset,
      apiVersion: process.env.SANITY_API_VERSION || "2024-01-01",
      perspective: "published",
      useCdn: true,
      timeout: 4000,
    })
  : null;

// Module-scope fetcher so the 5-min cache persists across warm invocations.
const examplesFetcher = sanityClient ? createGoldenExamplesFetcher(sanityClient) : undefined;

if (!SESSION_TOKEN_KEY && !SIGNING_KEY) {
  createLogger(null, { service: "blueprint" }).warn("startup_warning", {
    message: "Neither SESSION_TOKEN_KEY nor BLUEPRINT_SIGNING_KEY set — request authentication disabled",
  });
}

/** @param {string|null} requestId @param {string} event @param {any} [extra] */
function logStructured(requestId, event, extra = {}) {
  createLogger(requestId, { service: "blueprint" }).info(event, extra);
}

// eslint-disable-next-line complexity -- streaming handler: auth, rate limit, guardrail, engine, NDJSON framing, error mapping
export const handler = awslambda.streamifyResponse(async (event, responseStream, context) => {
  // Health check (no auth required — used by post-deploy checks and monitoring)
  const healthMethod = event.requestContext?.http?.method;
  const healthPath = event.rawPath || event.requestContext?.http?.path || "/";
  if (healthMethod === "GET" && healthPath === "/health") {
    responseStream.write(JSON.stringify({ ok: true, service: "blueprint", version: "1.0.0" }));
    responseStream.end();
    return;
  }

  const requestId = event.headers?.["x-request-id"] || randomUUID();
  const metrics = new MetricsCollector(cloudwatchClient, "TheChrisGrey/Blueprint");
  const start = Date.now();
  setRequestContext(requestId, "blueprint", { method: event.requestContext?.http?.method, path: event.rawPath });

  // Anchor a single absolute Opus deadline = start + remaining - buffer. The
  // engine re-derives each attempt's timeout from this shared deadline
  // (opusTimeoutForDeadline), so retries and pre-Opus latency all draw from one
  // budget and the internal AbortController always fires before the Lambda
  // hard-timeout — surfacing a graceful opus_timeout — regardless of the deployed
  // --timeout. `start` (now) + getRemainingTimeInMillis() is the invariant Lambda
  // deadline, so anchoring once here holds for the whole request. Returns null
  // off-Lambda (no context), where the engine falls back to the static cap.
  const opusDeadlineMs = resolveOpusDeadlineMs(context?.getRemainingTimeInMillis?.(), start);

  // Tracks whether the response metadata (status + headers) has already been
  // committed via HttpResponseStream.from. Once true, we can only keep writing
  // bytes — not change status or headers — so late errors become NDJSON events.
  let streamOpened = false;
  let ndjsonMode = false;
  /** @type {ReturnType<typeof createBlueprintQuota>|undefined} */
  let quota;

  // Commit headers + status for a buffered-style JSON response and end.
  /** @param {number} statusCode @param {any} body */
  const closeWithJson = (statusCode, body) => {
    if (streamOpened) return; // caller bug — defensive no-op
    const withMeta = awslambda.HttpResponseStream.from(responseStream, {
      statusCode,
      headers: { "Content-Type": "application/json" },
    });
    streamOpened = true;
    try {
      withMeta.write(JSON.stringify(body));
    } finally {
      withMeta.end();
    }
  };

  // Commit the streaming NDJSON response headers and return a writer that
  // serializes each event as one JSON line. Idempotent.
  const openNdjsonStream = () => {
    if (!streamOpened) {
      awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 200,
        headers: {
          "Content-Type": "application/x-ndjson",
          "Cache-Control": "no-cache, no-transform",
        },
      });
      streamOpened = true;
      ndjsonMode = true;
    }
    return (/** @type {any} */ ev) => {
      try {
        responseStream.write(JSON.stringify(ev) + "\n");
      } catch {
        // Stream may be torn down mid-write; swallow so engine can continue.
      }
    };
  };

  try {
    // CORS preflight
    if (event.requestContext?.http?.method === "OPTIONS") {
      const preflight = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 204,
        headers: {},
      });
      streamOpened = true;
      preflight.end();
      return;
    }

    if (event.requestContext?.http?.method !== "POST") {
      closeWithJson(405, { error: "method_not_allowed" });
      return;
    }

    // Accept EITHER a server-issued blueprint-scoped session token (new model) OR
    // the legacy request-body HMAC signature (transition window). See requestAuth.
    const auth = authenticateRequest(event, {
      sessionKey: SESSION_TOKEN_KEY,
      scope: "blueprint",
      legacyKey: SIGNING_KEY,
      legacySigOptions: {
        signatureHeader: "x-blueprint-signature",
        timestampHeader: "x-blueprint-timestamp",
      },
    });
    if (!auth.valid) {
      metrics.record("AuthRejection");
      logStructured(requestId, "auth_rejection", { method: auth.method, reason: auth.error });
      closeWithJson(401, { error: "unauthorized" });
      return;
    }
    // Watch the legacy path drain to zero before retiring the bundled HMAC key.
    metrics.record(auth.method === "token" ? "AuthSessionToken" : "AuthLegacySignature");
    addBreadcrumb("auth", "request_authenticated", { method: auth.method });

    // Body-size guard: reject oversized payloads BEFORE parsing the spec JSON
    // or invoking the engine. Prevents adversarial/costly inputs from reaching
    // Bedrock Opus. The raw body is measured in bytes (not characters) so
    // multi-byte UTF-8 is accounted for correctly.
    const rawBody = typeof event.body === "string" ? event.body : "";
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
      metrics.record("BlueprintBodyTooLarge");
      logStructured(requestId, "body_too_large", {
        bytes: Buffer.byteLength(rawBody, "utf8"),
        limit: MAX_BODY_BYTES,
      });
      closeWithJson(413, {
        error: "request_too_large",
        message: "The submitted spec exceeds the maximum allowed size.",
      });
      return;
    }

    // Parse body
    let payload;
    try {
      payload = JSON.parse(event.body || "{}");
    } catch {
      closeWithJson(400, { error: "invalid_json" });
      return;
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      closeWithJson(400, { error: "invalid_input" });
      return;
    }
    const { spec, deviceId: rawDeviceId } = payload;
    if (!spec || typeof spec !== "object") {
      closeWithJson(400, { error: "missing_spec" });
      return;
    }

    const deviceId = validateDeviceId(rawDeviceId);
    if (!deviceId) {
      closeWithJson(400, { error: "invalid_device_id" });
      return;
    }
    const deviceHash = hashDeviceId(deviceId);
    if (auth.method !== "token" || auth.deviceHash !== deviceHash) {
      closeWithJson(401, { error: "device_mismatch" });
      return;
    }
    const parsedSpec = BlueprintInputSchema.safeParse(spec);
    if (!parsedSpec.success) {
      closeWithJson(400, { error: "invalid_input", message: "Please review the required blueprint fields." });
      return;
    }
    for (const limit of [
      { ip: event.requestContext?.http?.sourceIp || "unknown", prefix: "blueprint-attempt-", maxRequests: 5 },
      { ip: "service", prefix: "blueprint-budget-", maxRequests: 20 },
      { ip: "service", prefix: "blueprint-daily-", maxRequests: 20, windowSeconds: 86400 },
    ]) {
      const attempt = await checkRateLimit(docClient, UpdateCommand, {
        table: RATE_LIMIT_TABLE,
        windowSeconds: 3600,
        ...limit,
        requestId,
      });
      if (!attempt.allowed) {
        closeWithJson(attempt.remaining < 0 ? 503 : 429, {
          error: attempt.remaining < 0 ? "temporarily_unavailable" : "rate_limited",
          message: "Blueprint generation is temporarily unavailable. Please try again later.",
        });
        return;
      }
    }
    quota = createBlueprintQuota(docClient, UpdateCommand, {
      table: RATE_LIMIT_TABLE,
      deviceHash: auth.deviceHash,
      requestId,
    });
    const reservation = await quota.reserve();
    if (!reservation.allowed) {
      metrics.record("BlueprintRateLimited");
      logStructured(requestId, "rate_limited", { deviceHash });
      closeWithJson(reservation.unavailable ? 503 : 429, {
        error: reservation.unavailable ? "temporarily_unavailable" : "rate_limited",
        message: reservation.unavailable
          ? "We couldn't check your allowance. Please try again later."
          : "A blueprint is already generating or your allowance for this 30-day window has been used.",
      });
      return;
    }

    // ── Stream opens here. From this point forward, every result — success
    //    or failure — is delivered as NDJSON events. HTTP status is locked
    //    at 200; the client distinguishes outcomes by the terminal event.
    const writeEvent = openNdjsonStream();
    writeEvent({ type: "ready", requestId });

    const logger = {
      info: (/** @type {string} */ code, /** @type {any} */ extra) => logStructured(requestId, code, extra),
      warn: (/** @type {string} */ code, /** @type {any} */ extra) => logStructured(requestId, code, extra),
      error: (/** @type {string} */ code, /** @type {any} */ extra) => logStructured(requestId, code, extra),
    };

    const result = await generateBlueprint(parsedSpec.data, {
      tier: "free",
      bedrockClient,
      sanityClient,
      examplesFetcher,
      logger,
      requestId,
      opusDeadlineMs,
      onProgress: writeEvent,
    });

    // Record metrics regardless of ok/not-ok
    if (result?.meta?.opus_tokens) {
      metrics.record("BlueprintOpusInputTokens", result.meta.opus_tokens.input_tokens);
      metrics.record("BlueprintOpusOutputTokens", result.meta.opus_tokens.output_tokens);
    }
    if (result?.meta?.haiku_tokens) {
      metrics.record("BlueprintHaikuInputTokens", result.meta.haiku_tokens.input_tokens);
      metrics.record("BlueprintHaikuOutputTokens", result.meta.haiku_tokens.output_tokens);
    }

    const totalMs = Date.now() - start;

    if (!result.ok) {
      let message = "Something went wrong. Please try again.";
      if (result.error === "invalid_input") {
        metrics.record("BlueprintInvalidInput");
        message = "Your blueprint spec failed validation. Please review required fields.";
      } else if (result.error === "validation_failed") {
        metrics.record("BlueprintValidationFailure");
        message = "The model returned a blueprint that didn't meet our quality bar. Please try again.";
        logStructured(requestId, "blueprint_validation_failed", {
          issues: result.details?.slice(0, 5),
        });
      } else if (result.error === "opus_timeout") {
        metrics.record("BlueprintOpusTimeout");
        message = "Generation took too long. Please try again.";
      } else if (result.error === "guardrail_intervened") {
        metrics.record("BlueprintGuardrailIntervention");
        message = "That request couldn't be processed. Try describing a different system to architect.";
        logStructured(requestId, "blueprint_guardrail_intervened", {});
      } else if (result.error === "guardrail_unavailable") {
        metrics.record("BlueprintGuardrailUnavailable");
        message = "We couldn't complete a safety check just now. Please try again in a moment.";
        logStructured(requestId, "blueprint_guardrail_unavailable", {});
      } else {
        metrics.record("BlueprintGenerationError");
      }
      writeEvent({
        type: "error",
        error: result.error,
        message,
        meta: { requestId, latency_ms: totalMs },
      });
      responseStream.end();
      return;
    }

    await quota.commit();
    metrics.record("BlueprintGenerated");
    if (result.meta?.haiku_verdict && result.meta.haiku_verdict.ok === false) {
      metrics.record("BlueprintHaikuFlagged");
    }
    metrics.record("BlueprintLatency", totalMs, "Milliseconds");
    logStructured(requestId, "blueprint_generated", {
      totalMs,
      category: spec?.category,
      attempts: result.meta?.attempts,
      opus_tokens: result.meta?.opus_tokens,
      haiku_verdict: result.meta?.haiku_verdict?.confidence,
    });

    captureProductEvent("BlueprintGenerated", { outcome: "success", latencyMs: totalMs, category: spec?.category });

    writeEvent({
      type: "complete",
      ok: true,
      output: result.output,
      meta: {
        requestId,
        tier: result.meta?.tier,
        latency_ms: totalMs,
        examples_used: result.meta?.examples_used,
        haiku_verdict: result.meta?.haiku_verdict,
      },
    });
    responseStream.end();
  } catch (error) {
    logStructured(requestId, "handler_error", {
      error: error instanceof Error ? error.name : String(error),
      message: error instanceof Error ? error.message : "",
      stack: error instanceof Error ? error.stack || "" : "",
    });
    metrics.record("BlueprintHandlerError");
    captureError(error, { handler: "blueprint", path: event.rawPath });

    if (streamOpened && ndjsonMode) {
      // Stream already live — surface the error as an NDJSON event.
      try {
        responseStream.write(
          JSON.stringify({
            type: "error",
            error: "internal_error",
            message: "An unexpected error occurred.",
          }) + "\n",
        );
      } catch {
        // Already torn down.
      }
      try {
        responseStream.end();
      } catch {
        /* already ended */
      }
    } else if (!streamOpened) {
      closeWithJson(500, { error: "internal_error" });
    } else {
      // streamOpened but not NDJSON (e.g., OPTIONS path already ended). Nothing to do.
      try {
        responseStream.end();
      } catch {
        /* already ended */
      }
    }
  } finally {
    await quota?.release();
    await metrics.flush();
    await flushSentry();
    await flushProductAnalytics();
  }
});

export default { handler };
