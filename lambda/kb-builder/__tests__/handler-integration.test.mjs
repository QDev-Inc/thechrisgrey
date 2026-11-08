/**
 * KB-builder handler INTEGRATION test.
 *
 * Exercises the REAL `handler` in index.mjs end-to-end across its full HTTP
 * surface: CORS preflight, Cognito auth, rate limiting, route dispatch, input
 * validation, Sanity CRUD, S3 publish, and error handling. External services
 * are intercepted at the prototype level so the real handler body runs against
 * scripted responses.
 *
 * WHAT IS REAL
 *   - The entire handler body: event parsing, CORS, auth via validateCognitoToken,
 *     rate limiting via checkRateLimit, route dispatch, validation via
 *     validateEntryFields, the kbEntry type guard (PUT/DELETE), assembleDocument
 *     document assembly, uploadToS3, and all response shaping.
 *
 * WHERE THE FAKE SITS
 *   CognitoIdentityProviderClient.prototype.send returns a verified admin user.
 *   DynamoDBDocumentClient.prototype.send returns a scripted rate-limit count.
 *   S3Client.prototype.send captures the PutObjectCommand.
 *   SanityClient.prototype methods (fetch, create, getDocument, delete, patch)
 *   are overridden to return scripted responses without touching the network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { accessToken, configureCognito, SUBJECT } from "../../shared/__fixtures__/cognito.mjs";
configureCognito((await import("lambda-shared/auth")).getCognitoVerifier);
const adminToken = accessToken();

// ── Env setup BEFORE importing the handler ──────────────────────────────────
process.env.SANITY_WRITE_TOKEN = "test-token";
process.env.ADMIN_ALLOWLIST = "admin@altivum.ai";
delete process.env.AWS_ACCESS_KEY_ID;
delete process.env.AWS_SECRET_ACCESS_KEY;
delete process.env.AWS_SESSION_TOKEN;
delete process.env.AWS_PROFILE;
process.env.AWS_SHARED_CREDENTIALS_FILE = "/dev/null";
process.env.AWS_CONFIG_FILE = "/dev/null";
process.env.AWS_EC2_METADATA_DISABLED = "true";
process.env.AWS_REGION = "us-east-1";

const { CognitoIdentityProviderClient } = await import("@aws-sdk/client-cognito-identity-provider");
const { DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb");
const { S3Client } = await import("@aws-sdk/client-s3");
const { SanityClient } = await import("@sanity/client");

// ── AWS SDK prototype overrides ─────────────────────────────────────────────

let cognitoBehavior = null;
let dynamoBehavior = null;
let s3Calls = [];

CognitoIdentityProviderClient.prototype.send = async function (cmd) {
  if (cognitoBehavior) return cognitoBehavior(cmd);
  return {
    Username: "admin",
    UserAttributes: [
      { Name: "sub", Value: SUBJECT },
      { Name: "email", Value: "admin@altivum.ai" },
      { Name: "email_verified", Value: "true" },
    ],
  };
};

DynamoDBDocumentClient.prototype.send = async function (cmd) {
  if (dynamoBehavior) return dynamoBehavior(cmd);
  return { Attributes: { requestCount: 1 } };
};

S3Client.prototype.send = async function (cmd) {
  s3Calls.push(cmd);
  return {};
};

// ── SanityClient prototype overrides ────────────────────────────────────────

let sanityFetchBehavior = null;
let sanityCreateBehavior = null;
let sanityGetBehavior = null;
let sanityDeleteBehavior = null;
let sanityPatchBehavior = null;

SanityClient.prototype.fetch = async function (query) {
  if (sanityFetchBehavior) return sanityFetchBehavior(query);
  return [];
};

SanityClient.prototype.create = async function (doc) {
  if (sanityCreateBehavior) return sanityCreateBehavior(doc);
  return { _id: "mock-id", ...doc };
};

SanityClient.prototype.getDocument = async function (id) {
  if (sanityGetBehavior) return sanityGetBehavior(id);
  return null;
};

SanityClient.prototype.delete = async function (id) {
  if (sanityDeleteBehavior) return sanityDeleteBehavior(id);
  return { _id: id, deleted: true };
};

SanityClient.prototype.patch = function (id) {
  const sets = {};
  const patch = {
    set(props) {
      Object.assign(sets, props);
      return patch;
    },
    async commit() {
      if (sanityPatchBehavior) return sanityPatchBehavior(id, sets);
      return { _id: id, _type: "kbEntry", ...sets };
    },
  };
  return patch;
};

// ── Import handler AFTER all overrides are in place ─────────────────────────

const { handler } = await import("../index.mjs");

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeEvent({ method = "GET", path = "/entries", body, auth = `Bearer ${adminToken}`, ip = "9.9.9.9" } = {}) {
  const headers = {};
  if (auth) headers.authorization = auth;
  return {
    requestContext: { http: { method, sourceIp: ip } },
    rawPath: path,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  };
}

function parseBody(res) {
  return JSON.parse(res.body);
}

const VALID_ENTRY = {
  title: "Test Entry",
  category: "biography",
  content: "This is test content for the entry.",
};

// ── Tests: HTTP routing, auth, rate limiting, validation ────────────────────

test("OPTIONS fallback returns 200 without duplicating Function URL CORS headers", async () => {
  const res = await handler(makeEvent({ method: "OPTIONS" }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Access-Control-Allow-Origin"], undefined);
  const body = parseBody(res);
  assert.equal(body.ok, true);
});

test("missing Authorization header returns 401", async () => {
  const res = await handler(makeEvent({ auth: null }));
  assert.equal(res.statusCode, 401);
  const body = parseBody(res);
  assert.equal(body.error, "Unauthorized");
});

test("invalid Cognito token returns 401", async () => {
  cognitoBehavior = async () => {
    throw Object.assign(new Error("Not authorized"), { name: "NotAuthorizedException" });
  };
  try {
    const res = await handler(makeEvent({}));
    assert.equal(res.statusCode, 401);
  } finally {
    cognitoBehavior = null;
  }
});

test("rate-limited request returns 429", async () => {
  dynamoBehavior = async () => ({ Attributes: { requestCount: 999 } });
  try {
    const res = await handler(makeEvent({}));
    assert.equal(res.statusCode, 429);
    const body = parseBody(res);
    assert.equal(body.error, "Too many requests");
  } finally {
    dynamoBehavior = null;
  }
});

test("unknown route returns 404", async () => {
  const res = await handler(makeEvent({ method: "GET", path: "/unknown" }));
  assert.equal(res.statusCode, 404);
  const body = parseBody(res);
  assert.equal(body.error, "Not found");
});

test("POST /entries with invalid JSON returns 400", async () => {
  const res = await handler(makeEvent({ method: "POST", path: "/entries", body: "{not valid json" }));
  assert.equal(res.statusCode, 400);
  const body = parseBody(res);
  assert.match(body.error, /Invalid JSON/);
});

test("POST /entries with missing required fields returns 400 validation error", async () => {
  const res = await handler(makeEvent({ method: "POST", path: "/entries", body: { title: "Missing fields" } }));
  assert.equal(res.statusCode, 400);
  const body = parseBody(res);
  assert.match(body.error, /required/);
});

test("PUT /entries/:id with invalid ID format returns 400", async () => {
  const res = await handler(
    makeEvent({
      method: "PUT",
      path: "/entries/bad id with spaces",
      body: { title: "Updated" },
    }),
  );
  assert.equal(res.statusCode, 400);
  const body = parseBody(res);
  assert.match(body.error, /Invalid entry ID format/);
});

test("DELETE /entries/:id with invalid ID format returns 400", async () => {
  const res = await handler(makeEvent({ method: "DELETE", path: "/entries/bad id with spaces" }));
  assert.equal(res.statusCode, 400);
  const body = parseBody(res);
  assert.match(body.error, /Invalid entry ID format/);
});

// ── Tests: Sanity CRUD paths ────────────────────────────────────────────────

test("GET /entries returns 200 with entries from Sanity", async () => {
  sanityFetchBehavior = async () => [
    {
      _id: "entry-1",
      _type: "kbEntry",
      title: "Bio Entry",
      category: "biography",
      content: "Content here",
      isActive: true,
    },
  ];
  try {
    const res = await handler(makeEvent({ method: "GET", path: "/entries" }));
    assert.equal(res.statusCode, 200);
    const body = parseBody(res);
    assert.ok(Array.isArray(body.entries), "entries is an array");
    assert.equal(body.entries.length, 1);
    assert.equal(body.entries[0]._id, "entry-1");
  } finally {
    sanityFetchBehavior = null;
  }
});

test("POST /entries with valid data creates entry and returns 201", async () => {
  sanityCreateBehavior = async (doc) => ({
    _id: "new-entry-id",
    _createdAt: "2025-01-15T00:00:00Z",
    ...doc,
  });
  try {
    const res = await handler(makeEvent({ method: "POST", path: "/entries", body: VALID_ENTRY }));
    assert.equal(res.statusCode, 201);
    const body = parseBody(res);
    assert.equal(body.entry._id, "new-entry-id");
    assert.equal(body.entry.title, "Test Entry");
  } finally {
    sanityCreateBehavior = null;
  }
});

test("DELETE /entries/:id for non-kbEntry document returns 403", async () => {
  sanityGetBehavior = async () => ({
    _id: "blog-post-1",
    _type: "blogPost",
    title: "A Blog Post",
  });
  try {
    const res = await handler(makeEvent({ method: "DELETE", path: "/entries/blog-post-1" }));
    assert.equal(res.statusCode, 403);
    const body = parseBody(res);
    assert.match(body.error, /non-kbEntry/);
  } finally {
    sanityGetBehavior = null;
  }
});

test("DELETE /entries/:id for non-existent document returns 404", async () => {
  sanityGetBehavior = async () => null;
  try {
    const res = await handler(makeEvent({ method: "DELETE", path: "/entries/nonexistent-id" }));
    assert.equal(res.statusCode, 404);
    const body = parseBody(res);
    assert.match(body.error, /not found/i);
  } finally {
    sanityGetBehavior = null;
  }
});

test("DELETE /entries/:id for a kbEntry succeeds and returns 200", async () => {
  sanityGetBehavior = async () => ({
    _id: "entry-to-delete",
    _type: "kbEntry",
    title: "Old Entry",
  });
  let deletedId = null;
  sanityDeleteBehavior = async (id) => {
    deletedId = id;
    return { _id: id };
  };
  try {
    const res = await handler(makeEvent({ method: "DELETE", path: "/entries/entry-to-delete" }));
    assert.equal(res.statusCode, 200);
    const body = parseBody(res);
    assert.equal(body.deleted, true);
    assert.equal(deletedId, "entry-to-delete");
  } finally {
    sanityGetBehavior = null;
    sanityDeleteBehavior = null;
  }
});

test("PUT /entries/:id for a kbEntry patches and returns 200", async () => {
  sanityGetBehavior = async () => ({
    _id: "entry-to-update",
    _type: "kbEntry",
    title: "Old Title",
    content: "Old content",
  });
  sanityPatchBehavior = async (id, sets) => ({
    _id: id,
    _type: "kbEntry",
    title: "Old Title",
    content: "Old content",
    ...sets,
  });
  try {
    const res = await handler(
      makeEvent({
        method: "PUT",
        path: "/entries/entry-to-update",
        body: { title: "New Title" },
      }),
    );
    assert.equal(res.statusCode, 200);
    const body = parseBody(res);
    assert.equal(body.entry.title, "New Title");
  } finally {
    sanityGetBehavior = null;
    sanityPatchBehavior = null;
  }
});

test("PUT /entries/:id for non-kbEntry document returns 403", async () => {
  sanityGetBehavior = async () => ({
    _id: "blog-post-1",
    _type: "blogPost",
  });
  try {
    const res = await handler(
      makeEvent({
        method: "PUT",
        path: "/entries/blog-post-1",
        body: { title: "Updated" },
      }),
    );
    assert.equal(res.statusCode, 403);
    const body = parseBody(res);
    assert.match(body.error, /non-kbEntry/);
  } finally {
    sanityGetBehavior = null;
  }
});

// ── Tests: Publish path ─────────────────────────────────────────────────────

test("POST /publish assembles document and uploads to S3", async () => {
  const mockEntries = [
    {
      _id: "entry-1",
      _type: "kbEntry",
      title: "Founder Bio",
      category: "biography",
      content: "Christian Perez is the founder of Altivum Inc.",
      date: "2025-01-15",
      sortOrder: 1,
      isActive: true,
    },
    {
      _id: "entry-2",
      _type: "kbEntry",
      title: "Military Service",
      category: "military",
      content: "Served as a Green Beret (18D).",
      sortOrder: 1,
      isActive: true,
    },
  ];

  sanityFetchBehavior = async () => mockEntries;
  s3Calls = [];

  try {
    const res = await handler(makeEvent({ method: "POST", path: "/publish" }));
    assert.equal(res.statusCode, 200);
    const body = parseBody(res);
    assert.equal(body.entryCount, 2);
    assert.ok(body.documentSize > 0, "documentSize is positive");
    assert.ok(body.publishedAt, "publishedAt timestamp present");
    assert.equal(body.message, "Knowledge Base document published");

    // Verify S3 upload was called
    assert.equal(s3Calls.length, 1, "one S3 PutObject call");
    assert.equal(s3Calls[0].input.Bucket, "thechrisgrey-kb-source");
    assert.equal(s3Calls[0].input.Key, "content/knowledge-base.txt");

    // Verify the assembled document contains the expected sections
    const docBody = s3Calls[0].input.Body;
    assert.match(docBody, /BIOGRAPHY/);
    assert.match(docBody, /MILITARY SERVICE/);
    assert.match(docBody, /Founder Bio/);
    assert.match(docBody, /Green Beret/);
  } finally {
    sanityFetchBehavior = null;
    s3Calls = [];
  }
});

test("POST /publish with no active entries returns 400", async () => {
  sanityFetchBehavior = async () => [];
  try {
    const res = await handler(makeEvent({ method: "POST", path: "/publish" }));
    assert.equal(res.statusCode, 400);
    const body = parseBody(res);
    assert.match(body.error, /No active entries/);
  } finally {
    sanityFetchBehavior = null;
  }
});

test("handler catches Sanity errors and returns 500", async () => {
  sanityFetchBehavior = async () => {
    throw new Error("Sanity API is down");
  };
  try {
    const res = await handler(makeEvent({ method: "GET", path: "/entries" }));
    assert.equal(res.statusCode, 500);
    const body = parseBody(res);
    assert.equal(body.error, "Internal server error");
  } finally {
    sanityFetchBehavior = null;
  }
});
