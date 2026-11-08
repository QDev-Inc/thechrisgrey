import { getOrCreateDeviceId } from './deviceId';
import { getTurnstileToken } from './turnstile';
import { withTraceId } from './traceId';
import { createLogger } from './logger';
import { CircuitBreaker, CircuitOpenError } from './resilience';

const log = createLogger('SessionToken');

/**
 * Client-side session-token manager.
 *
 * Replaces the old chatSigning/blueprintSigning HMAC headers — which required a
 * signing secret in the browser bundle (it never was secret). Instead, the client
 * obtains short-lived, scoped tokens from the issuer Lambda after a Cloudflare
 * Turnstile check, caches them, and attaches them as `Authorization: Bearer`.
 * The signing secret now lives only on the server.
 *
 * The manager is a dependency-injected factory so its caching/expiry/dedup logic
 * is unit-tested without a browser, network, or Turnstile. The default singleton
 * (`getSessionToken`) wires the real deps.
 */

export type SessionScope = 'chat' | 'blueprint' | 'mcp';

export interface SessionTokenDeps {
  /** Issuer Function URL. Empty string disables tokens (returns "" — server then rejects or, in dev, accepts). */
  endpoint: string;
  fetchImpl: typeof fetch;
  getTurnstileToken: () => Promise<string>;
  getDeviceId: () => string;
  /** Current time in ms (injected for deterministic tests). */
  now: () => number;
}

interface IssuerResponse {
  chatToken: string;
  blueprintToken: string;
  mcpToken: string;
  mcpExpiresIn: number;
  chatExpiresIn: number;
  blueprintExpiresIn: number;
}

interface CachedToken {
  token: string;
  exp: number; // unix seconds
}

// Refresh a little before true expiry so an in-flight request never carries a
// token that expires server-side mid-handling.
const REFRESH_MARGIN_SEC = 30;

export function createSessionTokenManager(deps: SessionTokenDeps) {
  const cache: Partial<Record<SessionScope, CachedToken>> = {};
  let inflight: Promise<void> | null = null;
  const breaker = new CircuitBreaker('session-token-issuer', { threshold: 5, cooldown: 30_000 });

  function isValid(scope: SessionScope): boolean {
    const c = cache[scope];
    if (!c) return false;
    const nowSec = Math.floor(deps.now() / 1000);
    return c.exp - nowSec > REFRESH_MARGIN_SEC;
  }

  async function refresh(): Promise<void> {
    const turnstileToken = await deps.getTurnstileToken();
    const res = await deps.fetchImpl(
      deps.endpoint,
      withTraceId({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deps.getDeviceId(), turnstileToken }),
      }),
    );
    if (!res.ok) {
      throw new Error(`session issuance failed: ${res.status}`);
    }
    const data = (await res.json()) as IssuerResponse;
    const nowSec = Math.floor(deps.now() / 1000);
    cache.mcp = { token: data.mcpToken, exp: nowSec + data.mcpExpiresIn };
    cache.chat = { token: data.chatToken, exp: nowSec + data.chatExpiresIn };
    cache.blueprint = { token: data.blueprintToken, exp: nowSec + data.blueprintExpiresIn };
  }

  async function getToken(scope: SessionScope): Promise<string> {
    if (!deps.endpoint) return '';
    if (isValid(scope)) return cache[scope]!.token;
    try {
      // Dedupe concurrent issuance: one Turnstile challenge + one fetch serves
      // every caller waiting on a refresh, and mints both scopes at once.
      // Circuit breaker prevents repeated Turnstile challenges when the issuer
      // is down — fails fast after 5 consecutive failures, then retries after
      // a 30s cooldown.
      if (!inflight) {
        inflight = breaker.execute(refresh).finally(() => {
          inflight = null;
        });
      }
      await inflight;
    } catch (err) {
      // Graceful: request goes out unauthenticated → server rejects with a clear
      // path. Surface the cause so a token-issuance failure (Turnstile, the issuer
      // endpoint, CORS, circuit open) is diagnosable instead of a silent "Unable to process request".
      if (err instanceof CircuitOpenError) {
        log.warn('circuit_open', { circuit: err.circuitName, remainingCooldown: err.remainingCooldown });
      } else {
        log.warn('token_issuance_failed', { error: err instanceof Error ? err.message : String(err) });
      }
      return '';
    }
    return cache[scope]?.token ?? '';
  }

  return {
    getToken,
    reset() {
      delete cache.mcp;
      delete cache.chat;
      delete cache.blueprint;
      breaker.reset();
    },
  };
}

const SESSION_ENDPOINT = import.meta.env.VITE_SESSION_ENDPOINT || '';

export const sessionTokens = createSessionTokenManager({
  endpoint: SESSION_ENDPOINT,
  fetchImpl: (...args: Parameters<typeof fetch>) => fetch(...args),
  getTurnstileToken,
  getDeviceId: () => getOrCreateDeviceId() ?? '',
  now: () => Date.now(),
});

/** Get a valid bearer token for the given scope ("" if tokens aren't configured). */
export const getSessionToken = (scope: SessionScope): Promise<string> => sessionTokens.getToken(scope);
