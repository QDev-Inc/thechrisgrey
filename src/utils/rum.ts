/**
 * CloudWatch RUM (Real User Monitoring) with breadcrumbs and user context.
 *
 * Captures client-side JavaScript errors, page load timing, web vitals, and
 * HTTP request failures. Source maps are uploaded to S3 during the Amplify
 * build so stack traces are unminified in the RUM console.
 *
 * Enhancements over basic RUM:
 *  - Breadcrumb buffer: tracks the last 20 user actions (navigation, clicks,
 *    console errors) and attaches them to error reports for debugging context.
 *  - User context: attaches an anonymous device hash to RUM sessions so errors
 *    can be correlated across visits without PII.
 *  - Global error handlers: captures unhandled promise rejections and window
 *    errors that bypass React's ErrorBoundary.
 *  - Error context: custom attributes (component stack, page name, breadcrumbs)
 *    are recorded as a pre-error event so they appear alongside the error in RUM.
 *
 * Opt-in: only active when VITE_RUM_APP_MONITOR_ID is set. Inactive otherwise
 * (no cookies, no Cognito auth, no telemetry). Breadcrumbs are still buffered
 * so they're available if RUM is enabled later in the session.
 *
 * Cookie consent: RUM runs cookieless by default so error and web-vitals
 * monitoring cover every visitor (including those who decline or haven't chosen),
 * honoring the consent banner's "Decline keeps the site cookie-free" promise.
 * Cookies (the persistent user/session IDs that power unique-user counts and the
 * user journey) are only enabled after the visitor accepts — see grantRumCookies()
 * / revokeRumCookies(), driven by ConsentBanner and the Privacy reset control.
 *
 * AWS resources (us-east-1):
 *   - App Monitor: thechrisgrey (ID from AWS console or CLI)
 *   - Cognito Identity Pool: thechrisgrey-rum (for anonymous auth)
 *   - S3 bucket: thechrisgrey-rum-sourcemaps (for source map resolution)
 */

import type { AwsRum, AwsRumConfig } from 'aws-rum-web';
import { sanitizeTelemetry } from './telemetryPrivacy';
import { createLogger } from './logger';
import { getConsent } from './consent';

const log = createLogger('RUM');

const APP_MONITOR_ID = import.meta.env.VITE_RUM_APP_MONITOR_ID || '';
const IDENTITY_POOL_ID = import.meta.env.VITE_RUM_IDENTITY_POOL_ID || '';
const REGION = import.meta.env.VITE_RUM_REGION || 'us-east-1';
const RELEASE_ID = import.meta.env.VITE_RUM_RELEASE_ID || 'dev';

// Skip initialization in test environments to avoid Cognito network calls.
const isTestEnv = import.meta.env.MODE === 'test' || !!import.meta.env.VITEST;

const isConfigured =
  !isTestEnv && import.meta.env.VITE_ENABLE_RUM === 'true' && APP_MONITOR_ID.length > 0 && IDENTITY_POOL_ID.length > 0;
let isInitialized = false;

let awsRum: AwsRum | null = null;

// ── Breadcrumb system ───────────────────────────────────────────────────────

export interface Breadcrumb {
  timestamp: string;
  type: 'navigation' | 'click' | 'error' | 'http' | 'console' | 'custom';
  message: string;
  data?: Record<string, unknown>;
}

const MAX_BREADCRUMBS = 20;
const breadcrumbs: Breadcrumb[] = [];
let userContext: Record<string, unknown> = {};

/**
 * Add a breadcrumb to the buffer. Breadcrumbs are attached to error reports
 * to provide context about what the user was doing before the error occurred.
 */
export function addBreadcrumb(type: Breadcrumb['type'], message: string, data?: Record<string, unknown>): void {
  breadcrumbs.push({
    timestamp: new Date().toISOString(),
    type,
    message: sanitizeTelemetry(message),
    data: sanitizeTelemetry(data),
  });
  if (breadcrumbs.length > MAX_BREADCRUMBS) {
    breadcrumbs.shift();
  }
}

/**
 * Get a copy of the current breadcrumb buffer (for error reports or debugging).
 */
export function getBreadcrumbs(): Breadcrumb[] {
  return [...breadcrumbs];
}

