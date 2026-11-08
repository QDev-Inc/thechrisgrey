/**
 * Canonical route metadata for thechrisgrey.com.
 *
 * Single source of truth for everything routing-adjacent that lived in three
 * places before this file existed:
 *
 *   - `src/App.tsx`             — the JSX `<Route>` definitions (still authored
 *                                  by hand for readability; a test in
 *                                  `routes.test.ts` asserts every path there is
 *                                  in this table)
 *   - `src/utils/routeManifest.ts` — derives the prefetch-on-hover importers from
 *                                     `ROUTES`
 *   - `src/utils/pageContext.ts`   — derives `ROUTE_CONTEXT_MAP` (Alti's
 *                                     grounding context per page) and
 *                                     `PAGE_SUGGESTIONS` (Alti's starter chips
 *                                     per page) from `ROUTES`
 *
 * Adding a route: append one entry here, then add the matching `<Route>` to
 * App.tsx. The other two surfaces pick it up automatically. The `routes.test.ts`
 * pair-check will fail the build if you forget App.tsx.
 *
 * The Home route ('/') is intentionally NOT in this table — it's the only
 * static (non-lazy) route, has no prefetch (it's the entrypoint), and its
 * context is overridden by the visitor-context block on every chat anyway.
 * It's noted in `HOME_CONTEXT` below.
 */

export interface RouteDefinition {
  /** URL path, exactly as it appears in `<Route path>`. */
  path: string;
  /**
   * Lazy importer for the route's page component. Used for both `React.lazy()`
   * in App.tsx (manually wired) and for hover/focus prefetch.
   */
  importer: () => Promise<unknown>;
  /**
   * Grounding context Alti receives in the system prompt when the visitor is
   * on this page. The `section` shapes what details Alti prioritizes; the
   * `pageTitle` shows in logs.
   */
  context: { pageTitle: string; section: string };
  /**
   * Starter chips shown when the visitor opens Alti's widget/full page on
   * this route. If omitted, the default DEFAULT_SUGGESTIONS list is used.
   */
  suggestions?: string[];
  /**
   * Skip hover/focus prefetch for this route. Used for surfaces the visitor
   * should explicitly load (`/admin` is Cognito-gated; the chunk should not
   * load until a logged-in user clicks the link) or where prefetch would be
   * wasteful (`/chat` is the destination of Alti widget interactions, the
   * widget itself ships on every non-/chat page so the chunk is already
   * resident by the time someone navigates).
   */
  noPrefetch?: boolean;
  /**
   * Exclude this route from the sitemap AND the build-time prerender crawl.
   * Used for routes that must NOT be indexed by search engines: `/admin`
   * (Cognito-gated) and `/blueprint` (feature-flagged, waitlist-only, still in
   * development). Dynamic routes (`/blog/:slug`) are excluded by their `:param`
   * regardless of this flag — they're enumerated from Sanity separately.
   *
   * The single source of truth for the indexable set is `scripts/generate-sitemap.js`
   * (`staticPages` -> `STATIC_ROUTES`, which `scripts/prerender.js` imports). A
   * drift test in `routes.test.ts` asserts that set stays exactly in sync with the
   * non-`noIndex`, non-dynamic routes here, so a route can never again silently
   * fall out of the sitemap/prerender (which is how `/aws` and `/claude` went
   * unindexed).
   */
  noIndex?: boolean;
  /**
   * Third-party origins to `<link rel="preconnect">` on this route's prerendered
   * HTML (VAL-PERF-008). Only origins actually requested within the first ~10
   * seconds of a visit on this route belong here; preconnecting to an origin a
   * route never uses wastes a connection and is flagged as an unused preconnect.
   *
   * The global, every-page preconnects (analytics beacons used on all routes)
   * live in `index.html`; this field carries only route-specific origins so the
   * prerendered HTML for a route preconnects to exactly the origins it needs.
   * `preconnectsForPath()` (below) resolves a pathname — including the dynamic
   * `/blog/:slug` form — to this list, and `SEO.tsx` injects the resulting
   * `<link>` tags via react-helmet-async so they land in the prerendered head.
   */
  preconnects?: readonly string[];
}

