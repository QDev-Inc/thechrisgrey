import { randomBytes, createHash } from "node:crypto";
import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const tokenKey = (token) => `confirmation-${createHash("sha256").update(token).digest("hex")}`;

export function createConfirmationService({ client, table, from, subscribe, fetchImpl = fetch }) {
  return {
    async request({ apiKey, email, source, segmentId, origin }) {
      if (!table || !from || !segmentId) throw new Error("confirmation_configuration_missing");
      const token = randomBytes(32).toString("base64url");
      await client.send(
        new PutCommand({
          TableName: table,
          Item: { pk: tokenKey(token), email, source, segmentId, ttl: Math.floor(Date.now() / 1000) + 86400 },
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
      const url = new URL("/newsletter/confirm", origin);
      url.hash = token;
      const purpose = source === "blueprint" ? "the Blueprint waitlist" : "Christian Perez's newsletter";
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": tokenKey(token),
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: "Confirm your subscription",
          text: `Confirm that you want to join ${purpose}:\n\n${url.href}\n\nThis link expires in 24 hours. If you did not request this, ignore this email. Your subscription will not change.`,
          html: `<p>Confirm that you want to join ${purpose}.</p><p><a href="${url.href}">Review and confirm your subscription</a></p><p>This link expires in 24 hours. If you did not request this, ignore this email. Your subscription will not change.</p>`,
        }),
      });
      if (!response.ok) throw new Error("confirmation_delivery_failed");
    },
    async confirm({ apiKey, token }) {
      if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return { ok: false };
      let record;
      try {
        const result = await client.send(
          new UpdateCommand({
            TableName: table,
            Key: { pk: tokenKey(token) },
            UpdateExpression: "SET consumedAt = :now",
            ConditionExpression: "attribute_exists(email) AND attribute_not_exists(consumedAt) AND #ttl > :now",
            ExpressionAttributeNames: { "#ttl": "ttl" },
            ExpressionAttributeValues: { ":now": Math.floor(Date.now() / 1000) },
            ReturnValues: "ALL_OLD",
          }),
        );
        record = result.Attributes;
      } catch (error) {
        if (error?.name === "ConditionalCheckFailedException") return { ok: false };
        throw error;
      }
      if (!record?.email || !record?.segmentId) return { ok: false };
      await subscribe({ apiKey, email: record.email, segmentId: record.segmentId });
      return { ok: true, source: record.source };
    },
  };
}
