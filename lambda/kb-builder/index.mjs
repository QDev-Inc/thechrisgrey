import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { CognitoIdentityProviderClient, GetUserCommand } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { createClient } from "@sanity/client";
import { randomUUID } from "crypto";
import { checkRateLimit } from "lambda-shared/rateLimit";
import { validateCognitoToken } from "lambda-shared/auth";
import { respond } from "lambda-shared/response";
import { createLogger } from "lambda-shared/logger";
import { withTimeout } from "lambda-shared/timeout";
import { MetricsCollector } from "lambda-shared/metrics";
import { setRequestContext, captureError, addBreadcrumb, flushSentry } from "lambda-shared/errorTracking";
import { captureProductEvent, flushProductAnalytics } from "lambda-shared/productAnalytics";
import { CATEGORY_ORDER, validateEntryFields } from "./validation.mjs";

const s3Client = new S3Client({ region: "us-east-1" });
const cognitoClient = new CognitoIdentityProviderClient({ region: "us-east-1" });
const cloudwatchClient = new CloudWatchClient({ region: "us-east-1" });
const dynamoClient = new DynamoDBClient({ region: "us-east-1" });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const S3_BUCKET = process.env.S3_BUCKET || "thechrisgrey-kb-source";
const S3_KEY = process.env.KB_SOURCE_KEY || "content/knowledge-base.txt";

// Startup validation — fail fast if critical env vars are missing
if (!process.env.SANITY_WRITE_TOKEN) {
  throw new Error("SANITY_WRITE_TOKEN is required — kb-builder cannot start without it");
}

const sanityClient = createClient({
  projectId: "k5950b3w",
  dataset: "production",
  apiVersion: "2024-01-01",
  token: process.env.SANITY_WRITE_TOKEN,
  useCdn: false,
  timeout: 10000, // 10s — prevent hanging on Sanity API issues
});

/** @type {Record<string, string>} */
const CATEGORY_LABELS = {
  biography: "BIOGRAPHY",
  military: "MILITARY SERVICE",
  education: "EDUCATION",
  career: "CAREER",
  business: "BUSINESS & ENTREPRENEURSHIP",
  skills: "SKILLS & EXPERTISE",
  awards: "AWARDS & RECOGNITION",
  philosophy: "PHILOSOPHY & LEADERSHIP",
  podcast: "THE VECTOR PODCAST",
  book: "BEYOND THE ASSESSMENT",
};

/** @param {boolean} [activeOnly=false] @returns {Promise<any>} */
async function fetchEntries(activeOnly = false) {
  const filter = activeOnly ? '*[_type == "kbEntry" && isActive == true]' : '*[_type == "kbEntry"]';

  return withTimeout(
    sanityClient.fetch(
      `${filter} | order(category asc, sortOrder asc, date desc) {
      _id, _createdAt, _updatedAt, title, category, content, date, sortOrder, isActive
    }`,
    ),
    8000,
    "sanity_fetch_entries",
  );
}

/** @param {any[]} entries @returns {string} */
function assembleDocument(entries) {
  /** @type {Record<string, any[]>} */
  const grouped = {};

  for (const entry of entries) {
    const cat = entry.category || "biography";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(entry);
  }

  const sections = [];

  for (const category of CATEGORY_ORDER) {
    const items = grouped[category];
    if (!items || items.length === 0) continue;

    const label = CATEGORY_LABELS[category] || category.toUpperCase();
    const lines = [`=== ${label} ===`, ""];

    for (const item of items) {
      const dateStr = item.date
        ? ` (${new Date(item.date).toLocaleDateString("en-US", { year: "numeric", month: "long" })})`
        : "";
      lines.push(`${item.title}${dateStr}`);
      lines.push(item.content);
      lines.push("");
    }

    sections.push(lines.join("\n"));
  }

  for (const [category, items] of Object.entries(grouped)) {
    if (CATEGORY_ORDER.includes(category)) continue;
    const label = category.toUpperCase();
    const lines = [`=== ${label} ===`, ""];
    for (const item of items) {
      lines.push(item.title);
      lines.push(item.content);
      lines.push("");
    }
    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n");
}

/** @param {string} document */
async function uploadToS3(document) {
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: S3_KEY,
    Body: document,
    ContentType: "text/plain; charset=utf-8",
  });
  return withTimeout(s3Client.send(command), 10000, "s3_upload");
}

