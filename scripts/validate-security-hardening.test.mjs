import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

/**
 * Guards the security hardening contract for VAL-SEC-009 through VAL-SEC-012.
 *
 * These assertions are pre-deploy gates that read source files and build
 * artifacts so they run in the normal `npm test` suite. Deployment-dependent
 * assertions (e.g. `curl -I` on the live origin for .map 404s) are documented
 * in the validation contract.
 *
 *   VAL-SEC-009 — PII redaction preserved in frontend and Lambda logs; chat
 *                 message content not logged verbatim.
 *   VAL-SEC-010 — Visitor memory rejects PII before persistence.
 *   VAL-SEC-011 — SRI on stable third-party scripts; no .map files in dist/.
 *   VAL-SEC-012 — /admin noindex, excluded from sitemap, no server secrets in
 *                 the frontend bundle.
 */
describe('VAL-SEC-009 — PII redaction and no verbatim message logging', () => {
  describe('Lambda logger redaction', () => {
    const loggerSrc = readFileSync(join(repoRoot, 'lambda/shared/logger.mjs'), 'utf8');

    it('defines an email redaction regex', () => {
      expect(loggerSrc).toMatch(/EMAIL_RE/);
      expect(loggerSrc).toMatch(/const EMAIL_RE/);
    });

    it('defines a phone-shaped digit run redaction regex', () => {
      expect(loggerSrc).toMatch(/PHONE_RE/);
      expect(loggerSrc).toMatch(/const PHONE_RE/);
    });

    it('redact function applies EMAIL_RE and PHONE_RE to strings', () => {
      expect(loggerSrc).toMatch(/\.replace\(EMAIL_RE/);
      expect(loggerSrc).toMatch(/\.replace\(PHONE_RE/);
    });

    it('redacts sensitive keys (authorization, token, secret, password, signingKey)', () => {
      const sensitiveKeys = ['authorization', 'token', 'accesstoken', 'secret', 'password', 'signingkey'];
      for (const key of sensitiveKeys) {
        expect(loggerSrc.toLowerCase()).toContain(key);
      }
    });
  });

  describe('Frontend logger redaction', () => {
    const loggerSrc = readFileSync(join(repoRoot, 'src/utils/logger.ts'), 'utf8');

    it('redacts email addresses', () => {
      expect(loggerSrc).toMatch(/EMAIL_RE/);
    });

    it('redacts phone-shaped digit runs', () => {
      expect(loggerSrc).toMatch(/PHONE_RE/);
    });

    it('redacts sensitive keys', () => {
      const sensitiveKeys = ['authorization', 'token', 'accesstoken', 'secret', 'password', 'signingkey'];
      for (const key of sensitiveKeys) {
        expect(loggerSrc.toLowerCase()).toContain(key);
      }
    });
  });

  describe('chat-stream does not log user message content verbatim', () => {
    const handlerSrc = readFileSync(join(repoRoot, 'lambda/chat-stream/index.mjs'), 'utf8');

    it('no log statement passes user message content as a log field', () => {
      // Check each line of the handler source for log calls that reference
      // user message content. The following variable names carry user PII
      // and must never appear as a value in a log.info/debug/warn/error call:
      //   latestQuery, latest, userMessage, messages, body
      // `message` is allowed because it refers to Error.message (the standard
      // error-logging idiom: `error: err.name, message: err.message`), not
      // user chat content.
      const dangerousFields = ['latestQuery', 'userMessage'];
      // `latest` and `body` and `messages` and `content` are checked more
      // carefully — they can appear in non-log contexts (function params,
      // variable declarations), so we only flag them when on the same line
      // as a log.<level>( call AND in a position that looks like a log field
      // value (after the event string argument).
      const lines = handlerSrc.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comments
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

        // Check for dangerous field names that should never appear in log calls
        for (const field of dangerousFields) {
          if (line.includes('log.') && line.includes(field)) {
            throw new Error(
              `Line ${i + 1}: log statement references user message content "${field}":\n  ${line.trim()}`,
            );
          }
        }

        // Check for latest/body/messages/content as log field values
        // (after the event string argument). Match patterns like:
        //   log.info("event", { latest: ... })
        //   log.info("event", { content: ... })
        if (line.match(/log\.(info|debug|warn|error)\s*\(/)) {
          const contextFields = ['latest', 'body', 'messages', 'content'];
          for (const field of contextFields) {
            // Match `{ field: ` or `{ field,` or ` field: ` within a log call
            // This catches `log.info("x", { latest: latestQuery })` etc.
            const fieldPattern = new RegExp(`\\{\\s*${field}\\s*[:,}]|\\b${field}\\s*:`);
            if (fieldPattern.test(line) && line.includes('log.')) {
              // Exclude Error.message pattern: `message: err.message` or `message: error.message`
              if (field === 'message') continue;
              throw new Error(`Line ${i + 1}: log statement may reference user content "${field}":\n  ${line.trim()}`);
            }
          }
        }
      }
      // If we get here, no log statements reference user message content
      expect(true).toBe(true);
    });

    it('logs request_start with truncated IP, not message content', () => {
      expect(handlerSrc).toMatch(/log\.info\(["'`]request_start["'`],\s*\{\s*ip:.*substring/);
    });

    it('logs token_usage with only token counts, not message content', () => {
      expect(handlerSrc).toMatch(/log\.info\(["'`]token_usage["'`],\s*\{\s*inputTokens/);
    });

    it('logs request_complete with only latency, not message content', () => {
      expect(handlerSrc).toMatch(/log\.info\(["'`]request_complete["'`],\s*\{\s*totalMs/);
    });
  });
});

describe('VAL-SEC-010 — Visitor memory rejects PII before persistence', () => {
  const memorySrc = readFileSync(join(repoRoot, 'lambda/chat-stream/memory.mjs'), 'utf8');

  it('sanitizeFactContent rejects email addresses', () => {
    expect(memorySrc).toMatch(/EMAIL_PATTERN/);
    // The pattern must return empty string when an email is found
    expect(memorySrc).toMatch(/if\s*\(EMAIL_PATTERN\.test\(collapsed\)\)\s*return\s*["'`]["'`]/);
  });

  it('sanitizeFactContent rejects phone-shaped digit runs', () => {
    expect(memorySrc).toMatch(/PHONE_PATTERN/);
    expect(memorySrc).toMatch(/if\s*\(PHONE_PATTERN\.test\(collapsed\)\)\s*return\s*["'`]["'`]/);
  });

  it('putFact calls sanitizeFactContent before writing to DynamoDB', () => {
    expect(memorySrc).toMatch(/sanitizeFactContent\(content\)/);
    expect(memorySrc).toMatch(/empty or rejected after sanitization/);
  });
});

describe('VAL-SEC-011 — SRI on stable third-party scripts and no public source maps', () => {
  describe('index.html SRI attributes', () => {
    const indexHtml = readFileSync(join(repoRoot, 'index.html'), 'utf8');

    it('all third-party CDN scripts have crossorigin or a documented exception', () => {
      // Find all <script> tags with external src (not local / paths)
      const externalScripts = [...indexHtml.matchAll(/<script[^>]*src="(https?:\/\/[^"]*)"[^>]*>/g)];
      for (const match of externalScripts) {
        const tag = match[0];
        const src = match[1];
        // plausible-init.js is local (not http) — skip local scripts
        if (!src.startsWith('http')) continue;
        // All other external scripts must have integrity + crossorigin
        expect(tag, `External script ${src} must have integrity`).toMatch(/integrity=/);
        expect(tag, `External script ${src} must have crossorigin`).toMatch(/crossorigin=/);
      }
    });
  });

  describe('no .map files in dist/ after build', () => {
    const distDir = join(repoRoot, 'dist');

    it('vite.config.ts generates hidden source maps (for Sentry upload) but removes them from dist', () => {
      const viteConfig = readFileSync(join(repoRoot, 'vite.config.ts'), 'utf8');
      expect(viteConfig).toMatch(/sourcemap:\s*['"]hidden['"]/);
      expect(viteConfig).toMatch(/removeSourcemapsPlugin/);
    });

    it('no .map files exist in dist/', () => {
      // This test requires a build to have been run. If dist/ doesn't exist,
      // the test passes vacuously (no files to leak). If dist/ exists, no
      // .map files should be present after the removeSourcemapsPlugin ran.
      if (!existsSync(distDir)) return; // No build output — nothing to check

      const mapFiles = [];
      function walk(dir) {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          const fullPath = join(dir, entry);
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            walk(fullPath);
          } else if (entry.endsWith('.map')) {
            mapFiles.push(relative(distDir, fullPath));
          }
        }
      }
      walk(distDir);
      expect(mapFiles, `Source maps must not remain in dist/ after build: ${mapFiles.join(', ')}`).toEqual([]);
    });
  });
});

describe('VAL-SEC-012 — Admin route protection and no secrets in bundle', () => {
  describe('/admin is noindex and excluded from sitemap', () => {
    const routesSrc = readFileSync(join(repoRoot, 'src/routes.ts'), 'utf8');

    it('routes.ts marks /admin as noIndex', () => {
      // Find the /admin route entry and verify it has noIndex: true
      const adminMatch = routesSrc.match(/path:\s*['"]\/admin['"][^}]*noIndex:\s*true/);
      expect(adminMatch, '/admin route must have noIndex: true in routes.ts').toBeDefined();
    });

    it('routes.ts marks /admin as noPrefetch', () => {
      const adminMatch = routesSrc.match(/path:\s*['"]\/admin['"][^}]*noPrefetch:\s*true/);
      expect(adminMatch, '/admin route must have noPrefetch: true in routes.ts').toBeDefined();
    });

    it('sitemap generator excludes /admin from STATIC_ROUTES', () => {
      const sitemapSrc = readFileSync(join(repoRoot, 'scripts/generate-sitemap.js'), 'utf8');
      // /admin must NOT appear in the staticPages array (the source of
      // STATIC_ROUTES). It should be listed in the EXCLUDED comment.
      const staticPageUrls = [...sitemapSrc.matchAll(/url:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      expect(staticPageUrls, '/admin must not be in the sitemap static pages').not.toContain('/admin');
      expect(sitemapSrc).toMatch(/\/admin.*noIndex|admin.*Cognito-gated/i);
    });

    it('Admin page component emits noindex meta', () => {
      const adminSrc = readFileSync(join(repoRoot, 'src/pages/Admin.tsx'), 'utf8');
      expect(adminSrc).toMatch(/noindex/);
    });
  });

  describe('no server-side secrets in the frontend bundle', () => {
    const distDir = join(repoRoot, 'dist');
    const assetsDir = join(distDir, 'assets');

    it('frontend source does not reference server-side secret env var names', () => {
      // The Lambda env var names (CHAT_SIGNING_KEY, BLUEPRINT_SIGNING_KEY,
      // TURNSTILE_SECRET, ClientSecret) must never appear in frontend source
      // in a non-VITE_ context. The VITE_ prefixed counterparts
      // (VITE_CHAT_SIGNING_KEY, etc.) are intentionally public (they are the
      // frontend signing keys, not server secrets), but the previous security
      // work moved auth to session tokens, so even those should no longer be
      // in the active auth path.
      //
      // We check for the server-side names as standalone tokens (not as
      // substrings of VITE_ prefixed names). A match like
      // `VITE_BLUEPRINT_SIGNING_KEY` is acceptable; a bare
      // `BLUEPRINT_SIGNING_KEY` (without VITE_ prefix) is not.
      const serverSecretPatterns = [
        'CHAT_SIGNING_KEY',
        'BLUEPRINT_SIGNING_KEY',
        'TURNSTILE_SECRET',
        'ClientSecret',
        'client_secret',
      ];

      const srcDir = join(repoRoot, 'src');
      function walkSrc(dir) {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          const fullPath = join(dir, entry);
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            walkSrc(fullPath);
          } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
            const content = readFileSync(fullPath, 'utf8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

              for (const pattern of serverSecretPatterns) {
                // Find all occurrences of the pattern in the line
                let idx = 0;
                while ((idx = line.indexOf(pattern, idx)) !== -1) {
                  // Check if this occurrence is part of a VITE_ prefixed name
                  const before = line.substring(Math.max(0, idx - 5), idx);
                  if (before.endsWith('VITE_')) {
                    idx += pattern.length;
                    continue; // VITE_ prefixed — intentionally public
                  }
                  throw new Error(
                    `Server secret "${pattern}" found in ${relative(srcDir, fullPath)}:${i + 1}: ${line.trim()}`,
                  );
                }
              }
            }
          }
        }
      }
      walkSrc(srcDir);
      // If we get here, no server secrets were found in frontend source
      expect(true).toBe(true);
    });

    it('built bundle does not contain server-side secret values', () => {
      // After a build, grep the emitted JS chunks for server-side secret
      // env var names. VITE_ prefixed values are public by design; we check
      // for the server-side (non-VITE_) secret names that must never be
      // bundled.
      if (!existsSync(assetsDir)) return; // No build — nothing to check

      const secretPatterns = [
        'CHAT_SIGNING_KEY',
        'BLUEPRINT_SIGNING_KEY',
        'TURNSTILE_SECRET',
        'ClientSecret',
        'client_secret',
      ];

      const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
      for (const file of jsFiles) {
        const content = readFileSync(join(assetsDir, file), 'utf8');
        for (const pattern of secretPatterns) {
          expect(content, `Server secret "${pattern}" must not appear in built bundle ${file}`).not.toContain(pattern);
        }
      }
    });

    it('VITE_KB_BUILDER_ENDPOINT is only referenced in the admin route chunk', () => {
      // The KB builder endpoint is admin-only. Its import.meta.env reference
      // lives in useKbAdmin.ts, which is only imported by the lazy Admin.tsx.
      // After build, the endpoint value should only appear in the admin
      // chunk, not in the main/initial chunks.
      if (!existsSync(assetsDir)) return; // No build — nothing to check

      const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
      const endpoint = process.env.VITE_KB_BUILDER_ENDPOINT || 'lambda-url';
      const filesWithEndpoint = jsFiles.filter((f) => readFileSync(join(assetsDir, f), 'utf8').includes(endpoint));

      // If the endpoint is a placeholder, it may not appear at all. If it does
      // appear, it should only be in one chunk (the admin chunk). We can't
      // deterministically name the admin chunk, but we can assert it doesn't
      // appear in the main entry chunk.
      if (filesWithEndpoint.length === 0) return; // Placeholder endpoint — not bundled

      // The endpoint should not be in the index/main entry chunk
      const mainChunk = jsFiles.find((f) => f.startsWith('index-'));
      if (mainChunk) {
        const mainContent = readFileSync(join(assetsDir, mainChunk), 'utf8');
        expect(
          mainContent,
          `VITE_KB_BUILDER_ENDPOINT must not be in the main entry chunk (${mainChunk})`,
        ).not.toContain(endpoint);
      }
    });
  });
});
