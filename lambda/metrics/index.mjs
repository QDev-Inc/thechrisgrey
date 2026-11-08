import { CloudWatchClient, PutMetricDataCommand, GetMetricStatisticsCommand } from "@aws-sdk/client-cloudwatch";
import { CognitoIdentityProviderClient, GetUserCommand } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createHash, randomUUID } from "crypto";
import { checkRateLimit } from "lambda-shared/rateLimit";
import { validateCognitoToken } from "lambda-shared/auth";
import { respond } from "lambda-shared/response";
import { createLogger } from "lambda-shared/logger";
import { withTimeout } from "lambda-shared/timeout";
import { setRequestContext, captureError, flushSentry } from "lambda-shared/errorTracking";
import { captureProductEvent, flushProductAnalytics } from "lambda-shared/productAnalytics";
import { validateVitals, validateCspUri } from "./validation.mjs";

const cloudwatch = new CloudWatchClient({ region: "us-east-1" });
const cognitoClient = new CognitoIdentityProviderClient({ region: "us-east-1" });
const dynamoClient = new DynamoDBClient({ region: "us-east-1" });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const NAMESPACE = "TheChrisGrey/SiteMetrics";
const moduleLog = createLogger(null, { service: "metrics" });

/**
 * @param {string} metricName
 * @param {number} value
 * @param {Array<{ Name: string, Value: string }>} [dimensions]
 */
async function putMetric(metricName, value, dimensions = []) {
  const command = new PutMetricDataCommand({
    Namespace: NAMESPACE,
    MetricData: [
      {
        MetricName: metricName,
        Value: value,
        Unit: "None",
        Timestamp: new Date(),
        Dimensions: dimensions,
      },
      ...(dimensions.length
        ? [{ MetricName: metricName, Value: value, Unit: /** @type {"None"} */ ("None"), Timestamp: new Date() }]
        : []),
    ],
  });
  await withTimeout(cloudwatch.send(command), 5000, "cloudwatch_put_metric");
}

/** @param {any} body */
async function handleVitals(body) {
  const { name, value } = body;
  const v = validateVitals(body);
  if (!v.ok) {
    return respond(v.status, { error: v.error });
  }
  const dimensions = v.dimensions;

  try {
    await putMetric(name, value, dimensions);
  } catch {
    return respond(202, { received: true, note: "metric accepted but write deferred" });
  }
  captureProductEvent("VitalsReported", { metric: name, rating: body.rating });
  return respond(200, { received: true });
}

// Hash a URI into one of 10 buckets to cap CloudWatch metric dimension cardinality.
// Raw URIs are logged for forensic investigation without creating unbounded dimensions.
/** @param {string} uri @returns {number} */
function hashBucket(uri) {
  return parseInt(createHash("sha256").update(uri).digest("hex").slice(0, 8), 16) % 10;
}

/** @param {any} body @param {{ info: Function, error: Function }} [log] */
async function handleCspReport(body, log) {
  const report = body["csp-report"] || body;
  const rawUri = (report["blocked-uri"] || report.blockedURL || "unknown").toString();
  const blockedUri = rawUri.substring(0, 256);

  // Validate blocked-uri is a legitimate CSP value
  if (!validateCspUri(blockedUri)) {
    return respond(400, { error: "Invalid blocked-uri format" });
  }

  // Log full URI for forensic investigation (structured + PII-redacted via logger)
  if (log) {
    log.info("csp_violation", { blockedUri });
  } else {
    moduleLog.info("csp_violation", { blockedUri });
  }

  // Use bucketed dimension to prevent CloudWatch cardinality explosion
  const bucket = `csp-bucket-${hashBucket(blockedUri)}`;
  await putMetric("CSPViolation", 1, [{ Name: "BlockedBucket", Value: bucket }]);
  return respond(200, { received: true });
}

/**
 * @param {string} metricName
 * @param {number} [periodHours=24]
 * @param {boolean} [includePercentile=false]
 */
