import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCognitoToken } from "../auth.mjs";
import { accessToken, configureCognito, SUBJECT } from "../__fixtures__/cognito.mjs";

configureCognito();
const token = accessToken();

// Minimal stand-in for GetUserCommand: records the input so we can assert on it.
class FakeGetUserCommand {
  constructor(input) {
    this.input = input;
  }
}

// Fake Cognito client. `attributes` is the UserAttributes array GetUser returns;
// pass `error` to simulate an invalid/expired token.
function fakeClient({ attributes = [], error = null } = {}) {
  const calls = [];
  return {
    calls,
    send: async (command) => {
      calls.push(command.input);
      if (error) throw error;
      return { UserAttributes: attributes, Username: "admin" };
    },
  };
}

const VERIFIED = (email) => [
  { Name: "sub", Value: SUBJECT },
  { Name: "email", Value: email },
  { Name: "email_verified", Value: "true" },
];

const ALLOWLIST = "christian.perez@altivum.io,christian.perez@altivum.ai";

test("returns the user for an allowlisted, verified email", async () => {
  const client = fakeClient({ attributes: VERIFIED("christian.perez@altivum.io") });
  const result = await validateCognitoToken(client, FakeGetUserCommand, `Bearer ${token}`, {
    allowlist: ALLOWLIST,
  });
  assert.ok(result, "expected a truthy user object");
  assert.equal(client.calls[0].AccessToken, token);
});

test("matches allowlist case-insensitively and trims whitespace", async () => {
  const client = fakeClient({ attributes: VERIFIED("Christian.Perez@Altivum.AI") });
  const result = await validateCognitoToken(client, FakeGetUserCommand, `Bearer ${token}`, {
    allowlist: " christian.perez@altivum.io , christian.perez@altivum.ai ",
  });
  assert.ok(result);
});

test("denies an authenticated email that is NOT on the allowlist", async () => {
  const client = fakeClient({ attributes: VERIFIED("attacker@example.com") });
  const result = await validateCognitoToken(client, FakeGetUserCommand, `Bearer ${token}`, {
    allowlist: ALLOWLIST,
  });
  assert.equal(result, null);
});

test("denies an allowlisted email whose email_verified is not 'true'", async () => {
  const client = fakeClient({
    attributes: [
      { Name: "email", Value: "christian.perez@altivum.io" },
      { Name: "email_verified", Value: "false" },
    ],
  });
  const result = await validateCognitoToken(client, FakeGetUserCommand, `Bearer ${token}`, {
    allowlist: ALLOWLIST,
  });
  assert.equal(result, null);
});

test("denies when no email attribute is present", async () => {
  const client = fakeClient({ attributes: [{ Name: "sub", Value: "abc" }] });
  const result = await validateCognitoToken(client, FakeGetUserCommand, `Bearer ${token}`, {
    allowlist: ALLOWLIST,
  });
  assert.equal(result, null);
});

test("returns null for a missing or non-Bearer header without calling Cognito", async () => {
  const client = fakeClient({ attributes: VERIFIED("christian.perez@altivum.io") });
  assert.equal(await validateCognitoToken(client, FakeGetUserCommand, undefined, { allowlist: ALLOWLIST }), null);
  assert.equal(await validateCognitoToken(client, FakeGetUserCommand, "Basic xxx", { allowlist: ALLOWLIST }), null);
  assert.equal(client.calls.length, 0, "Cognito should not be called for a bad header");
});

test("fails closed when the allowlist is empty, even with a valid token", async () => {
  const client = fakeClient({ attributes: VERIFIED("christian.perez@altivum.io") });
  const result = await validateCognitoToken(client, FakeGetUserCommand, `Bearer ${token}`, {
    allowlist: "",
  });
  assert.equal(result, null);
  assert.equal(client.calls.length, 0, "should not even call Cognito when allowlist is empty");
});

test("returns null when GetUser throws (invalid/expired token)", async () => {
  const client = fakeClient({ error: Object.assign(new Error("bad"), { name: "NotAuthorizedException" }) });
  const result = await validateCognitoToken(client, FakeGetUserCommand, `Bearer ${token}`, {
    allowlist: ALLOWLIST,
  });
  assert.equal(result, null);
});

test("reads the allowlist from process.env.ADMIN_ALLOWLIST by default", async () => {
  const prev = process.env.ADMIN_ALLOWLIST;
  process.env.ADMIN_ALLOWLIST = ALLOWLIST;
  try {
    const client = fakeClient({ attributes: VERIFIED("christian.perez@altivum.ai") });
    const result = await validateCognitoToken(client, FakeGetUserCommand, `Bearer ${token}`);
    assert.ok(result);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_ALLOWLIST;
    else process.env.ADMIN_ALLOWLIST = prev;
  }
});

for (const [name, claims] of [
  ["foreign issuer", { iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Attacker" }],
  ["wrong app client", { client_id: "attackerclient" }],
  ["ID token", { token_use: "id" }],
  ["expired token", { exp: 1 }],
]) {
  test(`rejects a signed ${name} before calling GetUser`, async () => {
    const client = fakeClient({ attributes: VERIFIED("christian.perez@altivum.io") });
    assert.equal(
      await validateCognitoToken(client, FakeGetUserCommand, `Bearer ${accessToken(claims)}`, {
        allowlist: ALLOWLIST,
      }),
      null,
    );
    assert.equal(client.calls.length, 0);
  });
}

test("rejects a forged signature", async () => {
  const client = fakeClient({ attributes: VERIFIED("christian.perez@altivum.io") });
  const parts = token.split(".");
  parts[2] = Buffer.alloc(256).toString("base64url");
  assert.equal(
    await validateCognitoToken(client, FakeGetUserCommand, `Bearer ${parts.join(".")}`, { allowlist: ALLOWLIST }),
    null,
  );
  assert.equal(client.calls.length, 0);
});

test("fails closed without trusted pool or app-client configuration", async () => {
  for (const config of [{ userPoolId: "" }, { clientId: "" }]) {
    const client = fakeClient({ attributes: VERIFIED("christian.perez@altivum.io") });
    assert.equal(
      await validateCognitoToken(client, FakeGetUserCommand, `Bearer ${token}`, { allowlist: ALLOWLIST, ...config }),
      null,
    );
    assert.equal(client.calls.length, 0);
  }
});

test("rejects a GetUser subject that differs from the verified token", async () => {
  const client = fakeClient({ attributes: VERIFIED("christian.perez@altivum.io") });
  assert.equal(
    await validateCognitoToken(client, FakeGetUserCommand, `Bearer ${accessToken({ sub: "other" })}`, {
      allowlist: ALLOWLIST,
    }),
    null,
  );
});
