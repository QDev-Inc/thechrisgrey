/**
 * Build-time prerender (Recommendation 3 Part B).
 *
 * Runs AFTER `vite build`, BEFORE generate-sitemap. Serves dist/ over a tiny
 * local http server, opens each static route + blog slug headless with
 * ?prerender=1, waits for the Helmet-ready signal (window.__PRERENDER_READY__,
 * set in src/main.tsx — NOT network idle, because WebGL/GSAP never go idle),
 * serializes the DOM, and writes dist/<route>/index.html. Crawlers / social
 * scrapers / LLMs then get per-route <title>, OG tags, and JSON-LD without
 * executing JS.
 *
 * #1 SAFETY CONSTRAINT: this step is strictly NON-FATAL. ANY failure
 * (puppeteer not installed, Chromium launch failure, Sanity unreachable, a
 * route timeout, one bad route) logs a warning and the process STILL exits 0,
 * so a broken prerender degrades to plain CSR instead of breaking the
 * "&&"-chained build / the Amplify deploy. puppeteer is imported dynamically
 * INSIDE the try so a missing dependency degrades gracefully rather than
 * crashing at module load.
 *
 * Route set is the SAME source as scripts/generate-sitemap.js (DRY): it imports
 * STATIC_ROUTES and BLOG_SLUGS_QUERY from there so the crawl never drifts from
 * the sitemap.
 */
import { createServer } from 'http';
import { createReadStream, readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'fs';
import { resolve, dirname, join, extname, sep } from 'path';
import { fileURLToPath } from 'url';
import { STATIC_ROUTES, BLOG_SLUGS_QUERY } from './generate-sitemap.js';
import { createBuildClient } from './lib/sanity-build-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '../dist');

// Sanity: the shared build-time config, so this crawl can never read a
// different project/dataset than the sitemap it derives its route set from.
const client = createBuildClient();

async function fetchBlogRoutes() {
  // BLOG_SLUGS_QUERY is shared with generate-sitemap.js; we only read .slug.
  const posts = await client.fetch(BLOG_SLUGS_QUERY);
  return posts.map((p) => `/blog/${p.slug}`);
}

// --- Tiny static file server over dist/ --------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

// `shellHtml` is the PRISTINE raw SPA shell captured by the caller BEFORE the
// crawl writes any route (see crawl()). It is served for every SPA-shell
// response so the served shell never carries another route's metadata.
function startServer(shellHtml) {
  return new Promise((resolveServer, rejectServer) => {
    const server = createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const filePath = resolve(DIST, `.${urlPath}`);
      // Serve a real on-disk asset ONLY when the request maps to an existing
      // FILE with an extension inside dist/ (js/css/img/glb/etc.). Everything
      // else — extensionless routes, directories, missing paths, and any
      // `..%2f` traversal attempt that escapes dist/ — falls through to the
      // pristine SPA shell below. Input is local-only/trusted (only this
      // build's puppeteer hits 127.0.0.1); the dist/ clamp is defensive.
      const isSafe = filePath === DIST || filePath.startsWith(DIST + sep);
      if (isSafe && extname(filePath) && existsSync(filePath) && statSync(filePath).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
        createReadStream(filePath).pipe(res);
        return;
      }
      // SPA shell: ALWAYS the in-memory pristine shell — NEVER re-read
      // dist/index.html from disk. The '/' route's prerender output IS
      // dist/index.html, so once it's crawled, reading the shell from disk
      // would serve Home's <title>/<link rel=canonical>/og tags to every
      // route crawled afterwards, producing duplicate, conflicting canonical
      // and Open Graph tags on every other page.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(shellHtml);
    });
    server.on('error', rejectServer);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolveServer({ server, port });
    });
  });
}