/**
 * Set anonymous user context (device hash, session info) for error correlation.
 * No PII — only the SHA-256 device hash.
 */
export function setUserContext(context: Record<string, unknown>): void {
  userContext = { ...context };
  if (awsRum) {
    awsRum.recordEvent('user_context', context);
  }
}

// ── RUM initialization ──────────────────────────────────────────────────────

if (isConfigured) {
  void import('aws-rum-web')
    .then(({ AwsRum }) => {
      const config: AwsRumConfig = {
        // Cookieless unless the visitor has already accepted (returning consenter).
        // A live Accept flips this at runtime via grantRumCookies().
        allowCookies: getConsent() === 'granted',
        identityPoolId: IDENTITY_POOL_ID,
        sessionSampleRate: 1,
        endpoint: `https://dataplane.rum.${REGION}.amazonaws.com`,
        telemetries: ['performance'],
        releaseId: RELEASE_ID,
      };

      awsRum = new AwsRum(APP_MONITOR_ID, '1.0.0', REGION, config);
      isInitialized = true;
    })
    .catch(() => undefined);
}

// ── Global error handlers ───────────────────────────────────────────────────

// Capture unhandled promise rejections that bypass React's ErrorBoundary
// (e.g., async fetch failures outside try/catch, lazy import failures).
if (typeof window !== 'undefined' && !isTestEnv) {
  window.addEventListener('unhandledrejection', (event) => {
    const error =
      event.reason instanceof Error ? event.reason : new Error(`Unhandled promise rejection: ${String(event.reason)}`);
    addBreadcrumb('error', 'unhandledrejection', {
      reason: event.reason instanceof Error ? event.reason.message : String(event.reason),
    });
    captureError(error, { source: 'unhandledrejection' });
  });

  window.addEventListener('error', (event) => {
    if (event.error) {
      addBreadcrumb('error', 'window.onerror', {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
      captureError(event.error, {
        source: 'window.onerror',
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    }
  });
}

// ── Error capture with context ──────────────────────────────────────────────

/**
 * Record an error event in RUM with breadcrumbs and user context.
 * Falls back to console.error when RUM is not configured.
 */
export function captureError(error: Error, context?: Record<string, unknown>) {
  // Always add the error as a breadcrumb (for subsequent errors in the same session)
  addBreadcrumb('error', error.message, { name: error.name });

  if (!awsRum) {
    log.error('uncaught_error', { error: error.message, ...context });
    return;
  }

  // Record error context (breadcrumbs, user context, custom attributes) as a
  // pre-error event so it appears alongside the error in the RUM console.
  const errorContext = {
    ...context,
    userContext,
    breadcrumbs: getBreadcrumbs(),
  };
  awsRum.recordEvent('error_context', sanitizeTelemetry(errorContext));
  awsRum.recordError(new Error(sanitizeTelemetry(error.message)));
}

/**
 * Record a custom event in RUM (also adds a breadcrumb).
 */
export function recordEvent(eventType: string, eventData?: Record<string, unknown>) {
  addBreadcrumb('custom', eventType, eventData);
  if (!awsRum) return;
  awsRum.recordEvent(eventType, sanitizeTelemetry(eventData || {}));
}

/**
 * Record a page view manually (for client-side route changes) with breadcrumb.
 */
export function recordPageView(pageId: string) {
  addBreadcrumb('navigation', pageId);
  if (!awsRum) return;
  awsRum.recordPageView(pageId.split(/[?#]/)[0]);
}

// ── Cookie consent controls ─────────────────────────────────────────────────

/**
 * Enable RUM's persistent user/session cookies. Call after the visitor accepts
 * analytics. No-op when RUM isn't initialized. This unlocks unique-user counts,
 * session counts, and the user journey; error and web-vitals telemetry already
 * run regardless of cookie state.
 */
export function grantRumCookies(): void {
  if (!awsRum) return;
  awsRum.allowCookies(true);
}

/**
 * Disable RUM cookies and purge any already set (session, user, cached
 * credentials). Call when the visitor declines or withdraws consent. No-op when
 * RUM isn't initialized. RUM keeps recording cookieless error/web-vitals data.
 */
export function revokeRumCookies(): void {
  if (!awsRum) return;
  awsRum.allowCookies(false);
  awsRum.clearCookies();
}

export { isInitialized as isRumInitialized };
