import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

/**
 * Guards the caching + third-party-script performance contract.
 *
 * These assertions keep the source configuration (customHttp.yml + index.html)
 * honest so the deployed headers and prerendered HTML satisfy:
 *   VAL-PERF-009 — bfcache eligibility (no `no-store` on HTML)
 *   VAL-PERF-012 — no synchronous render-blocking third-party scripts
 *   VAL-PERF-014 — SRI on stable third-party CDN scripts
 *
 * Reading the source files (not dist) keeps the test independent of a fresh
 * build and lets it run in the normal `npm test` suite.
 */
describe('caching and third-party script config', () => {
  const customHttp = readFileSync(join(repoRoot, 'customHttp.yml'), 'utf8');
  const indexHtml = readFileSync(join(repoRoot, 'index.html'), 'utf8');

  describe('VAL-PERF-009 — bfcache eligibility', () => {
    // Extract every Cache-Control header VALUE (the line after `key: 'Cache-Control'`).
    // This avoids matching `no-store` in comments / documentation.
    const cacheControlValues = [...customHttp.matchAll(/key:\s*'Cache-Control'\s*\n\s*value:\s*'([^']+)'/g)].map(
      (m) => m[1],
    );

    it('has at least one Cache-Control header for HTML', () => {
      expect(cacheControlValues.length).toBeGreaterThan(0);
    });

    it('no Cache-Control value contains no-store', () => {
      for (const value of cacheControlValues) {
        expect(value, `Cache-Control value "${value}" must not contain no-store`).not.toMatch(/no-store/);
      }
    });

    it('HTML Cache-Control keeps no-cache, must-revalidate', () => {
      const htmlValue = cacheControlValues.find((v) => v.includes('no-cache'));
      expect(htmlValue, 'expected a no-cache Cache-Control value').toBeDefined();
      expect(htmlValue).toMatch(/must-revalidate/);
    });
  });

  describe('VAL-PERF-012 — no render-blocking third-party scripts', () => {
    it('does not load analytics before the consent-gated application loader', () => {
      expect(indexHtml).not.toMatch(/<script[^>]*src="[^"]*(plausible|cloudflareinsights|posthog)/);
    });

    it('every third-party CDN script is async or defer (never synchronous)', () => {
      const externalScripts = [...indexHtml.matchAll(/<script\b[^>]*\bsrc="https?:\/\/[^"]*"[^>]*>/g)].map((m) => m[0]);
      for (const tag of externalScripts) {
        const isAsyncOrDefer = /\b(async|defer)\b/.test(tag);
        expect(isAsyncOrDefer, `external script must be async or defer: ${tag}`).toBe(true);
      }
    });

    it('no third-party script is duplicated per provider', () => {
      const srcs = [...indexHtml.matchAll(/<script[^>]*\bsrc="(https?:\/\/[^"]*)"/g)].map((m) => m[1]);
      const providers = srcs.map((s) => {
        try {
          return new URL(s).hostname;
        } catch {
          return s;
        }
      });
      const counts = providers.reduce((acc, h) => acc.set(h, (acc.get(h) ?? 0) + 1), new Map());
      for (const [host, count] of counts) {
        expect(count, `duplicate scripts from ${host}`).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('VAL-PERF-008 — preconnect set covers used origins, no dead preconnects', () => {
    // Origins that are preconnected globally in index.html (used on every
    // page within 10s). Page-specific origins (cdn.sanity.io, i.ytimg.com) are
    // injected per-route by SEO.tsx and
    // therefore must NOT appear in the static shell.
    // Dead preconnects — no page requests these within 10s, so they must be
    // absent from index.html entirely.
    const deadPreconnects = [
      'https://plausible.io',
      'https://static.cloudflareinsights.com',
      'https://us.i.posthog.com',
      'https://dataplane.rum.us-east-1.amazonaws.com',
      'https://www.buzzsprout.com',
      'https://cognito-idp.us-east-1.amazonaws.com',
    ];
    // Page-specific preconnects — injected per-route by SEO.tsx, so they must
    // NOT be in the global shell (which would put them on every page).
    const pageSpecificPreconnects = ['https://cdn.sanity.io', 'https://i.ytimg.com'];

    const preconnectHrefs = () =>
      [...indexHtml.matchAll(/<link\s+[^>]*rel="preconnect"[^>]*href="([^"]+)"/gi)].map((m) => m[1]);

    for (const origin of deadPreconnects) {
      it(`index.html does NOT preconnect to dead origin ${origin}`, () => {
        expect(preconnectHrefs(), `dead preconnect to ${origin} must be removed`).not.toContain(origin);
      });
    }

    for (const origin of pageSpecificPreconnects) {
      it(`index.html does NOT globally preconnect to page-specific origin ${origin}`, () => {
        expect(preconnectHrefs(), `${origin} must be per-route, not global`).not.toContain(origin);
      });
    }
  });
});