async function getMetricAverage(metricName, periodHours = 24, includePercentile = false) {
  const now = new Date();
  const start = new Date(now.getTime() - periodHours * 60 * 60 * 1000);

  const command = new GetMetricStatisticsCommand({
    Namespace: NAMESPACE,
    MetricName: metricName,
    StartTime: start,
    EndTime: now,
    Period: periodHours * 3600,
    Statistics: ["Average", "SampleCount"],
  });

  const result = await withTimeout(cloudwatch.send(command), 8000, "cloudwatch_get_metric_avg");
  const percentile = includePercentile
    ? await withTimeout(
        cloudwatch.send(
          new GetMetricStatisticsCommand({
            ...command.input,
            Statistics: undefined,
            ExtendedStatistics: ["p75"],
          }),
        ),
        8000,
        "cloudwatch_get_metric_percentile",
      )
    : null;
  const datapoint = result.Datapoints?.[0];
  return {
    ...(includePercentile ? { p75: percentile?.Datapoints?.[0]?.ExtendedStatistics?.p75 ?? null } : {}),
    average: datapoint?.Average ?? null,
    count: datapoint?.SampleCount ?? 0,
  };
}

/**
 * @param {string} metricName
 * @param {number} [periodHours=24]
 */
async function getMetricSum(metricName, periodHours = 24) {
  const now = new Date();
  const start = new Date(now.getTime() - periodHours * 60 * 60 * 1000);

  const command = new GetMetricStatisticsCommand({
    Namespace: NAMESPACE,
    MetricName: metricName,
    StartTime: start,
    EndTime: now,
    Period: periodHours * 3600,
    Statistics: ["Sum"],
  });

  const result = await withTimeout(cloudwatch.send(command), 8000, "cloudwatch_get_metric_sum");
  return result.Datapoints?.[0]?.Sum ?? 0;
}

/**
 * @param {PromiseSettledResult<any>} result
 * @param {any} [fallback=null]
 * @param {{ error: Function }} [log]
 */
function settledValue(result, fallback = null, log) {
  if (result.status === "fulfilled") return result.value;
  const logger = log || moduleLog;
  logger.error("metric_fetch_failed", { reason: result.reason?.message || String(result.reason) });
  return fallback;
}

