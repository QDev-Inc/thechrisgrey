# Product

<!-- impeccable:product-schema 1 -->

> **Provenance note.** This record was written from repository evidence after the
> init interview round was declined. Facts drawn from source files are stated
> plainly and cite their file. Anything not established by the repository is
> marked `[INFERRED — confirm]` and must be confirmed or corrected before future
> work relies on it.

## Platform

web

## Users

thechrisgrey.com is a personal hub serving several distinct audiences. The
repository proves all four exist as designed-for audiences (each has its own
route, its own Alti grounding context, and its own starter questions in
`src/routes.ts`); it does not establish which one ranks first.

- **Clients and partners** evaluating Altivum Inc. for AI, cloud, and web work —
  routed through `/altivum` and `/contact` (inquiry type `consulting`). Altivum
  Logic serves small businesses; Vanguard serves veteran career services.
- **Event organizers and media** deciding whether to book or feature Christian —
  `/contact` carries four named speaking topics (Cloud & AI Strategy, Veteran
  Transition, Entrepreneurship, Leadership), a downloadable press kit
  (`public/press-kit.zip`), and a stated 24–48 hour response window.
- **Veterans and the SOF community** — the Altivum Foundation's scholars,
  transitioning operators, and readers of _Beyond the Assessment_
  (`/foundation`, `/beyond-the-assessment`).
- **AI and AWS engineering peers** judging technical depth — `/aws`, `/claude`,
  `/blueprint`, the public MCP server, and the blog.

`[INFERRED — confirm]` Primary audience ranking. The site's structure implies
clients/partners and event bookers are the conversion audiences while veterans
and engineering peers are the credibility audiences, but this ordering is an
inference, not a stated product decision. It changes what any future surface
optimizes for, so confirm it before a `shape` or `new-work` pass.

`[INFERRED — confirm]` Definition of a successful visit. Candidate outcomes
visible in the code are: an inbound `/contact` submission, a newsletter
subscribe (`NewsletterForm`), and credibility that converts off-site. No
analytics goal or funnel definition exists in the repository to settle it.

## Product Purpose

A single authoritative hub for Christian Perez (@thechrisgrey) — his writing,
podcast, book, consulting work, the Altivum Foundation, and the AI tools he
builds. Per the site's own direct-answer summary (`src/data/aeoSummaries.ts`):
"This site is the hub for his writing, podcast, consulting work, and the AI
tools he builds for veterans and small businesses."

The site is also engineered to be _answered from_, not only visited. Every
indexable route ships a 40–80 word direct-answer summary in the first viewport
before the first `<h2>` (`src/data/aeoSummaries.ts`, enforced by the prerender
SEO gate and `src/components/aeo/aeoContent.test.ts`), plus JSON-LD `@graph`
nodes, so AI answer engines can cite the page accurately. AEO readiness is a
first-class product requirement here, not an SEO afterthought.

## Positioning

Two claims a neighboring personal site could not truthfully copy:

1. **The biography.** Former U.S. Army Special Forces Medic (18D) and Green
   Beret with 1st Special Forces Group (Airborne), Bronze Star recipient for a
   deployment to Afghanistan with SFOD-A 1236 — now Founder & CEO of a
   veteran-founded public benefit corporation. Born in Guatemala City;
   Arizona State University alumnus (`src/utils/schemas.ts`,
   `src/data/credentials.ts`).

2. **The site is the artifact.** Most consultant sites _describe_ AI capability;
   this one _runs_ it in public. Alti is a live Bedrock Claude Haiku 4.5 agent
   with RAG over a Bedrock Knowledge Base, eight tools, short-lived session tokens,
   Bedrock Guardrails, and DynamoDB-backed visitor memory. There is a public MCP
   server exposing `ask_alti`, a Web Vitals and CSP telemetry pipeline, a
   Cognito-gated knowledge-base admin, and Blueprint — an Opus-powered
   architecture generator. A visitor evaluating whether the engineering is real
   can verify it by using the site.

## Operating Context

- **Surface:** 17 routes (`src/routes.ts` is the canonical table; `App.tsx`
  holds the JSX and `routes.test.ts` drift-checks the pair). Home is static and
  on the critical path; every other route is `React.lazy()`.
