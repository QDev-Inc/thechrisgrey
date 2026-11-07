import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

/**
 * Guards the security-header contract declared in customHttp.yml.
 *
 * Amplify Hosting applies custom headers from customHttp.yml at deploy time
 * (NOT from a customHeaders block in amplify.yml, which AWS deprecated). These
 * assertions read the SOURCE file so the test runs in the normal `npm test`
 * suite without a fresh build, and they keep the deployed headers honest so
 * the production site satisfies:
 *   VAL-SEC-001 — CSP is enforced and well-scoped
 *   VAL-SEC-002 — HSTS includes preload and subdomains
 *   VAL-SEC-003 — Cross-origin isolation and framing headers are present
 *   VAL-SEC-004 — Permissions-Policy is expanded
 *   VAL-CROSS-004 — Enforced CSP allows all chat widget resources
 *
 * Deployment-dependent (`curl -I https://thechrisgrey.com/`) validation is
 * documented in the validation contract; these source-level assertions are the
 * pre-deploy gate.
 */
describe('security headers (customHttp.yml)', () => {
  const customHttp = readFileSync(join(repoRoot, 'customHttp.yml'), 'utf8');

  // Security headers (CSP, HSTS, COOP, CORP, Permissions-Policy, X-Frame-
  // Options, X-Content-Type-Options, Referrer-Policy) are declared only in the
  // top-level `**/*` block; the other blocks carry only Cache-Control. So a
  // global scan for `- key: '<name>'` -> `value: '<value>'` is unique per
  // security header and is not polluted by the caching rules. Comments are
  // skipped because they don't match the `value:` capture. Values may be
  // single- or double-quoted (the CSP value contains single quotes like
  // `'self'`, so it is double-quoted in the YAML).
  const headerPairs = [...customHttp.matchAll(/- key: '([^']+)'\n\s+value: (?:"([^"]*)"|'([^']*)')/g)].map((m) => ({
    key: m[1],
    value: m[2] ?? m[3] ?? '',
  }));
  const header = (name) => headerPairs.find((h) => h.key === name)?.value;

  describe('VAL-SEC-001 — CSP is enforced and well-scoped', () => {
    it('emits Content-Security-Policy (not Report-Only)', () => {
      const csp = header('Content-Security-Policy');
      expect(csp, 'Content-Security-Policy header must exist').toBeDefined();
      // The Report-Only variant must NOT be present (it would shadow enforcement).
      const reportOnly = header('Content-Security-Policy-Report-Only');
      expect(reportOnly, 'Content-Security-Policy-Report-Only must be removed').toBeUndefined();
    });

    it('CSP contains all required directives', () => {
      const csp = header('Content-Security-Policy');
      const required = [
        'default-src',
        'script-src',
        'style-src',
        'font-src',
        'img-src',
        'media-src',
        'connect-src',
        'frame-src',
        'worker-src',
        'base-uri',
        'form-action',
        'frame-ancestors',
        'object-src',
        'upgrade-insecure-requests',
      ];
      for (const directive of required) {
        expect(csp, `CSP must include ${directive}`).toMatch(new RegExp(`\\b${directive}\\b`));
      }
    });

    it('script-src has no unsafe-inline or unsafe-eval', () => {
      const csp = header('Content-Security-Policy');
      const scriptSrc = csp.match(/script-src ([^;]*)/)?.[1];
      expect(scriptSrc, 'script-src directive must exist').toBeDefined();
      expect(scriptSrc).not.toMatch(/'unsafe-inline'/);
      // Note: this must not match 'wasm-unsafe-eval', which is a distinct and far
      // narrower token (WebAssembly compilation only, no string-to-code path).
      // The leading quote in the pattern is what keeps the two apart.
      expect(scriptSrc).not.toMatch(/'unsafe-eval'/);
    });

    // Regression guard. The 3D mascot (public/alti.glb) declares
    // EXT_meshopt_compression, and the meshopt decoder is WebAssembly. Chrome
    // refuses to compile WASM unless script-src carries 'wasm-unsafe-eval', and
    // the failure is quiet: the model downloads, GLTFLoader throws during decode,
    // and the widget degrades to its static fallback icon with no console error
    // that names CSP. Dropping this token silently removes the 3D mascot, so the
    // requirement is pinned here rather than left to be rediscovered.
    it("script-src allows WebAssembly ('wasm-unsafe-eval') for the meshopt GLB decoder", () => {
      const scriptSrc = header('Content-Security-Policy').match(/script-src ([^;]*)/)?.[1];
      expect(scriptSrc, "script-src must allow WASM compilation for alti.glb's meshopt decoder").toMatch(
        /'wasm-unsafe-eval'/,
      );
    });

    // Regression guard, and the sibling of the 'wasm-unsafe-eval' case above.
    //
    // alti.glb embeds its baked textures as glTF bufferViews, so three-stdlib's
    // GLTFLoader (the fork drei's useGLTF imports) wraps each in a Blob and hands
    // URL.createObjectURL(blob) to its texture loader. WHICH loader -- and
    // therefore which CSP directive is consulted -- is decided at runtime in
    // three-stdlib/loaders/GLTFLoader.js:1387:
    //   TextureLoader      -> <img src=blob:>  -> img-src      (Safari any version,
    //                                                           Firefox <98, or no
    //                                                           createImageBitmap)
    //   ImageBitmapLoader  -> fetch(blob:)     -> connect-src  (Chrome, Edge,
    //                                                           Firefox >=98)
    // Both tokens are required; allowing only one leaves the mascot untextured for
    // roughly half the audience. This is asserted as two separate cases because the
    // first fix for this bug added img-src only and shipped without repairing
    // Chrome. Verified in production with securitypolicyviolation events reporting
    // blockedURI 'blob' against BOTH effectiveDirectives.
    it.each([
      ['img-src', /img-src ([^;]*)/, 'the <img> path used by Safari and older Firefox'],
      ['connect-src', /connect-src ([^;]*)/, 'the fetch() path used by Chrome, Edge and modern Firefox'],
    ])('%s allows blob: for GLB-embedded textures', (name, pattern, why) => {
      const directive = header('Content-Security-Policy').match(pattern)?.[1];
      expect(directive, `${name} directive must exist`).toBeDefined();
      expect(directive, `${name} must allow blob: — it governs ${why}`).toMatch(/blob:/);
    });

    it('CSP routes violation reports to the metrics Lambda', () => {
      const csp = header('Content-Security-Policy');
      expect(csp).toMatch(/report-uri\s+https:\/\/[a-z0-9]+\.lambda-url\.us-east-1\.on\.aws\/csp-report/);
    });

    it('frame-ancestors is restricted to self', () => {
      const csp = header('Content-Security-Policy');
      const frameAncestors = csp.match(/frame-ancestors ([^;]*)/)?.[1];
      expect(frameAncestors).toMatch(/'self'/);
    });

    it('object-src is none', () => {
      const csp = header('Content-Security-Policy');
      const objectSrc = csp.match(/object-src ([^;]*)/)?.[1];
      expect(objectSrc).toMatch(/'none'/);
    });

    describe('VAL-CROSS-004 — CSP allows all chat widget / analytics / video resources', () => {
      it('script-src allows the analytics, Turnstile, and PostHog origins', () => {
        const scriptSrc = header('Content-Security-Policy').match(/script-src ([^;]*)/)?.[1];
        for (const origin of [
          'https://static.cloudflareinsights.com', // Cloudflare beacon
          'https://plausible.io', // Plausible analytics
          'https://challenges.cloudflare.com', // Cloudflare Turnstile
          'https://us-assets.i.posthog.com', // PostHog asset host
        ]) {
          expect(scriptSrc, `script-src must allow ${origin}`).toContain(origin);
        }
      });

      it('connect-src allows the chat-stream Lambda, PostHog, Cognito, and Cloudflare Turnstile', () => {
        const connectSrc = header('Content-Security-Policy').match(/connect-src ([^;]*)/)?.[1];
        for (const origin of [
          'https://us.i.posthog.com', // PostHog event ingest
          'https://challenges.cloudflare.com', // Turnstile challenge
          'https://cognito-idp.us-east-1.amazonaws.com', // /admin auth
          'https://dataplane.rum.us-east-1.amazonaws.com', // CloudWatch RUM
        ]) {
          expect(connectSrc, `connect-src must allow ${origin}`).toContain(origin);
        }
        // At least one Lambda Function URL must be allowed (chat-stream is
        // us-east-1). The exact URL is environment-specific; assert the pattern.
        expect(connectSrc).toMatch(/https:\/\/[a-z0-9]+\.lambda-url\.us-east-1\.on\.aws/);
      });

      it('media-src is self-contained after removing the external hero video', () => {
        const mediaSrc = header('Content-Security-Policy').match(/media-src ([^;]*)/)?.[1];
        expect(mediaSrc).toBe("'self'");
      });

      it('img-src allows Sanity CDN, YouTube thumbnails, and data: URIs', () => {
        const imgSrc = header('Content-Security-Policy').match(/img-src ([^;]*)/)?.[1];
        for (const origin of ['https://cdn.sanity.io', 'https://i.ytimg.com', 'data:']) {
          expect(imgSrc, `img-src must allow ${origin}`).toContain(origin);
        }
      });

      it('frame-src allows YouTube, Spotify, Buzzsprout, and Cloudflare Turnstile', () => {
        const frameSrc = header('Content-Security-Policy').match(/frame-src ([^;]*)/)?.[1];
        for (const origin of [
          'https://www.youtube.com',
          'https://open.spotify.com',
          'https://www.buzzsprout.com',
          'https://challenges.cloudflare.com',
        ]) {
          expect(frameSrc, `frame-src must allow ${origin}`).toContain(origin);
        }
      });

      it('worker-src allows self and blob: (Three.js/R3F decode workers)', () => {
        const workerSrc = header('Content-Security-Policy').match(/worker-src ([^;]*)/)?.[1];
        expect(workerSrc).toMatch(/'self'/);
        expect(workerSrc).toMatch(/blob:/);
      });

      it('default-src is self (fail-closed baseline)', () => {
        const defaultSrc = header('Content-Security-Policy').match(/default-src ([^;]*)/)?.[1];
        expect(defaultSrc).toMatch(/'self'/);
      });
    });
  });

  describe('VAL-SEC-002 — HSTS includes preload and subdomains', () => {
    it('Strict-Transport-Security has max-age, includeSubDomains, and preload', () => {
      const hsts = header('Strict-Transport-Security');
      expect(hsts).toMatch(/max-age=31536000/);
      expect(hsts).toMatch(/includeSubDomains/);
      expect(hsts).toMatch(/preload/);
    });
  });

  describe('VAL-SEC-003 — Cross-origin isolation and framing headers are present', () => {
    it('Cross-Origin-Opener-Policy is same-origin', () => {
      expect(header('Cross-Origin-Opener-Policy')).toBe('same-origin');
    });

    it('Cross-Origin-Resource-Policy is same-origin', () => {
      expect(header('Cross-Origin-Resource-Policy')).toBe('same-origin');
    });

    it('X-Frame-Options is SAMEORIGIN', () => {
      expect(header('X-Frame-Options')).toBe('SAMEORIGIN');
    });

    it('X-Content-Type-Options is nosniff', () => {
      expect(header('X-Content-Type-Options')).toBe('nosniff');
    });

    it("CSP frame-ancestors is 'self'", () => {
      const csp = header('Content-Security-Policy');
      expect(csp).toMatch(/frame-ancestors 'self'/);
    });
  });

  describe('VAL-SEC-004 — Permissions-Policy is expanded', () => {
    const deniedFeatures = ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'browsing-topics'];

    it.each(deniedFeatures)('Permissions-Policy denies %s', (feature) => {
      const permissionsPolicy = header('Permissions-Policy');
      expect(permissionsPolicy, `Permissions-Policy must deny ${feature}`).toMatch(new RegExp(`${feature}=\\(\\)`));
    });
  });
});