/** @param {any} event */
// eslint-disable-next-line complexity -- CRUD handler: auth, route dispatch, validation, S3 publish, error mapping across 6 endpoints
export const handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return respond(200, { ok: true });
  }

  // Health check (no auth required — used by post-deploy checks and monitoring)
  if (event.requestContext?.http?.method === "GET" && (event.rawPath || "") === "/health") {
    return respond(200, { ok: true, service: "kb-builder", version: "1.0.0" });
  }

  const requestId = event.headers?.["x-request-id"] || randomUUID();
  const method = event.requestContext?.http?.method;
  const path = event.rawPath || "";
  const log = createLogger(requestId, { service: "kb-builder" });
  log.info("request_start", { method, path });
  const metrics = new MetricsCollector(cloudwatchClient, "TheChrisGrey/KBBuilder");
  setRequestContext(requestId, "kb-builder", { method, path });

  try {
    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    const user = await validateCognitoToken(cognitoClient, GetUserCommand, authHeader);
    if (!user) {
      metrics.record("AuthFailed");
      return respond(401, { error: "Unauthorized" });
    }
    addBreadcrumb("auth", "cognito_authenticated", { user: user.Username });

    const clientIp = event.requestContext?.http?.sourceIp || "unknown";
    const { allowed } = await checkRateLimit(docClient, UpdateCommand, {
      table: "thechrisgrey-chat-ratelimit",
      ip: clientIp,
      prefix: "kb-builder-",
      maxRequests: 30,
      windowSeconds: 60,
      ttlBuffer: 300,
    });
    if (!allowed) {
      metrics.record("RateLimited");
      return respond(429, { error: "Too many requests" });
    }

    if (method === "GET" && path === "/entries") {
      const entries = await fetchEntries(false);
      return respond(200, { entries });
    }

    if (method === "POST" && path === "/entries") {
      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return respond(400, { error: "Invalid JSON in request body" });
      }
      const { title, category, content, date, sortOrder, isActive } = body;

      const validationError = validateEntryFields({ title, category, content, date, sortOrder }, true);
      if (validationError) {
        return respond(400, { error: validationError });
      }

      const doc = {
        _type: "kbEntry",
        title,
        category,
        content,
        date: date || undefined,
        sortOrder: sortOrder ?? undefined,
        isActive: isActive !== false,
      };

      const result = await sanityClient.create(doc);
      metrics.record("EntryCreated");
      return respond(201, { entry: result });
    }

    if (method === "PUT" && path.startsWith("/entries/")) {
      const id = path.split("/entries/")[1];
      if (!id) return respond(400, { error: "Missing entry ID" });
      if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
        return respond(400, { error: "Invalid entry ID format" });
      }

      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return respond(400, { error: "Invalid JSON in request body" });
      }

      const validationError = validateEntryFields(body, false);
      if (validationError) {
        return respond(400, { error: validationError });
      }

      // Verify document is a kbEntry before patching. Without this guard,
      // an authorized admin (or a stolen sessionStorage token) could PUT
      // kbEntry-shaped fields against any document ID in the dataset and
      // silently overwrite a blog post's title/content/active flag —
      // the SANITY_WRITE_TOKEN has full-dataset write scope. Mirrors the
      // DELETE guard below.
      const existing = await sanityClient.getDocument(id);
      if (!existing) return respond(404, { error: "Entry not found" });
      if (existing._type !== "kbEntry") {
        return respond(403, { error: "Cannot update non-kbEntry documents" });
      }

      const patch = sanityClient.patch(id);

      if (body.title !== undefined) patch.set({ title: body.title });
      if (body.category !== undefined) patch.set({ category: body.category });
      if (body.content !== undefined) patch.set({ content: body.content });
      if (body.date !== undefined) patch.set({ date: body.date });
      if (body.sortOrder !== undefined) patch.set({ sortOrder: body.sortOrder });
      if (body.isActive !== undefined) patch.set({ isActive: body.isActive });

      const result = await patch.commit();
      metrics.record("EntryUpdated");
      return respond(200, { entry: result });
    }

    if (method === "DELETE" && path.startsWith("/entries/")) {
      const id = path.split("/entries/")[1];
      if (!id) return respond(400, { error: "Missing entry ID" });
      if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
        return respond(400, { error: "Invalid entry ID format" });
      }

      // Verify document is a kbEntry before deleting
      const doc = await sanityClient.getDocument(id);
      if (!doc) return respond(404, { error: "Entry not found" });
      if (doc._type !== "kbEntry") {
        return respond(403, { error: "Cannot delete non-kbEntry documents" });
      }

      await sanityClient.delete(id);
      metrics.record("EntryDeleted");
      return respond(200, { deleted: true });
    }

    if (method === "POST" && path === "/publish") {
      const entries = await fetchEntries(true);

      if (entries.length === 0) {
        return respond(400, { error: "No active entries to publish" });
      }

      const document = assembleDocument(entries);
      await uploadToS3(document);
      metrics.record("KbPublished");
      captureProductEvent("KBPublished", { entryCount: entries.length });

      return respond(200, {
        message: "Knowledge Base document published",
        entryCount: entries.length,
        documentSize: document.length,
        publishedAt: new Date().toISOString(),
      });
    }

    return respond(404, { error: "Not found" });
  } catch (error) {
    metrics.record("HandlerError");
    log.error("handler_error", {
      error: error instanceof Error ? error.name : "Unknown",
      message: error instanceof Error ? error.message : "",
    });
    captureError(error, { handler: "kb-builder", path });
    return respond(500, { error: "Internal server error" });
  } finally {
    await metrics.flush();
    await flushSentry();
    await flushProductAnalytics();
  }
};
