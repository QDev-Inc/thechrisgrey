/**
 * Cloudflare Turnstile — invisible token acquisition.
 *
 * Loads the Turnstile script lazily (only when a token is first needed, e.g. the
 * first chat send or a blueprint generation — never on every page load), renders
 * an invisible widget, and resolves with a one-time token. The session-token
 * issuer Lambda verifies that token server-side before minting session tokens.
 *
 * Browser-only: all DOM/window access is inside the function bodies, so importing
 * this module is safe during SSR/prerender. The token logic that consumes this is
 * unit-tested separately by injecting a fake getTurnstileToken (see sessionToken.ts).
 */

interface TurnstileApi {
  render: (
    container: HTMLElement,
    opts: {
      sitekey: string;
      action?: string;
      // Turnstile has no "invisible" size (that's reCAPTCHA). Invisibility is
      // controlled by `appearance` ('interaction-only' = hidden unless a challenge
      // needs interaction); `execution: 'execute'` defers the challenge to execute().
      appearance?: 'always' | 'execute' | 'interaction-only';
      execution?: 'render' | 'execute';
      callback?: (token: string) => void;
      // Cloudflare passes an error code (e.g. "110200" = domain not in the widget's
      // allowlist) to the error callback — capture it for diagnostics.
      'error-callback'?: (errorCode?: string) => void;
      'timeout-callback'?: () => void;
    },
  ) => string;
  execute: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
// Hard ceiling on a single challenge. Without it, a widget that renders but whose
// callbacks never fire (Cloudflare degradation, frozen iframe) would hang the
// awaiting send/generate forever — the fetch AbortController never covers this.
const TOKEN_TIMEOUT_MS = 12000;

/**
 * Surface why a Turnstile token could not be obtained. Without this, a token
 * failure (most often a misconfigured widget — e.g. the prod domain missing from
 * the Turnstile allowlist, error 110200) is swallowed and the user just sees a
 * generic "Unable to process request." Cloudflare error codes:
 * https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/
 */
import { createLogger } from './logger';

const log = createLogger('Turnstile');

function warnTurnstile(reason: string, detail?: unknown): void {
  log.warn('token_not_obtained', { reason, detail: detail ?? '' });
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window !== 'undefined' && window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT_URL;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptPromise = null; // allow a later retry
        warnTurnstile('script failed to load', SCRIPT_URL);
        reject(new Error('turnstile script failed to load'));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

async function waitForApi(timeoutMs = 5000): Promise<TurnstileApi> {
  const start = Date.now();
  while (!window.turnstile) {
    if (Date.now() - start > timeoutMs) {
      warnTurnstile('api unavailable after script load');
      throw new Error('turnstile api unavailable');
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return window.turnstile;
}

/**
 * Resolve with a fresh, single-use Turnstile token. Returns "" if Turnstile is
 * not configured (no site key) so local/dev works without it.
 */
export async function getTurnstileToken(action: 'session' | 'contact' | 'newsletter' = 'session'): Promise<string> {
  if (!SITE_KEY) return '';
  await loadScript();
  const api = await waitForApi();

  // Turnstile needs the container in layout to run the challenge — `display:none`
  // can break it. With appearance:'interaction-only' nothing renders unless a
  // challenge actually needs interaction; pin it bottom-right so that rare case
  // is visible and usable rather than hidden.
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;';
  document.body.appendChild(container);

  // Mutable holder (object props avoid the declare-then-assign / const churn).
  const ctl: { settled: boolean; timer?: ReturnType<typeof setTimeout>; widgetId?: string } = {
    settled: false,
  };

  return new Promise<string>((resolve, reject) => {
    const teardown = () => {
      if (ctl.timer) clearTimeout(ctl.timer);
      try {
        if (ctl.widgetId) api.remove(ctl.widgetId);
      } catch {
        /* noop */
      }
      container.remove();
    };
    const succeed = (token: string) => {
      if (ctl.settled) return;
      ctl.settled = true;
      teardown();
      resolve(token);
    };
    const fail = (err: Error) => {
      if (ctl.settled) return;
      ctl.settled = true;
      teardown();
      reject(err);
    };

    // The callbacks fire after render() returns, so they safely read ctl.widgetId.
    ctl.widgetId = api.render(container, {
      sitekey: SITE_KEY,
      action,
      appearance: 'interaction-only',
      execution: 'execute',
      callback: (token: string) => succeed(token),
      'error-callback': (errorCode?: string) => {
        warnTurnstile('challenge error', errorCode);
        fail(new Error(`turnstile error: ${errorCode ?? 'unknown'}`));
      },
      'timeout-callback': () => {
        warnTurnstile('challenge timed out');
        fail(new Error('turnstile timeout'));
      },
    });

    // Outer ceiling: if no callback ever fires, reject (and clean up) so callers
    // don't hang. sessionToken.getToken catches this and returns "".
    ctl.timer = setTimeout(() => {
      warnTurnstile(`no callback within ${TOKEN_TIMEOUT_MS}ms`);
      fail(new Error('turnstile token timeout'));
    }, TOKEN_TIMEOUT_MS);

    // Invisible widgets run the challenge on demand.
    try {
      api.execute(ctl.widgetId);
    } catch {
      /* some modes auto-execute on render */
    }
  });
}