// Map a route to the dist file(s) that hold its prerendered HTML. We write TWO
// artifacts per route (except '/'), the SAME serialized DOM to both:
//
//   /blog       -> dist/blog.html        (FILE form)
//   /blog       -> dist/blog/index.html  (DIRECTORY form)
//   /blog/slug  -> dist/blog/slug.html   +  dist/blog/slug/index.html
//
// WHY BOTH — Amplify Hosting's documented static-file resolution
// (https://docs.aws.amazon.com/amplify/latest/userguide/redirect-rewrite-examples.html
//  → "Trailing slashes and clean URLs"):
//   * Request `/blog` when `blog.html` EXISTS       -> serves blog.html, the URL
//     stays `/blog`, status 200, NO redirect.
//   * Request `/blog` when ONLY `blog/index.html`   -> Amplify appends a trailing
//     slash and 301-redirects `/blog` -> `/blog/`.
//
// The directory-only form (what this script wrote before) meant the bare `/blog`
// — the EXACT URL in the sitemap, in `<link rel=canonical>`, and in every in-app
// link — 301-redirected to `/blog/`. Google Search Console flagged those bare
// URLs (sitemap + self-canonical pointing at a URL that redirects is a
// conflicting signal) and indexing decayed: the prerendered routes surfaced as
// "Not found (404)" / "Page with redirect" instead of indexing cleanly. Writing
// the FILE form makes the canonical `/blog` return 200 directly and
// self-referentially (no redirect). We ALSO keep the DIRECTORY form so any
// `/blog/` URL Google already indexed under the old behavior keeps returning 200
// (its canonical -> `/blog` consolidates it) rather than turning into a fresh
// 404. '/' is special — it is only ever dist/index.html.
function outPathsFor(route) {
  if (route === '/') return [join(DIST, 'index.html')];
  const rel = route.replace(/^\//, '');
  return [join(DIST, `${rel}.html`), join(DIST, rel, 'index.html')];
}

// SEO.tsx emits `<meta name="robots" content="noindex, nofollow">` (name before
// content) and BlogPost only asks for it on its "Article Not Found" / error
// path. Matching the whole tag rather than the bare word keeps a post that
// *discusses* noindex in its prose from tripping the guard in crawl().
const NOINDEX_ROBOTS_META = /<meta[^>]*\bname="robots"[^>]*\bcontent="noindex/i;

// --- Sanity CORS proxy via request interception ------------------------------
//
// WHY: BlogPost (and podcast pages) do a CLIENT-SIDE Sanity fetch from the
// headless browser. That browser's origin is http://127.0.0.1:<random-port>,
// which is NOT on Sanity's CORS allowlist (only thechrisgrey.com is), so the
// browser XHR is blocked by CORS ("No 'Access-Control-Allow-Origin' header is
// present on the requested resource" -> net::ERR_FAILED). The fetch rejects,
// BlogPost renders its error boundary, and the prerendered <title> becomes
// "Error Loading Article" instead of the real article title.
//
// FIX: We can't add the random ephemeral port to Sanity's allowlist, and we
// must not touch Sanity project settings. Instead we intercept every request
// the page makes; for requests to a Sanity host we re-issue the SAME request
// from Node (which has NO CORS — it's not a browser) and fulfill the browser
// request with that response plus a permissive Access-Control-Allow-Origin so
// the browser's CORS check passes. Matches BOTH Sanity projects (blog k5950b3w
// + podcast uaxzdsfa) by domain, never a hardcoded project id. All other
// requests pass through untouched. Every failure path is swallowed so a broken
// proxy attempt degrades to a normal (CORS-failing) request rather than
// crashing the crawl — the script stays strictly non-fatal (always exits 0).
function isSanityUrl(url) {
  try {
    const { hostname } = new URL(url);
    // Covers apicdn.sanity.io, api.sanity.io, <project>.apicdn.sanity.io,
    // cdn.sanity.io, etc. — any host under the sanity.io apex.
    return hostname === 'sanity.io' || hostname.endsWith('.sanity.io');
  } catch {
    return false;
  }
}

// Hop-by-hop / forbidden response headers Chrome's Fetch.fulfillRequest will
// reject or that don't make sense to replay (encoding handled by node fetch).
const STRIPPED_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
]);

