import { generateKeyPairSync, sign } from "node:crypto";
import { getCognitoVerifier } from "../auth.mjs";

export const USER_POOL_ID = "us-east-1_TrustedPool";
export const CLIENT_ID = "trustedclient";
export const SUBJECT = "00000000-0000-4000-8000-000000000001";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = "test-key";
const jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }] };
getCognitoVerifier(USER_POOL_ID, CLIENT_ID).cacheJwks(jwks);

export function accessToken(overrides = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "RS256", kid })}.${encode({
    iss: `https://cognito-idp.us-east-1.amazonaws.com/${USER_POOL_ID}`,
    client_id: CLIENT_ID,
    token_use: "access",
    sub: SUBJECT,
    iat: now,
    exp: now + 300,
    ...overrides,
  })}`;
  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")}`;
}

export function configureCognito(verifierFactory = getCognitoVerifier) {
  verifierFactory(USER_POOL_ID, CLIENT_ID).cacheJwks(jwks);
  process.env.COGNITO_USER_POOL_ID = USER_POOL_ID;
  process.env.COGNITO_CLIENT_ID = CLIENT_ID;
}