/**
 * Home-route metadata. Kept separate because Home is statically imported
 * in App.tsx (no lazy / no prefetch) and is consulted by pageContext.ts.
 */
export const HOME_CONTEXT = {
  path: '/' as const,
  context: { pageTitle: 'Home', section: 'Home' },
  suggestions: [
    "What's Christian's story?",
    'What is Altivum?',
    'Tell me about the podcast',
    "What's Beyond the Assessment about?",
  ],
  // The home signal field is self-contained. Keep route-specific preconnects
  // empty until an actual first-viewport network dependency is introduced.
  preconnects: [] as readonly string[],
};

export const ROUTES: readonly RouteDefinition[] = [
  {
    path: '/about',
    importer: () => import('./pages/About'),
    context: { pageTitle: 'Personal Biography', section: 'Personal Biography' },
    suggestions: [
      'What was his military career like?',
      'Where did he go to school?',
      "What's his leadership philosophy?",
      'How did he transition to tech?',
    ],
  },
  {
    path: '/altivum',
    importer: () => import('./pages/Altivum'),
    context: { pageTitle: 'Altivum Inc', section: 'Altivum Inc' },
    suggestions: ['What does Altivum do?', 'What is Altivum Logic?', "What's Vanguard?", 'How is Altivum different?'],
  },
  {
    path: '/foundation',
    importer: () => import('./pages/Foundation'),
    context: { pageTitle: 'The Altivum Foundation', section: 'The Altivum Foundation' },
    suggestions: [
      'What is the Altivum Foundation?',
      'Who does the Foundation serve?',
      'How can I support the Foundation?',
      'What programs does the Foundation run?',
    ],
  },
  {
    path: '/podcast',
    importer: () => import('./pages/Podcast'),
    context: { pageTitle: 'The Vector Podcast', section: 'The Vector Podcast' },
    suggestions: [
      "What's the podcast about?",
      'Who are some notable guests?',
      'What topics does it cover?',
      'How can I listen?',
    ],
    // The guest query goes to the podcast project's own API CDN host
    // (`podcastClient` is project uaxzdsfa, so uaxzdsfa.apicdn.sanity.io — a
    // different origin from the blog's k5950b3w), and the guest images it
    // returns come from the shared cdn.sanity.io asset host. Episode thumbnails
    // come from i.ytimg.com but those preconnects are injected by the
    // YouTubeFacade component itself (only when an episode card actually
    // renders a facade), so they are not listed here.
    preconnects: ['https://uaxzdsfa.apicdn.sanity.io', 'https://cdn.sanity.io'],
  },
  {
    path: '/beyond-the-assessment',
    importer: () => import('./pages/BeyondTheAssessment'),
    context: { pageTitle: 'Beyond the Assessment', section: 'Beyond the Assessment' },
    suggestions: [
      "What's the book about?",
      'Who should read it?',
      'What inspired him to write it?',
      'Where can I buy it?',
    ],
  },
  {
    path: '/aws',
    importer: () => import('./pages/AWS'),
    context: { pageTitle: 'Amazon Web Services', section: 'Amazon Web Services' },
    suggestions: [
      'What does he do as an AWS Community Builder?',
      'What AWS services does he work with?',
      'How does he use AI on AWS?',
      'What is the Community Builder program?',
    ],
  },
  {
    path: '/claude',
    importer: () => import('./pages/Claude'),
    context: { pageTitle: 'Claude', section: 'Claude' },
    suggestions: [
      'How does he use Claude in production?',
      'What Anthropic Academy certifications does he have?',
      'How does he combine Claude with AWS?',
      'What AI systems has he built with Claude?',
    ],
  },
  {
    path: '/blog',
    importer: () => import('./pages/Blog'),
    context: { pageTitle: 'Blog', section: 'Blog' },
    suggestions: [
      'What does he write about?',
      'Any posts on AI strategy?',
      'What are the most popular posts?',
      'Does he have a blog series?',
    ],
    // Two Sanity origins, both hit in the first moments of a /blog visit
    // (VAL-PERF-008). The listing query goes out on mount to the project's API
    // CDN — `@sanity/client`'s `useCdn: true` resolves to
    // `<projectId>.apicdn.sanity.io` — and the post cards it renders then pull
    // their images from cdn.sanity.io. The API host is the one on the critical
    // path: nothing paints until that query returns.
    preconnects: ['https://k5950b3w.apicdn.sanity.io', 'https://cdn.sanity.io'],
  },
  {
    path: '/blog/:slug',
    importer: () => import('./pages/BlogPost'),
    // Per-post context is augmented by getPageContext() so the section
    // includes the slug. This entry holds the BlogPost-page defaults.
    context: { pageTitle: 'Blog Post', section: 'Blog' },
    suggestions: [
      'Can you summarize this post?',
      'What else has he written on this topic?',
      "What's his take on this?",
      'Any related podcast episodes?',
    ],
    // The blog-card-hover prefetcher targets BlogPost directly; including it
    // in the regular prefetch map would shadow that. See
    // `prefetchBlogPostChunk` in routeManifest.ts.
    noPrefetch: true,
    // Same two Sanity origins as /blog: the post query blocks the render on
    // k5950b3w.apicdn.sanity.io, then the hero image and inline PortableText
    // image blocks come from cdn.sanity.io. YouTube embeds (i.ytimg.com) are
    // injected by the YouTubeFacade component only on posts that actually
    // embed a video, so i.ytimg.com is intentionally NOT listed here.
    preconnects: ['https://k5950b3w.apicdn.sanity.io', 'https://cdn.sanity.io'],
  },
  {
    path: '/links',
    importer: () => import('./pages/Links'),
    context: { pageTitle: 'Links', section: 'Links' },
    suggestions: [
      'Where can I follow him?',
      'What platforms is he on?',
      "What's Altivum's website?",
      "Where's the podcast?",
    ],
  },
  {
    path: '/contact',
    importer: () => import('./pages/Contact'),
    context: { pageTitle: 'Contact & Speaking', section: 'Contact & Speaking' },
    suggestions: [
      'What topics does he speak on?',
      'How do I book him for an event?',
      "What's in the press kit?",
      'How can I reach him?',
    ],
  },
  {
    path: '/chat',
    importer: () => import('./pages/Chat'),
    context: { pageTitle: 'AI Chat', section: 'AI Chat' },
    // /chat is the destination of widget interactions and the canonical surface
    // for tool-powered prompts, so its starter chips showcase Alti's agentic
    // capabilities (cross-source synthesis, podcast citation, blog search) rather
    // than the generic defaults. The /chat page reads these via
    // getSuggestionsForPage('/chat') (VAL-ENG-011).
    suggestions: [
      "Compare Christian's military and tech careers",
      'What did guests say about AI in defense?',
      'Search the blog for posts on AI strategy',
      'Draft a speaking inquiry for an upcoming event',
    ],
    noPrefetch: true,
    noIndex: true, // App-shell page — never index (VAL-AEO-008, VAL-SEO-010).
  },
  {
    path: '/privacy',
    importer: () => import('./pages/Privacy'),
    context: { pageTitle: 'Privacy Policy', section: 'Privacy Policy' },
  },
  {
    path: '/newsletter/confirm',
    importer: () => import('./pages/NewsletterConfirm'),
    context: { pageTitle: 'Confirm subscription', section: 'Subscription' },
    noPrefetch: true,
    noIndex: true,
  },
  {
    path: '/admin',
    importer: () => import('./pages/Admin'),
    context: { pageTitle: 'Admin', section: 'Admin' },
    noPrefetch: true,
    noIndex: true, // Cognito-gated — never index.
  },
  {
    path: '/blueprint',
    importer: () => import('./pages/Blueprint'),
    context: { pageTitle: 'Blueprint', section: 'Blueprint' },
    suggestions: [
      'What is Blueprint?',
      'How does the architecture generator work?',
      'What can it design?',
      'How do I join the waitlist?',
    ],
    noIndex: true, // Feature-flagged, waitlist-only, still in development — don't index yet.
  },
] as const;

