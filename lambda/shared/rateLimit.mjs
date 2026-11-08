import { createHash } from "crypto";
import { createLogger } from "./logger.mjs";

/** @param {any} client @param {any} Command @param {{ table: string, service: string, hourly: number, daily: number, requestId: string }} options */
export async function checkCostBudget(client, Command, { table, service, hourly, daily, requestId }) {
  for (const [windowSeconds, maxRequests] of [
    [3600, hourly],
    [86400, daily],
  ]) {
    const result = await checkRateLimit(client, Command, {
      table,
      ip: "global",
      prefix: `${service}-budget-${windowSeconds}-`,
      maxRequests,
      windowSeconds,
      ttlBuffer: 3600,
      requestId,
    });
    if (!result.allowed) return false;
  }
  return true;
}

const fallbackLog = createLogger(null, { service: "rate-limit" });

/**
 * Atomic DynamoDB-based rate limiter with fixed windows.
 *
 * Uses ADD + ConditionExpression for race-condition-free counting.
 * Denies requests when storage is unavailable unless a telemetry caller explicitly opts out.
 *
 * @param {any} docClient - Injected DynamoDBDocumentClient (duck-typed: must have .send)
 * @param {any} UpdateCommand - Injected UpdateCommand constructor
 * @param {object} opts
 * @param {string} opts.table        - DynamoDB table name
 * @param {string} opts.ip           - Client IP address
 * @param {string} [opts.prefix=""]  - PK prefix (e.g. "metrics-vitals-", "kb-builder-")
 * @param {number} opts.maxRequests  - Max requests allowed per window
 * @param {number} opts.windowSeconds - Window length in seconds
 * @param {number} [opts.ttlBuffer=300] - Extra seconds before TTL deletes the row
 * @param {string|null} [opts.requestId=null] - If set, errors are logged as structured JSON with this ID
 * @param {boolean} [opts.failOpen=false]
 * @returns {Promise<{ allowed: boolean, remaining: number }>}
 */
export async function checkRateLimit(
  docClient,
  UpdateCommand,
  { table, ip, prefix = "", maxRequests, windowSeconds, ttlBuffer = 300, requestId = null, failOpen = false },
) {
  const ipHash = createHash("sha256")
    .update(ip || "unknown")
    .digest("hex");
  const pk = prefix ? `${prefix}${ipHash}` : ipHash;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);

  const increment = async () => {
    const result = await docClient.send(
      new UpdateCommand({
        TableName: table,
        Key: { pk },
        UpdateExpression: "ADD requestCount :inc SET #ttl = :ttl, windowStart = if_not_exists(windowStart, :ws)",
        ConditionExpression: "attribute_not_exists(pk) OR windowStart = :ws",
        ExpressionAttributeNames: { "#ttl": "ttl" },
        ExpressionAttributeValues: {
          ":inc": 1,
          ":ws": windowStart,
          ":ttl": windowStart + windowSeconds + ttlBuffer,
        },
        ReturnValues: "ALL_NEW",
      }),
    );

    const count = result.Attributes?.requestCount ?? 1;
    if (count > maxRequests) {
      return { allowed: false, remaining: 0 };
    }
    return { allowed: true, remaining: maxRequests - count };
  };
  const unavailable = () => ({ allowed: failOpen, remaining: -1 });
  try {
    return await increment();
  } catch (error) {
    const errName = error instanceof Error ? error.name : String(error);
    if (errName === "ConditionalCheckFailedException") {
      try {
        await docClient.send(
          new UpdateCommand({
            TableName: table,
            Key: { pk },
            UpdateExpression: "SET requestCount = :one, windowStart = :ws, #ttl = :ttl",
            ConditionExpression: "windowStart < :ws",
            ExpressionAttributeNames: { "#ttl": "ttl" },
            ExpressionAttributeValues: {
              ":one": 1,
              ":ws": windowStart,
              ":ttl": windowStart + windowSeconds + ttlBuffer,
            },
          }),
        );
        return { allowed: true, remaining: maxRequests - 1 };
      } catch (resetError) {
        if (resetError instanceof Error && resetError.name === "ConditionalCheckFailedException") {
          try {
            return await increment();
          } catch {
            return unavailable();
          }
        }
        return unavailable();
      }
    }
    if (requestId) {
      const log = createLogger(requestId, { service: "rate-limit" });
      log.error("rate_limit_error", { error: errName });
    } else {
      fallbackLog.error("rate_limit_error", { error: errName });
    }
    return unavailable();
  }
}