/** @param {string|undefined} authHeader @param {{ error: Function }} [log] */
async function handleHealth(authHeader, log) {
  const user = await validateCognitoToken(cognitoClient, GetUserCommand, authHeader);
  if (!user) {
    return respond(401, { error: "Unauthorized" });
  }

  const vitalsResults = await Promise.allSettled([
    getMetricAverage("LCP", 24, true),
    getMetricAverage("CLS", 24, true),
    getMetricAverage("INP", 24, true),
    getMetricAverage("FCP", 24, true),
    getMetricAverage("TTFB", 24, true),
  ]);
  const [lcp, cls, inp, fcp, ttfb] = vitalsResults.map((r) => settledValue(r, { average: null, count: 0 }, log));

  // Sums first, then averages. SUM_COUNT is the boundary the fallback below
  // keys on: a sum degrades to 0, an average to { average: null, count: 0 }.
  // Keep the two groups contiguous and this constant in step with them.
  const SUM_COUNT = 12;
  const metricResults = await Promise.allSettled([
    getMetricSum("CSPViolation"),
    getMetricSum("KBRetrievalFailure"),
    getMetricSum("KBRetrievalSuccess"),
    getMetricSum("KBRetrievalEmpty"),
    getMetricSum("KBRetrievalUnparseable"),
    getMetricSum("GuardrailInterventionStream"),
    getMetricSum("GuardrailInterventionMidStream"),
    getMetricSum("GuardrailInterventionPreStream"),
    getMetricSum("RateLimitRejection"),
    getMetricSum("BedrockInputTokens"),
    getMetricSum("BedrockOutputTokens"),
    getMetricSum("MalformedRequest"),
    getMetricAverage("KBRetrievalLatency"),
    getMetricAverage("BedrockInvocationLatency"),
    getMetricAverage("TotalRequestLatency"),
  ]);
  const [
    cspViolations,
    kbFailures,
    kbSuccesses,
    kbEmpties,
    kbUnparseables,
    guardrailStream,
    guardrailMidStream,
    guardrailPreStream,
    rateLimits,
    inputTokens,
    outputTokens,
    malformedRequests,
    kbLatency,
    bedrockLatency,
    totalLatency,
  ] = metricResults.map((r, i) => settledValue(r, i >= SUM_COUNT ? { average: null, count: 0 } : 0, log));
  // A turn blocked after text had already streamed is still an intervention; it
  // is counted under its own name so the two remediation shapes stay separable
  // in CloudWatch, but the panel wants the total.
  const guardrails = guardrailStream + guardrailMidStream + guardrailPreStream;

  // Every retrieval outcome, not just the two extremes. A KB that answers but
  // matches nothing (Empty) or answers in a shape we cannot read (Unparseable)
  // grounds the turn no better than a failure does, yet with only
  // successes/(successes+failures) an emptied vector index reported a green 100%
  // — or "--", if it emptied completely — which is the exact incident this panel
  // exists to catch.
  const kbTotal = kbSuccesses + kbFailures + kbEmpties + kbUnparseables;
  const kbSuccessRate = kbTotal > 0 ? ((kbSuccesses / kbTotal) * 100).toFixed(1) : null;

  return respond(200, {
    vitals: { lcp, cls, inp, fcp, ttfb },
    chat: {
      kbSuccessRate,
      kbFailures,
      kbSuccesses,
      kbEmpties,
      kbUnparseables,
      guardrailInterventions: guardrails,
      rateLimitRejections: rateLimits,
    },
    performance: {
      kbRetrievalLatency: kbLatency,
      bedrockInvocationLatency: bedrockLatency,
      totalRequestLatency: totalLatency,
    },
    costs: {
      bedrockInputTokens: inputTokens,
      bedrockOutputTokens: outputTokens,
      malformedRequests,
    },
    security: { cspViolations },
    periodHours: 24,
    timestamp: new Date().toISOString(),
  });
}

/** @param {any} event */
export const handler = async (event) => {
  const requestId = event.headers?.["x-request-id"] || randomUUID();
  const method = event.requestContext?.http?.method;
  const path = event.rawPath || "";
  const clientIp = event.requestContext?.http?.sourceIp || "unknown";
  const log = createLogger(requestId, { service: "metrics" });
  setRequestContext(requestId, "metrics", { method, path });

  try {
    if (method === "POST" && path === "/vitals") {
      const { allowed: vitalsAllowed } = await checkRateLimit(docClient, UpdateCommand, {
        table: "thechrisgrey-chat-ratelimit",
        ip: clientIp,
        prefix: "metrics-vitals-",
        failOpen: true,
        maxRequests: 200,
        windowSeconds: 60,
        requestId,
      });
      if (!vitalsAllowed) {
        return respond(429, { error: "Too many requests" });
      }
      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return respond(400, { error: "Invalid JSON" });
      }
      return await handleVitals(body);
    }

    if (method === "POST" && path === "/csp-report") {
      const { allowed: cspAllowed } = await checkRateLimit(docClient, UpdateCommand, {
        table: "thechrisgrey-chat-ratelimit",
        ip: clientIp,
        prefix: "metrics-csp-",
        failOpen: true,
        maxRequests: 100,
        windowSeconds: 60,
        requestId,
      });
      if (!cspAllowed) {
        return respond(429, { error: "Too many requests" });
      }
      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return respond(400, { error: "Invalid JSON" });
      }
      return await handleCspReport(body, log);
    }

    if (method === "GET" && path === "/health") {
      const authHeader = event.headers?.authorization || event.headers?.Authorization;
      return await handleHealth(authHeader, log);
    }

    return respond(404, { error: "Not found" });
  } catch (error) {
    log.error("handler_error", {
      error: error instanceof Error ? error.name : "Unknown",
      message: error instanceof Error ? error.message : "",
    });
    captureError(error, { handler: "metrics", path });
    return respond(500, { error: "Internal server error" });
  } finally {
    await flushSentry();
    await flushProductAnalytics();
  }
};
