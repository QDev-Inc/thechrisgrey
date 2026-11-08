import { createHash, randomUUID } from "node:crypto";
import { createLogger } from "lambda-shared/logger";

const WINDOW_SECONDS = 30 * 24 * 60 * 60;

/**
 * @param {any} docClient
 * @param {any} UpdateCommand
 * @param {{ table: string, deviceHash: string, requestId: string, now?: number }} options
 */
export function createBlueprintQuota(docClient, UpdateCommand, { table, deviceHash, requestId, now = Date.now() }) {
  const timestamp = Math.floor(now / 1000);
  const windowStart = timestamp - (timestamp % WINDOW_SECONDS);
  const pk = `blueprint-${createHash("sha256").update(deviceHash).digest("hex")}`;
  const owner = randomUUID();
  const log = createLogger(requestId, { service: "blueprint-quota" });
  let reserved = false;

  return {
    async reserve() {
      try {
        await docClient.send(
          new UpdateCommand({
            TableName: table,
            Key: { pk },
            UpdateExpression:
              "SET requestCount = :zero, windowStart = :ws, #ttl = :ttl, leaseOwner = :owner, leaseUntil = :lease",
            ConditionExpression:
              "(attribute_not_exists(pk) OR windowStart < :ws OR requestCount = :zero) AND (attribute_not_exists(leaseUntil) OR leaseUntil < :now)",
            ExpressionAttributeNames: { "#ttl": "ttl" },
            ExpressionAttributeValues: {
              ":zero": 0,
              ":ws": windowStart,
              ":ttl": windowStart + WINDOW_SECONDS + 3600,
              ":owner": owner,
              ":lease": timestamp + 120,
              ":now": timestamp,
            },
          }),
        );
        reserved = true;
        return { allowed: true, unavailable: false };
      } catch (error) {
        const unavailable = !(error instanceof Error && error.name === "ConditionalCheckFailedException");
        if (unavailable) log.error("quota_unavailable");
        return { allowed: false, unavailable };
      }
    },
    async commit() {
      await docClient.send(
        new UpdateCommand({
          TableName: table,
          Key: { pk },
          UpdateExpression: "SET requestCount = :one REMOVE leaseOwner, leaseUntil",
          ConditionExpression: "leaseOwner = :owner AND windowStart = :ws",
          ExpressionAttributeValues: { ":one": 1, ":owner": owner, ":ws": windowStart },
        }),
      );
      reserved = false;
    },
    async release() {
      if (!reserved) return;
      try {
        await docClient.send(
          new UpdateCommand({
            TableName: table,
            Key: { pk },
            UpdateExpression: "REMOVE leaseOwner, leaseUntil",
            ConditionExpression: "leaseOwner = :owner AND windowStart = :ws",
            ExpressionAttributeValues: { ":owner": owner, ":ws": windowStart },
          }),
        );
        reserved = false;
      } catch {
        log.error("quota_release_failed");
      }
    },
  };
}