async function proxySanityRequest(interceptedRequest) {
  const url = interceptedRequest.url();
  // Replay the request server-side with Node fetch (no CORS in Node).
  const method = interceptedRequest.method();
  const reqHeaders = { ...interceptedRequest.headers() };
  // Drop browser-set headers that don't belong on a server-side fetch and would
  // either be rejected or trigger an unwanted CORS preflight semantics on Node.
  delete reqHeaders.host;
  delete reqHeaders.origin;
  delete reqHeaders.referer;
  delete reqHeaders['content-length'];

  const init = { method, headers: reqHeaders };
  if (method !== 'GET' && method !== 'HEAD') {
    const postData = interceptedRequest.postData();
    if (postData != null) init.body = postData;
  }

  const upstream = await fetch(url, init);
  const bodyBuf = Buffer.from(await upstream.arrayBuffer());

  const headers = {};
  upstream.headers.forEach((value, key) => {
    if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) headers[key] = value;
  });
  // Permissive CORS so the browser's same-origin/CORS check passes for the
  // 127.0.0.1:<port> origin. Local-only build context; not shipped to prod.
  headers['access-control-allow-origin'] = '*';
  headers['access-control-allow-methods'] = 'GET,POST,OPTIONS';
  headers['access-control-allow-headers'] = '*';

  await interceptedRequest.respond({
    status: upstream.status,
    headers,
    contentType: upstream.headers.get('content-type') || undefined,
    body: bodyBuf,
  });
}

// Wire request interception on a page so Sanity requests are proxied through
// Node and everything else continues normally. Errors are isolated per-request.
async function attachSanityProxy(page) {
  await page.setRequestInterception(true);
  page.on('request', (interceptedRequest) => {
    // Guard against the (rare) case a handler already resolved this request.
    if (interceptedRequest.isInterceptResolutionHandled?.()) return;

    if (!isSanityUrl(interceptedRequest.url())) {
      interceptedRequest.continue().catch(() => {});
      return;
    }

    // CORS preflight: answer OPTIONS locally so the browser proceeds to the
    // real request (which we then proxy below).
    if (interceptedRequest.method() === 'OPTIONS') {
      interceptedRequest
        .respond({
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'GET,POST,OPTIONS',
            'access-control-allow-headers': '*',
            'access-control-max-age': '600',
          },
        })
        .catch(() => {});
      return;
    }

    proxySanityRequest(interceptedRequest).catch((proxyErr) => {
      // Proxy failed — fall back to a normal request so the crawl never crashes.
      // (Normal request will likely CORS-fail, but that is non-fatal: the route
      // degrades to the error state rather than aborting the whole build.)
      console.warn(
        `  [prerender] WARN Sanity proxy failed for ${interceptedRequest.url().slice(0, 80)}...: ${proxyErr && proxyErr.message}`,
      );
      interceptedRequest.continue().catch(() => {});
    });
  });
}

