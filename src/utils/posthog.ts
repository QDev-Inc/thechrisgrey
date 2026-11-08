import type { PostHog } from 'posthog-js';

/**
 * Consent-gated PostHog loader.
 *
 * PostHog is OPTIONAL: if VITE_POSTHOG_KEY isn't set, every function here is a
 * no-op and posthog-js is never loaded (so the consent banner also stays hidden).
 * When configured, posthog-js is dynamically imported only AFTER consent, so its
 * weight never reaches visitors who decline or haven't chosen yet — keeping the
 * default experience cookie-free and light, exactly like before.
 */
let instance: PostHog | null = null;
let loading = false;

// Subscribers notified when PostHog's remote feature flags load or change, so
// the feature-flag layer can re-resolve and components can re-render once a
// percentage-rollout / targeted flag arrives from the PostHog server.
const flagListeners = new Set<() => void>();

function notifyFlagListeners(): void {
  flagListeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // A listener must never break flag delivery.
    }
  });
}

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com';

export function isPostHogConfigured(): boolean {
  return typeof POSTHOG_KEY === 'string' && POSTHOG_KEY.length > 0;
}

/**
 * Load + initialize PostHog. Call ONLY after the visitor grants consent.
 * Idempotent and failure-safe (a network/import error must never break the app).
 */
export async function enablePostHog(): Promise<void> {
  if (instance || loading || !isPostHogConfigured()) return;
  loading = true;
  try {
    const { default: posthog } = await import('posthog-js');
    posthog.init(POSTHOG_KEY as string, {
      api_host: POSTHOG_HOST,
      capture_pageview: false, // captured manually per SPA route change (see App.tsx)
      capture_pageleave: true,
      autocapture: false,
      persistence: 'localStorage+cookie',
      // Session replay never records form-field values (newsletter/contact emails, etc.).
      disable_session_recording: true,
      before_send: (event) => {
        if (!event || window.location.pathname === '/admin') return null;
        for (const key of Object.keys(event.properties)) {
          if (!/url|referrer/i.test(key) || typeof event.properties[key] !== 'string') continue;
          try {
            const url = new URL(event.properties[key], window.location.origin);
            event.properties[key] = `${url.origin}${url.pathname}`;
          } catch {
            delete event.properties[key];
          }
        }
        return event;
      },
    });
    instance = posthog;
    // Re-resolve feature flags whenever PostHog delivers an updated set (initial
    // load and any live change), enabling remote rollouts without a redeploy.
    posthog.onFeatureFlags(() => notifyFlagListeners());
    // Capture the entry pageview (the page in view at consent/load time). Further
    // SPA navigations are captured by the route-change effect in App.tsx.
    posthog.capture('$pageview');
  } catch {
    // Swallow — analytics must never affect the user experience.
  } finally {
    loading = false;
  }
}

/** Withdraw consent: stop capturing and forget the visitor. */
export function disablePostHog(): void {
  if (!instance) return;
  try {
    instance.opt_out_capturing();
    instance.reset();
  } catch {
    // No-op.
  }
  instance = null;
  // Flags are no longer available; let consumers fall back to env/defaults.
  notifyFlagListeners();
}

/**
 * Read a remote feature flag value from PostHog. Returns `undefined` until
 * PostHog is initialized (consent granted) and flags have loaded, so callers
 * transparently fall back to their env/default value. A boolean flag returns a
 * boolean; a multivariate flag returns its string variant key.
 */
export function getPostHogFeatureFlag(key: string): boolean | string | undefined {
  try {
    return instance?.getFeatureFlag(key);
  } catch {
    return undefined;
  }
}

/**
 * Subscribe to PostHog remote feature-flag changes. The callback fires when
 * flags first load, on any live update, and when consent is withdrawn. Returns
 * an unsubscribe function.
 */
export function subscribeToPostHogFeatureFlags(callback: () => void): () => void {
  flagListeners.add(callback);
  return () => void flagListeners.delete(callback);
}

/** Forward a named event to PostHog. No-op until enablePostHog() has run. */
export function capturePostHogEvent(event: string, props?: Record<string, unknown>): void {
  try {
    instance?.capture(event, props);
  } catch {
    // No-op.
  }
}

/** Capture an SPA pageview. No-op until enablePostHog() has run. */
export function capturePostHogPageview(): void {
  try {
    instance?.capture('$pageview');
  } catch {
    // No-op.
  }
}