- **Navigation:** header nav (Home, Blog, Alti, Links, Contact) plus an "About"
  dropdown of eight sub-items, both driven by `NAVIGATION_CONFIG` in
  `src/routes.ts`.
- **Fullscreen surfaces:** `/chat` and `/admin` hide the footer and chat widget.
- **Content pipeline:** blog posts from Sanity (`k5950b3w`/`production`);
  podcast episodes fetched from the `@AltivumPress` YouTube channel at build
  time with a static fallback; sitemap and RSS generated from Sanity; OG images
  generated at build; routes prerendered and gated by an SEO validator.
- **Alti's reach:** the assistant is grounded per-route, can navigate the
  visitor between paths (`VALID_PATHS` in the Lambda mirrors `routes.ts`), draft
  a contact message or newsletter signup, cite podcast passages, search the
  blog, and remember non-PII facts across visits.
- **Deployment:** the personal-account Amplify app `d1i0cd2r9ge2of` in
  us-east-1 is deployed with `npm run deploy:frontend:personal`. Its `main`
  branch is manually deployed, so a Git push alone does not publish it.
  Nine Lambda services back the site, deployed via `npm run deploy:personal`.
  See `docs/personal-account-deployment-status.md` for the custom-domain status.

## Capabilities and Constraints

**Confirmed capabilities**

- Conversational agent in two forms: full-viewport `/chat` and a floating 3D
  widget (`public/alti.glb`, 1.15 MB, React Three Fiber) on every other route,
  sharing one engine (`useChatEngine.ts`) with `sessionStorage` continuity.
- Blog with categories, tags, series filtering, Shiki syntax highlighting, and a
  reading progress bar.
- Contact form, newsletter capture, downloadable press kit.
- Cognito-gated `/admin` for knowledge-base CRUD and a site health dashboard.
- Blueprint architecture generator at `/blueprint`.

**Hard constraints future work must respect**

- **No Google Fonts, ever.** Typography uses locally bundled Montserrat with
  system fallbacks. Font assets must remain self-hosted.
- **No emojis anywhere in the UI** — user-facing text, buttons, labels,
  placeholders included. Icons are Material Icons (`<span className="material-icons">`)
  or inline SVG for brand logos.
- **Every new external origin requires a CSP update in `customHttp.yml`.** Three
  recent commits were CSP fixes; this is a live tripwire, not a formality.
- Motion is suppressed twice over: `prefers-reduced-motion` and a build-time
  prerender flag, both via `isMotionDisabled()` (`src/utils/motion.ts`), so
  reveal components render their final state in prerendered HTML.
- Chat is rate-limited (20 req/hr/IP), session-token authenticated, guardrailed, and capped at
  350 output tokens with a plain-text, no-markdown, 2–6 sentence response
  contract.
- Visitor memory is PII-free by server-side enforcement, not by prompt
  instruction (`sanitizeFactContent`).
- `/chat`, `/admin`, and `/blueprint` are `noIndex` and excluded from prerender.

**Explicitly undecided**

- Blueprint is feature-flagged (`VITE_BLUEPRINT_ENABLED`), waitlist-only, and
  still in development. Its V2 Pro tier is unbuilt. Treat it as unlaunched.
- `lambda/blueprint-builder/` (admin CRUD for golden examples) is planned and
  not yet scaffolded.

## Brand Commitments

- **Names:** Christian Perez / @thechrisgrey; Altivum Inc. (veteran-founded
  public benefit corporation, Clarksville TN, founded 2025-02) with three
  divisions — Vanguard, Logic, Press; The Altivum Foundation (501(c)(3), EIN
  41-4163272); The Vector Podcast; _Beyond the Assessment_ (Altivum Press).
- **Palette** (`@theme` in `src/index.css`): `altivum-dark` #0A0F1C,
  `altivum-navy` #1A2332, `altivum-blue` #2E4A6B, `altivum-slate` #4A5A73,
  `altivum-silver` #9BA6B8, `altivum-gold` #C5A572. Gold is the sole accent.
- **Typography:** SF Pro Display at weight 200 as the dominant register, fluid
  `clamp()` sizing through seven named styles in `src/utils/typography.ts`.