async function crawl() {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.warn('[prerender] dist/index.html not found — skipping prerender (run vite build first).');
    return;
  }

  // Dynamic import INSIDE the guarded path so a missing puppeteer dependency
  // degrades gracefully (warn + CSR) instead of crashing at module load.
  const { default: puppeteer } = await import('puppeteer');

  console.log('[prerender] Prerendering routes...');
  const blogRoutes = await fetchBlogRoutes();
  // /chat is prerendered ONLY so its served HTML carries the noindex robots
  // meta (VAL-SEO-010, VAL-AEO-008) without inheriting Home's index, follow
  // meta from the SPA shell. It is intentionally NOT in STATIC_ROUTES (so the
  // sitemap and validate-prerender-seo gate do not include it) — it is an app
  // shell, not indexable content.
  const PRERENDER_ONLY_ROUTES = ['/chat', '/newsletter/confirm'];
  const routes = [...STATIC_ROUTES, ...PRERENDER_ONLY_ROUTES, ...blogRoutes];
  console.log(
    `[prerender] Routes to prerender: ${routes.length} (${STATIC_ROUTES.length} static + ${PRERENDER_ONLY_ROUTES.length} app-shell + ${blogRoutes.length} blog)`,
  );

  // Snapshot the pristine SPA shell NOW, before the loop writes any route. The
  // '/' route's prerender output overwrites dist/index.html with Home's
  // metadata, so the shell MUST be captured up front and served from memory —
  // otherwise every route crawled after '/' inherits Home's <title>/canonical/og.
  const shellHtml = readFileSync(join(DIST, 'index.html'), 'utf-8');

  const { server, port } = await startServer(shellHtml);
  const base = `http://127.0.0.1:${port}`;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  // Routes whose prerender failure silently degrades SEO/social cards to a CSR
  // shell (no per-page <title>/canonical/og). Tracked separately so an opt-in
  // CHECK_PRERENDER_CRITICAL_ROUTES / STRICT_PRERENDER run can make that otherwise
  // invisible degradation loud. Default: Home only.
  const CRITICAL_ROUTES = ['/'];

  let ok = 0;
  let failed = 0;
  const skippedCritical = [];
  try {
    for (const route of routes) {
      // One bad route must never abort the whole crawl — isolate each.
      try {
        const page = await browser.newPage();
        page.setDefaultTimeout(30000);
        // Proxy client-side Sanity fetches through Node to bypass the browser
        // CORS block on the 127.0.0.1:<port> origin (see attachSanityProxy).
        await attachSanityProxy(page);
        try {
          const url = `${base}${route}${route.includes('?') ? '&' : '?'}prerender=1`;
          // domcontentloaded only — we do NOT wait for network idle (3D never idles).
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          // Wait for React commit + react-helmet-async flush (deterministic signal).
          await page.waitForFunction('window.__PRERENDER_READY__ === true', { timeout: 15000 });
          const html = await page.content();
          // A blog slug is never legitimately noindex, so this snapshot is the
          // degraded "Article Not Found" shell rather than the post — the Sanity
          // fetch failed inside the headless browser. Throw into the catch below
          // so the route is counted failed and NO file is written: a CSR
          // fallback still renders the real article, whereas a prerendered
          // noindex page is what a crawler would cache.
          if (route.startsWith('/blog/') && NOINDEX_ROBOTS_META.test(html)) {
            throw new Error('prerendered snapshot carries a robots noindex meta (degraded BlogPost render)');
          }
          // Write the file form AND the directory form (see outPathsFor) so the
          // canonical bare URL returns 200 directly while the trailing-slash URL
          // keeps resolving — no 301 on the URL that crawlers actually index.
          const outFiles = outPathsFor(route);
          for (const outFile of outFiles) {
            mkdirSync(dirname(outFile), { recursive: true });
            writeFileSync(outFile, html, 'utf-8');
          }
          ok += 1;
          console.log(`  [prerender] ok ${route} -> ${outFiles.map((f) => f.replace(DIST, 'dist')).join(' , ')}`);
        } finally {
          await page.close();
        }
      } catch (routeErr) {
        failed += 1;
        if (CRITICAL_ROUTES.includes(route)) skippedCritical.push(route);
        console.warn(`  [prerender] WARN skipped ${route}: ${routeErr && routeErr.message}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`[prerender] Done: ${ok} prerendered, ${failed} skipped (of ${routes.length}).`);

  // Opt-in visibility: surface degraded CRITICAL routes prominently. Off by
  // default so normal-build output is unchanged; never fatal here (main() owns
  // the STRICT exit decision so the non-fatal default is preserved).
  const checkCritical =
    process.env.CHECK_PRERENDER_CRITICAL_ROUTES === 'true' || process.env.STRICT_PRERENDER === 'true';
  if (checkCritical && skippedCritical.length) {
    console.error(
      `[prerender] CRITICAL: ${skippedCritical.length} of ${CRITICAL_ROUTES.length} critical ` +
        `route(s) degraded to CSR: ${skippedCritical.join(', ')} — each ships without per-page ` +
        'title/canonical/og. Likely missing <SEO> or never reached __PRERENDER_READY__.' +
        (process.env.STRICT_PRERENDER === 'true'
          ? ' (STRICT_PRERENDER set — the build will fail.)'
          : ' (set STRICT_PRERENDER=true to fail the build on this.)'),
    );
  }

  return { ok, failed, skippedCritical };
}

// Entire crawl wrapped so ANY failure is non-fatal: warn and exit 0 so the
// "&&"-chained build still proceeds and the site deploys as CSR.
async function main() {
  let result;
  try {
    result = await crawl();
  } catch (err) {
    console.warn(
      '[prerender] WARN prerender step failed — continuing build as CSR (this is non-fatal):',
      err && err.message ? err.message : err,
    );
  }
  // STRICT opt-in: fail the build ONLY when explicitly requested AND a critical
  // route degraded. The default path remains strictly non-fatal (exit 0) so a
  // broken prerender never blocks the Amplify deploy — the #1 SAFETY CONSTRAINT.
  if (process.env.STRICT_PRERENDER === 'true' && result?.skippedCritical?.length) {
    console.error('[prerender] STRICT_PRERENDER: exiting 1 due to degraded critical route(s).');
    process.exit(1);
  }
  // Always succeed.
  process.exit(0);
}

main();
