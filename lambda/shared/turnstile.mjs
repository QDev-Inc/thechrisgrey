import { withTimeout } from "./timeout.mjs";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** @param {string} secret */
export function isTurnstileConfigured(secret) {
  return (
    Boolean(secret) || (!process.env.AWS_LAMBDA_FUNCTION_NAME && process.env.ALLOW_LOCAL_TURNSTILE_BYPASS === "true")
  );
}

/**
 * Verify a Cloudflare Turnstile token server-side.
 *
 * Network and response parsing failures intentionally fail closed. Callers may
 * skip this entirely in local development by leaving their Turnstile secret
 * unset, but production handlers must require a positive verification result.
 *
 * @param {string} token
 * @param {string} secret
 * @param {string} [remoteIp]
 * @param {typeof fetch} [fetchImpl=fetch]
 * @param {{ action?: string, hostnames?: string[] }} [options]
 * @returns {Promise<boolean>}
 */
export async function verifyTurnstile(
  token,
  secret,
  remoteIp,
  fetchImpl = fetch,
  { action = "session", hostnames } = {},
) {
  if (!token || token.length > 2048 || !secret) return false;
  try {
    const expectedHosts =
      hostnames ||
      (process.env.CORS_ORIGIN || "https://thechrisgrey.com")
        .split(",")
        .map((origin) => new URL(origin.trim()).hostname);
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token || "");
    if (remoteIp) form.set("remoteip", remoteIp);

    const response = await withTimeout(
      fetchImpl(TURNSTILE_VERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: AbortSignal.timeout(5000),
      }),
      5000,
      "turnstile_verify",
    );
    if (!response.ok) return false;
    const result = /** @type {any} */ (await response.json());
    return (
      result?.success === true &&
      result.action === action &&
      expectedHosts.includes(result.hostname) &&
      !(process.env.AWS_LAMBDA_FUNCTION_NAME && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(result.hostname))
    );
  } catch {
    return false;
  }
}