/**
 * Cheap lookup by path. Built once at module load. `O(1)` access at runtime;
 * the array is the canonical form so the in-file ordering can be controlled.
 */
export const ROUTES_BY_PATH: ReadonlyMap<string, RouteDefinition> = new Map(ROUTES.map((r) => [r.path, r]));

/**
 * Resolve the route-specific preconnect origins for a pathname
 * (VAL-PERF-008). Returns the `preconnects` declared on the matching route —
 * Home uses `HOME_CONTEXT`, dynamic `/blog/:slug` posts resolve to that
 * route's entry, and routes without `preconnects` return an empty array. The
 * global, every-page preconnects (analytics beacons) live in `index.html` and
 * are NOT returned here; `SEO.tsx` injects only these route-specific origins
 * so a page's prerendered `<head>` preconnects to exactly the third-party
 * origins it actually uses within the first 10 seconds.
 *
 * Trailing slashes are normalized (Amplify serves `/podcast/`); the bare
 * `/blog` path is kept distinct from `/blog/:slug` posts.
 */
export function preconnectsForPath(pathname: string): readonly string[] {
  // Normalize trailing slashes (keep '/' as-is).
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (normalized === HOME_CONTEXT.path) return HOME_CONTEXT.preconnects ?? [];
  // Dynamic blog posts share the /blog/:slug route's preconnects.
  const isBlogPost = normalized.startsWith('/blog/') && normalized !== '/blog';
  const lookupKey = isBlogPost ? '/blog/:slug' : normalized;
  return ROUTES_BY_PATH.get(lookupKey)?.preconnects ?? [];
}