- **Voice:** plainspoken and unembellished. The site states credentials as fact
  and lets them carry their own weight; it does not perform intensity. Alti's
  own response contract — plain text, conversational, 2–6 sentences — is the
  clearest statement of the house voice.
- **Assets:** `public/og.png`, `public/tcg.png`, `public/tvp.png` (podcast),
  `public/press-kit/` + `press-kit.zip`, `public/alti.glb`,
  `public/hero-intro-poster.webp`, self-hosted fonts in `public/fonts/`.

## Evidence on Hand

**Real, verifiable, safe to display**

- Bronze Star Medal (U.S. Army) — meritorious service in Afghanistan, SFOD-A 1236.
- Green Beret; Special Forces Medic (18D); 1st Special Forces Group (Airborne).
- AWS Community Builder, AI Engineering track.
- Multiple Anthropic Academy certifications: Claude with Amazon Bedrock, the
  Claude API, Claude Code, Model Context Protocol, AI Fluency.
- Altivum Inc. named Veteran Business of the Month by the Clarksville Area
  Chamber of Commerce, December 2025 — with a public press URL.
- Arizona State University alumnus, with a public ASU profile.
- All of the above live in `src/data/credentials.ts` and are mirrored into
  Person JSON-LD by `buildPersonSchema`, so the visible section and the
  structured data cannot drift.
- Published contact channels: christian.perez@altivum.ai, (615) 219-9425,
  info@altivum.ai, logic@altivum.ai.
- Real content inventory: Sanity blog posts, YouTube podcast episodes from
  `@AltivumPress`, podcast transcripts (`podcast-transcripts/`), the press kit.

**Absences future work must not fabricate**

- **There are no real testimonials.** Every entry in `src/data/testimonials.ts`
  is a labeled placeholder pending TODO(#222), rendered today on Home,
  `/contact`, and `/beyond-the-assessment`. Do not write replacement quotes,
  invent attributions, or soften the placeholder labels into something that
  reads as genuine. Either real permission-cleared quotes arrive, or the
  section does not ship.
- No customer counts, revenue figures, client logos, benchmarks, or case
  studies exist in the repository. Do not generate them.
- No Foundation scholar counts or dollars-awarded figures exist. The 501(c)(3)
  status and EIN are real; program outcomes are not documented here.

## Product Principles

1. **Proof over assertion.** The strongest claim this site makes about
   engineering ability is made by the running software, not by adjectives. When
   a choice exists between describing a capability and demonstrating it,
   demonstrate it.
2. **Understatement is the register.** A Bronze Star and a Green Beret do not
   need amplification; the design's job is to present them cleanly and get out
   of the way. Loudness would read as insecurity against this biography.
3. **Machine-readable is a first-class audience.** Direct-answer summaries,
   JSON-LD, prerendered HTML, and the MCP server exist so answer engines can
   quote the site correctly. A surface that reads well to a human but is opaque
   to a crawler is unfinished.
4. **One source of truth per fact.** Routes, credentials, navigation, speaking
   topics, and AEO summaries each live in exactly one typed file with a drift
   test guarding it. New content follows the same rule — never a second copy.
5. **Never fabricate proof.** Where evidence is absent (testimonials, metrics,
   client names), the honest gap ships. This is the one principle that
   overrides any persuasion goal.

## Accessibility & Inclusion

No external standard is named in the repository, but the implemented floor is
consistent and must be preserved:

- `prefers-reduced-motion: reduce` disables Lenis smooth scrolling entirely and
  suppresses all reveal animations to their final state.
- Focus trapping for modals (`useFocusTrap`), `focus-visible` gold outlines, and
  a skip-to-content link.
- Minimum 48px tap targets, `touch-manipulation`, mobile-first layouts.
- `role="status"` live region for route-level loading announcements.
- Page-level and global error boundaries with authored fallback UIs; the top
  boundary is keyed on `location.pathname` so a stale-chunk throw clears on
  navigation instead of trapping the visitor.
- Blog images carry a fixed 4:3 aspect ratio to prevent layout shift; a CLS
  alarm (>0.25/hr) is wired to SNS.

`[INFERRED — confirm]` Target conformance level. The practices above are
consistent with WCAG 2.2 AA, but no conformance target has been stated. Confirm
whether AA is the commitment before any audit measures against it.
