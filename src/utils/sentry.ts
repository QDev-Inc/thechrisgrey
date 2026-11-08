import { sanitizeTelemetry } from './telemetryPrivacy';
let Sentry: typeof import('@sentry/react') | null = null;
let loading = false;
import { getConsent } from './consent';

const DSN = import.meta.env.VITE_SENTRY_DSN || '';
const ENVIRONMENT = import.meta.env.MODE || 'production';
const RELEASE_ID = import.meta.env.VITE_RUM_RELEASE_ID || 'dev';

const isTestEnv = import.meta.env.MODE === 'test' || !!import.meta.env.VITEST;
const isConfigured = !isTestEnv && DSN.length > 0;

// Mutable: flipped by enableSentry()/disableSentry() as consent changes.
let initialized = false;

/**
 * Initialize Sentry. Idempotent and safe to call repeatedly. No-op unless Sentry
 * is configured (DSN set, not a test run) AND the visitor has granted consent —
 * so session replay never runs for a visitor who declined or hasn't chosen.
 */
export function enableSentry(): void {
  if (initialized || loading || !isConfigured || getConsent() !== 'granted') return;
  loading = true;
  void import('@sentry/react')
    .then((sdk) => {
      if (getConsent() !== 'granted') return;
      Sentry = sdk;
      sdk.init({
        dsn: DSN,
        environment: ENVIRONMENT,
        release: RELEASE_ID,
        tracesSampleRate: 0,
        sendDefaultPii: false,
        beforeSend: (event) => (window.location.pathname === '/admin' ? null : sanitizeTelemetry(event)),
        beforeBreadcrumb: (breadcrumb) => sanitizeTelemetry(breadcrumb),
      });
      initialized = true;
    })
    .catch(() => undefined)
    .finally(() => {
      loading = false;
    });
}

/**
 * Tear down Sentry when the visitor withdraws consent. Flushes and closes the
 * client so no further events or session replays are sent. No-op if not active.
 */
export function disableSentry(): void {
  if (!initialized || !Sentry) return;
  void Sentry.close();
  initialized = false;
}

/**
 * Check if Sentry is initialized and active.
 */
export function isSentryInitialized(): boolean {
  return initialized;
}

/**
 * Capture an error with optional context. When Sentry is not configured,
 * this is a no-op (the RUM module handles the console fallback).
 */
export function captureSentryError(error: Error, context?: Record<string, unknown>): void {
  if (!initialized || !Sentry) return;

  Sentry.captureException(error, {
    extra: sanitizeTelemetry(context),
  });
}

/**
 * Set user context for error correlation. Uses the same anonymous device hash
 * as RUM, no PII.
 */
export function setSentryUserContext(context: Record<string, unknown>): void {
  if (!initialized || !Sentry) return;

  Sentry.setUser({
    id: context.deviceId as string,
    segment: ENVIRONMENT,
  });

  Sentry.setTags({
    environment: ENVIRONMENT,
    release: RELEASE_ID,
  });

  if (context.sessionStart) {
    Sentry.setContext('session', { start: context.sessionStart });
  }
}

/**
 * Add a breadcrumb to Sentry's breadcrumb buffer. This forwards breadcrumbs
 * from the RUM module so both services have the same user-action context.
 */
export function addSentryBreadcrumb(type: string, message: string, data?: Record<string, unknown>): void {
  if (!initialized || !Sentry) return;

  Sentry.addBreadcrumb({
    type,
    message,
    data,
    level: type === 'error' ? 'error' : 'info',
  });
}