/** A single header-nav / About-dropdown entry. */
export interface NavigationItem {
  /** Must be a real `ROUTES` path (or Home `'/'`). Enforced by `routes.test.ts`. */
  path: string;
  /**
   * UI label shown in the nav. Intentionally decoupled from
   * `RouteDefinition.context.pageTitle` (Alti's grounding/log text) — e.g.
   * `/chat` shows "Alti" here but "AI Chat" to the model, and `/contact` shows
   * "Contact" here but "Contact & Speaking" to the model. The drift test asserts
   * the PATHS stay in sync with `ROUTES`, not the labels.
   */
  label: string;
}

/**
 * Canonical navigation surface — the single source of truth for the header nav
 * and the About dropdown. `Navigation.tsx` renders straight from this instead of
 * hardcoding its own arrays, and `routes.test.ts` drift-checks that every path
 * here is a real route and that no `ROUTES` entry silently falls out of the menu.
 */
export const NAVIGATION_CONFIG: {
  readonly mainNav: readonly NavigationItem[];
  readonly aboutDropdown: readonly NavigationItem[];
} = {
  mainNav: [
    { path: HOME_CONTEXT.path, label: 'Home' },
    { path: '/blog', label: 'Blog' },
    { path: '/chat', label: 'Alti' },
    { path: '/links', label: 'Links' },
    { path: '/contact', label: 'Contact' },
  ],
  aboutDropdown: [
    { path: '/about', label: 'Personal Biography' },
    { path: '/altivum', label: 'Altivum Inc' },
    { path: '/foundation', label: 'The Altivum Foundation' },
    { path: '/podcast', label: 'The Vector Podcast' },
    { path: '/beyond-the-assessment', label: 'Beyond the Assessment' },
    { path: '/aws', label: 'Amazon Web Services' },
    { path: '/claude', label: 'Claude' },
    { path: '/blueprint', label: 'thechrisgrey Blueprint' },
  ],
} as const;
