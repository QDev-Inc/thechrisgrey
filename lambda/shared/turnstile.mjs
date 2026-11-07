import { withTimeout } from "./timeout.mjs";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

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
 * @returns {Promise<boolean>}
 */
export async function verifyTurnstile(token, secret, remoteIp, fetchImpl = fetch) {
  try {
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token || "");
    if (remoteIp) form.set("remoteip", remoteIp);

    const response = await withTimeout(
      fetchImpl(TURNSTILE_VERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      }),
      5000,
      "turnstile_verify",
    );
    const result = /** @type {any} */ (await response.json());
    return result?.success === true;
  } catch {
    return false;
  }
}
