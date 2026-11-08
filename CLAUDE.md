# CLAUDE.md

## Project Overview

Personal website for Christian Perez (@thechrisgrey) - Founder & CEO of Altivum Inc., former Green Beret (18D), host of The Vector Podcast, author of "Beyond the Assessment". React 19 + TypeScript + Vite + Tailwind CSS, deployed on AWS Amplify.

Check `docs/ideas-to-consider.md` for pending feature ideas.

## Code quality is the standing priority

Quality, correct, secure code is **always** the priority — never "whatever solves the issue the fastest." Unless the user explicitly asks for a quick fix, a spike, or a throwaway prototype, default to the highest-quality implementation: sound architecture, secure by default, well-tested, accessible, and consistent with the patterns already in this codebase. Speed is never a reason to ship something fragile, insecure, or hacky. When the fast path and the clean path diverge, take the clean path — or surface the tradeoff and let the user choose. Never silently optimize for speed at the expense of quality.

## Verification — run the real thing, always

**Green tests are NOT proof a feature works.** Before claiming anything works — and especially for anything that touches an external service (AWS/Bedrock, deploys, streaming, APIs, auth) — exercise the REAL deployed path with a real request, not just mocks and unit tests.

- **Distrust fakes:** confirm the live SDK/API actually behaves the way the mock assumes. (A mock that _rejected_ on abort hid a real bug where the live `ConverseStream` _ended gracefully_ — the test stayed green while the behavior was broken.)
- This repo shipped a Bedrock guardrail with 1,000+ green tests that **never once fired in production** (wrong API signal, an invalid enum value, output false-blocking) — only signed requests to the live endpoint surfaced it.
- **Report honestly:** say "tests pass" for passing tests; reserve "it works" for behavior you have watched work end-to-end.

## Shared lessons — the hive-mind vault

The cross-project lessons vault is at `/Users/cperez/dev/hive-mind`. Before
making a non-trivial infrastructure, build, security, or tooling decision,
read its `CONVENTIONS.md` and consult relevant notes in `Lessons/`. Add only
new, project-agnostic lessons there, following its conventions; retain
project-specific facts in this repository's documentation.

## Commands

```bash
npm run dev          # Dev server at localhost:5173
npm run build        # Full pipeline: env validation → podcast episodes → lint → tsc → vite build → sitemap → RSS
npm run preview      # Preview production build
npm run lint         # ESLint
```

**Deployment:** The personal-account foundation stack owns a static, manually deployed Amplify app. `npm run deploy:frontend:personal` publishes to its default Amplify domain. Do not attach the custom domain or change DNS without explicit user direction.

**AWS account: always explicit.** The site's target account is Christian Perez - Personal Account `973662476023` (profile `qdev-personal`). The reproducible durable foundation lives in `infra/personal-account-foundation.yaml`; it owns the source and artifact buckets, DynamoDB tables, S3 Vectors indexes, Bedrock Knowledge Bases, guardrail, and Cognito admin pool. Interactive shells may export any `AWS_PROFILE`, so never run a bare `aws` command for this repo: use `--profile qdev-personal`. The AWS scripts pin that profile through `scripts/lib/aws-preflight.sh` and refuse to run unless the caller account is `973662476023`. Historical IDs in `docs/migration-execution-plan.md` describe retired-account work and must not be used for deployment.

**Lambda deploy pattern:** Use the verified script — never hand-build `function.zip` (the manual `zip` glob omits sibling modules each handler imports and ships a crash-on-cold-start artifact).

```bash
npm run deploy:personal -- --dry-run          # package + validate every service, no uploads or resource writes
npm run deploy:personal                        # full stack-managed deploy to qdev-personal / 973662476023
npm run deploy:frontend:personal               # build + deploy static frontend to Amplify's default domain
npm run deploy:lambda -- <name> --dry-run     # build + verify one module graph, no upload
```

`scripts/deploy-personal-account.sh` runs the same verified packaging for all services, writes versioned artifacts to the private foundation bucket, and updates `thechrisgrey-services`. It reads provider values from ignored `infra/personal-account.env`; generated signing keys are stored in Secrets Manager. `scripts/deploy-lambda.sh` remains a targeted break-glass updater after the service stack exists.

## Architecture

### Routing

- React Router v7, layout: `App.tsx` → ScrollToTop → Navigation → Suspense → Routes → Footer
- All routes except Home use `React.lazy()`. Home is static (critical path).
- **17 routes:** `/`, `/about`, `/altivum`, `/foundation`, `/podcast`, `/beyond-the-assessment`, `/aws`, `/claude`, `/blog`, `/blog/:slug`, `/links`, `/contact`, `/chat`, `/privacy`, `/admin`, `/blueprint`, catch-all 404
- **Single source of truth:** `src/routes.ts` exports the canonical `ROUTES` table (path + lazy importer + Alti grounding context + starter suggestions + `noPrefetch` flag). `routeManifest.ts` derives hover-prefetch from it; `pageContext.ts` derives `ROUTE_CONTEXT_MAP` + `PAGE_SUGGESTIONS` from it. App.tsx still has explicit `<Route>` JSX (readable). A drift test in `src/routes.test.ts` asserts the two stay in sync.
- Footer + chat widget hidden on fullscreen pages (`/chat`, `/admin`)
- Top-level `<ErrorBoundary>` is keyed by `location.pathname` so a render-time throw (e.g. a stale lazy chunk) clears on client-side navigation instead of trapping the user until a full reload.
- The chat Lambda mirrors the route table: `VALID_PATHS` (`lambda/chat-stream/validation.mjs`) + the `navigate_to` tool description list the navigable paths; `validation-drift.test.mjs` asserts `VALID_PATHS` stays a superset of `routes.ts` (parsed as text — the Lambda can't import the TS table).

### Design System

**Colors** (`@theme` block in `src/index.css`, Tailwind v4 CSS-first config — no more `tailwind.config.js`): `altivum-dark` #0A0F1C, `altivum-navy` #1A2332, `altivum-blue` #2E4A6B, `altivum-slate` #4A5A73, `altivum-silver` #9BA6B8, `altivum-gold` #C5A572

**Typography** (`src/utils/typography.ts`): SF Pro Display (weight 200), fluid `clamp()` sizing. 7 styles: heroHeader, sectionHeader, cardTitleLarge, cardTitleSmall, subtitle, bodyText, smallText. Usage: `<h1 style={typography.heroHeader}>`. NEVER use Google Fonts.

**Icons:** Material Icons via CDN (`<span className="material-icons">name</span>`). Brand logos = inline SVG.

**Animations** (`@theme` block in `src/index.css`): `animate-fade-in` (1.2s), `animate-nav-fade-in` (0.8s, 2s delay), `animate-widget-open` (250ms). Motion is also disabled at the component level via `isMotionDisabled()` (`src/utils/motion.ts`) which combines `prefers-reduced-motion` and the build-time prerender flag, so reveal components render their final state in the prerendered HTML.

**Smooth Scroll:** Lenis (`src/hooks/useLenis.ts`, `src/components/LenisProvider.tsx`) provides momentum-based inertial scrolling site-wide. Configured at `lerp: 0.1` desktop / `0.07` touch. Disabled entirely when `prefers-reduced-motion: reduce`. Scrollable sub-containers (chat panel) use `data-lenis-prevent`.

**View Transitions:** `src/hooks/useViewTransitionNavigate.ts` + `src/components/ViewTransitionLink.tsx` wrap React Router navigations in `document.startViewTransition()`. Persistent elements (nav, footer, chat widget) use `data-vt-persist` attribute to exclude from crossfade. CSS keyframes in `index.css` (`vt-fade-out`/`vt-fade-in`, 150-200ms). Use `<ViewTransitionLink>` instead of `<Link>` for all internal navigation (except error boundaries).

**ScrollTrigger Text Reveals:** `src/components/SplitReveal.tsx` + `src/components/FadeReveal.tsx` use GSAP ScrollTrigger for scroll-linked word-by-word animations. Accept `triggerRef`, `triggerStart`, `triggerEnd` props for sticky-section positioning. Mock GSAP in jsdom tests.

**Micro-interactions:**

- Card hover: `hover:-translate-y-0.5 hover:shadow-lg hover:shadow-altivum-gold/5 transition-all duration-300`
- Button press: `active:scale-[0.98]`
- CTA glow: `hover:shadow-[0_0_20px_rgba(197,165,114,0.3)]`
- Arrow nudge: `group-hover:translate-x-1`
- Animated underlines: `.link-underline` class in `index.css`
- Gradient dividers: `h-px bg-gradient-to-r from-transparent via-altivum-gold/15 to-transparent`

**Gotcha:** Gradient div + section inside conditionals need `<>` fragment wrapper.

### Home Page Scroll

`src/pages/Home.tsx`: Hero (100vh) → Summary (675vh mobile / 840vh desktop, sticky profile + 8 scroll-triggered key points) → CTA. Key points animate via GSAP ScrollTrigger (`SplitReveal` for titles, `FadeReveal` for subtitles), each triggered at staggered positions (5%+11%*index) within the section's scroll range. No manual scroll listener — ScrollTrigger handles everything. Nav transparency threshold: `window.innerHeight * 10`.

### Navigation

`src/components/Navigation.tsx`: "About" dropdown (6 sub-items), closes on outside click. Nav items: Home, Blog, Links, Contact. Mobile: hamburger with inline expanded About. Solid after 20px scroll on non-home pages.

### SEO

`src/components/SEO.tsx`: react-helmet-async, appends "| Christian Perez", JSON-LD `@graph` (Person + Organization + WebSite). Props: title, description, keywords, faq, breadcrumbs, structuredData.

`src/utils/schemas.ts`: buildPersonSchema, buildOrganizationSchema, buildFAQSchema, buildBreadcrumbSchema, buildPodcastSeriesSchema, buildBookSchema, buildServiceSchema, buildWebPageSchema, buildProfilePageSchema, buildContactPageSchema.

### Security Headers

Configured in `amplify.yml`: HSTS, nosniff, SAMEORIGIN, strict-origin-when-cross-origin, Permissions-Policy (deny cam/mic/geo), CSP with allowlisted origins. **When adding external resources, update CSP in `amplify.yml`.**

### Sanity CMS (Blog)

Project `k5950b3w`, dataset `production`. Config in `src/sanity/` (client.ts, queries.ts, types.ts, PortableTextComponents.tsx). Posts support categories, tags, series, featured, reading time. Client timeout: 10s frontend, 15s build scripts.

### Alti — AI Agent

Full-viewport chat at `/chat` + floating 3D widget on all other pages. Powered by Bedrock Claude Haiku 4.5 + RAG via Knowledge Base + Strands Agents SDK.

**Shared Engine** (`src/hooks/useChatEngine.ts`): Manages messages, streaming, history. Both chat page and widget consume independently; `sessionStorage` syncs across navigation.

**Widget** (`src/components/chat/`): ChatWidget → ChatWidgetButton (3D AltiMascot via R3F, 64x64 Canvas, `public/alti.glb` 1.15MB meshopt+WebP) + ChatWidgetPanel (400x560 desktop, full mobile). Widget hidden on `/chat`.

**Backend** (`lambda/chat-stream/`):

- Streaming via `awslambda.streamifyResponse()`, Strands SDK v1.0.0-rc.4, Claude Haiku 4.5
- Modules: index.mjs (handler), agent.mjs (factory), tools/ (navigate, draftMessage, draftNewsletter, citePassage, searchBlog, rememberFact), events.mjs, memory.mjs, prompts.mjs
- Routes: `POST /` (chat), `POST /forget` (erase visitor memory)
- Role: `thechrisgrey-chat-stream-role`

**Event Protocol:** Text streams raw. Events framed: `\x00EVT\x00{json}\x00EVT\x00`. Errors: `\x00SYS\x00` prefix. Client parser: `src/utils/chatEvents.ts`.

**Visitor Memory:** DynamoDB `thechrisgrey-chat-memory`, partitioned by deviceHash (SHA-256 of localStorage UUID from `src/utils/deviceId.ts`). 90-day TTL. PII disallowed — enforced server-side: `sanitizeFactContent` (`memory.mjs`) rejects facts containing emails or phone-shaped digit runs before persistence, not just by prompt instruction.

**Security:**

- HMAC-SHA256 request signing (`src/utils/chatSigning.ts`): `X-Chat-Timestamp` + `X-Chat-Signature`, 5-min window, timingSafeEqual
- Rate limit: 20 req/hr per IP (atomic DynamoDB, table `thechrisgrey-chat-ratelimit`, sourceIp only)
- Input validation: role whitelist (user/assistant), 4000 char/msg, 50 msg cap
- Server-side 20-msg sliding window; client mirrors
- Guardrail: the current ID and version are exported by `thechrisgrey-foundation`; it filters PROMPT_ATTACK/HATE/INSULTS/SEXUAL(HIGH), VIOLENCE/MISCONDUCT(MED)
- PageContext hardening: whitelisted paths, regex blog slugs, SAFE_TEXT_PATTERN
- Timeouts: 25s agent, 10s Bedrock invocation, 20s client token handshake + 45s client stream budget (armed after the session-token round trip), 10s client `/forget`. The old single 30s client cap started before the Turnstile/issuer handshake, so it raced the server's own 25s agent budget plus up to 4s of KB retrieval.

**Agentic UI** (`ToolDraftCard.tsx`): 5 variants (navigate, contact, newsletter, citation, blog_search_results). ChatMessage shows tool activity, memory badges, draft cards.

**Response rules:** Plain text only, no markdown, conversational, 2-6 sentences, maxTokens 350, temp 0.6.

**Knowledge Base:** The current IDs and source bucket are generated by `thechrisgrey-foundation` in us-east-1. It provisions S3 Vectors stores with Titan Embeddings v2; S3 Vectors require `AMAZON_BEDROCK_TEXT` + `AMAZON_BEDROCK_METADATA` as non-filterable keys.

**KB Sync** (`lambda/kb-sync/`): S3 event-triggered → StartIngestionJob. The foundation stack exports the current KB and data-source IDs; transcript tooling resolves those outputs at runtime rather than hard-coding IDs.

**Logging:** Log group `tcg-AI-chat` (7-day retention). All Lambda logging goes through `lambda/shared/logger.mjs` `createLogger()`, which automatically redacts PII (emails, phone-shaped digit runs) and sensitive keys (authorization, token, password, secret) via the `redact()` function before writing to CloudWatch. See `docs/bedrock-logging-queries.md`.

### Blueprint (in development)

Architecture generator at `/blueprint`. Opus 4.6 generates blueprint from spec; Haiku 4.5 validates. V1 waitlist-only, V2 adds Pro tier.

**Design principles:** Engine-first (`lambda/blueprint/engine.mjs` is transport-agnostic), monetization at handler layer, single-source schema (`schema.mjs` → Zod → JSON Schema), golden-example grounding from Sanity `architectureBlueprint` docs.

**Layout:** `lambda/blueprint/` (engine, schema, prompts, artifacts, validation, bedrock, goldenExamples), `lambda/blueprint-builder/` (admin CRUD — planned, not yet scaffolded), `src/pages/Blueprint.tsx`, `src/components/blueprint/`, `src/hooks/useBlueprint.ts`

**Rate limit:** 1/30 days per device (`blueprint-{deviceHash}` prefix). Alarms: opus-cost $25/day, errors >20%/15min, validation-failures >10%.

**Frontend:** Home scroll tab #8, feature-flagged `VITE_BLUEPRINT_ENABLED`, waitlist reuses newsletter Lambda.

**Env vars:** Lambda: `BLUEPRINT_SIGNING_KEY`, `BLUEPRINT_RATE_LIMIT_TABLE`, `SANITY_*`, `BEDROCK_OPUS_MODEL_ID`, `BEDROCK_HAIKU_MODEL_ID`, `GUARDRAIL_ID`, `GUARDRAIL_VERSION` (default to the live guardrail in code). Frontend: `VITE_BLUEPRINT_ENDPOINT`, `VITE_BLUEPRINT_SIGNING_KEY`, `VITE_BLUEPRINT_ENABLED`.

### KB Admin (`/admin`)

Cognito-protected (`thechrisgrey-admin-pool`). KB Builder Lambda (`thechrisgrey-kb-builder`): CRUD `/entries` + `/publish` → assembles `knowledge-base.txt` → S3 → auto-sync. Sanity doc type `kbEntry` (title, category, content, date, sortOrder, isActive).

### Build-time Generators

- `scripts/validate-env.js`: Checks required VITE_* vars, fails build if missing
- `scripts/generate-sitemap.js`: Sanity posts → `dist/sitemap.xml` (fail-fast)
- `scripts/generate-rss.js`: Sanity posts → `dist/rss.xml` (fail-fast)
- `scripts/generate-podcast-episodes.js`: YouTube API → `src/data/generatedEpisodes.json` (falls back to static data)

### Blog Features

Series filtering (`?series=<slug>`), categories from data, Shiki syntax highlighting (15 langs via `src/utils/shikiHighlighter.ts` singleton — **never bare `import('shiki')`**), image CLS fix (aspect-ratio 4:3), ReadingProgressBar.

### Analytics & Monitoring

- Cloudflare + Plausible (both cookie-free). Plausible init in `public/plausible-init.js` for CSP.
- Web Vitals (`src/utils/webVitals.ts`) → metrics Lambda (`thechrisgrey-metrics`, us-east-1)
  - Endpoints: POST `/vitals`, POST `/csp-report`, GET `/health` (Cognito-auth'd)
  - Namespace: `TheChrisGrey/SiteMetrics`
  - Rate limits: 200 vitals/min, 100 CSP/min per IP
- CloudWatch alarms → SNS `thechrisgrey-site-alerts` → chris@altivum.ai:
  - Frontend: high-cls (>0.25/1hr), csp-violations (>20/hr)
  - Chat-stream: kb-failures (>5/hr), rate-limit-surge (>50/hr), bedrock-cost ($25/day), agent-timeout (>5/15min)
  - Blueprint: opus-cost ($25/day), errors (>3/15min), validation-failures (>5/hr), opus-timeout (>3/15min), generation-errors (>5/hr)
  - KB-builder: kb-builder-errors (>5/15min, log-based)
  - KB-sync: kb-sync-failure (>0/5min)
  - Metrics: metrics-errors (>5/15min, log-based, telemetry pipeline health)
  - MCP-server: mcp-ratelimit-surge (>20/hr), mcp-errors (>10/15min, log-based)
  - Session-token: session-turnstile-failures (>30/hr, log-based), session-ratelimit-surge (>50/hr, log-based)
  - Alarms are managed via `scripts/setup-alarms.sh` (run after infra changes)
- Site Health Dashboard on `/admin` via `useSiteHealth.ts`

### Lambda Fleet

Seven services under `lambda/`. All ESM `.mjs`, all on AWS SDK v3 (current `^3.1068` per the dep sweep in #111):

- **`lambda/chat-stream/`** — Alti's brain. Strands SDK + Bedrock Haiku 4.5 + KB retrieval + 8 tools + HMAC + rate limit + Bedrock Guardrail. Streams via `awslambda.streamifyResponse`.
- **`lambda/blueprint/`** — Architecture generator (Opus 4.6, **Converse/ConverseStream API**) with golden-example RAG, Zod schema validation, Haiku quality verdict pass. Engine is transport-agnostic (`engine.mjs`). The foundation guardrail is applied as a dedicated **`ApplyGuardrail` INPUT pre-check** before generation (`applyInputGuardrail` in `bedrock.mjs`); **generation itself runs UNGUARDED** — guarding it false-blocked legitimate output (the chat-tuned guardrail flagged the directive system prompt as a prompt-attack and flagged generated IAM/architecture as policy violations). A blocked input surfaces `guardrail_intervened` + `BlueprintGuardrailIntervention`. Requires `bedrock:ApplyGuardrail` in the role (`iam-policy.json`).
- **`lambda/kb-builder/`** — Cognito-auth'd CRUD on Sanity `kbEntry`. Builds `knowledge-base.txt` → S3 → auto-sync. PUT/DELETE both check `_type === 'kbEntry'` before writing.
- **`lambda/kb-sync/`** — S3 event-triggered `StartIngestionJob` for the Bedrock KB.
- **`lambda/metrics/`** — Web Vitals + CSP report ingestion → CloudWatch. Cognito-auth'd `/health`.
- **`lambda/mcp-server/`** — Public MCP server exposing `ask_alti` tool (KB retrieval + Bedrock + Guardrail). Same guardrail as chat-stream. Imports `checkRateLimit` via the `lambda-shared/rateLimit` subpath (not the barrel) to keep the CloudWatch SDK out of cold start.
- **`lambda/shared/`** — `checkRateLimit` (atomic DynamoDB ADD), `validateCognitoToken` (with email allowlist), `respond`, `hmac`, `metrics` MetricsCollector, `sanityQueries`. Listed as `"lambda-shared": "file:../shared"` in each Lambda's package.json. AWS SDK clients injected as params.

### Component Patterns

- Mobile-first, `touch-manipulation`, min-h-[48px] tap targets
- Images: `src/assets/` = optimized (80% quality); `public/` = full quality (profile1.jpeg)
- YouTubeFacade: click-to-play with maxresdefault thumbnail
- ErrorBoundary: global + page-level (Blog, Chat). Fallbacks in `ErrorFallbacks.tsx`
- Focus: `useFocusTrap` for modals, `focus-visible` gold outlines, skip-to-content
- 3D: Three.js mocked in all jsdom tests (WebGL unavailable)

### Testing Gotchas

- AltiMascot must be mocked in jsdom tests (no WebGL)
- React 19 + react-helmet-async: SEO integration test needs explicit `cleanup()` in try-catch

## Environment Variables

**Amplify (us-east-1, manual static deployment):** `VITE_CONTACT_ENDPOINT`, `VITE_NEWSLETTER_ENDPOINT`, `VITE_CHAT_ENDPOINT`, `VITE_BLUEPRINT_ENDPOINT`, `VITE_SESSION_ENDPOINT`, `VITE_TURNSTILE_SITE_KEY`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_KB_BUILDER_ENDPOINT`, `VITE_METRICS_ENDPOINT`, and `YOUTUBE_API_KEY` (build-only). `npm run deploy:frontend:personal` loads the ignored `.env.local` before it builds, then publishes to the default Amplify domain.

**Chat-stream Lambda:** `CHAT_SIGNING_KEY`, `SESSION_TOKEN_KEY`, `CHAT_RATE_LIMIT_TABLE` (thechrisgrey-chat-ratelimit), `CHAT_MEMORY_TABLE` (thechrisgrey-chat-memory), `KB_ID`, `PODCAST_KB_ID` (unset disables the `search_podcast` tool), `GUARDRAIL_ID`, `GUARDRAIL_VERSION`, `BEDROCK_MODEL_ID`, `SANITY_PROJECT_ID`, `SANITY_DATASET` (optional, enables cite tool). `BEDROCK_MODEL_ID` and the region are env-first but default in code to the current live values (Haiku 4.5 / us-east-1), so no deploy change was needed to introduce them — `AWS_REGION` is a Lambda-reserved variable the runtime supplies, not one to set on the function. No `KB_DATA_SOURCE_ID` here: chat-stream only retrieves, so the data-source id belongs to kb-sync.

**KB-sync Lambda:** `KB_ID` and `KB_DATA_SOURCE_ID` come from foundation exports at stack deployment; the legacy `DATA_SOURCE_ID` name is still honoured as a fallback. A retryable `StartIngestionJob` failure is re-thrown so the S3 async invoke retries instead of dropping the sync, and the role needs `bedrock:GetIngestionJob` (it polls the job to settle) alongside `bedrock:StartIngestionJob`.

**Important:** Local `.env.local` is ignored. Its `VITE_*` values are public build configuration, and the manual frontend deploy script uses them to produce the hosted artifact. Never place server secrets there.

## Deployment Notes

- Node 22 (`.nvmrc`), never commit `node_modules/` or `dist/`
- `public/` → dist root; `src/assets/` → hashed bundles
- Site: `https://thechrisgrey.com`
- Amplify config: `amplify.yml`

## AWS Agent Toolkit

For this repository, use AWS profile `qdev-personal`, account `973662476023`,
and Region `us-east-1`. Verify the account through the tool being used before
changing resources. The project's existing deployment and approval rules take
precedence over the general AWS guidance below.

<!-- BEGIN AWS Agent Toolkit rules -->

# AWS Guidance

- Where these AWS rules conflict with the project's own instructions, the
  project's instructions take precedence.
- Prefer the AWS MCP Server for AWS interactions — it provides sandboxed
  execution, observability, and audit logging. If unavailable, use the
  AWS CLI directly.
- For any AWS task or question — building, configuring, migrating, debugging,
  or operating a service, writing SDK code, authoring CDK/CloudFormation, or
  answering how a service works — first call `aws___search_documentation` with
  topic `agent_skills` and load the matching skill with `aws___retrieve_skill`.
  Do this even when you believe you know the answer: skills carry current
  service behavior that your training may not. Prefer the skill's guidance over
  general knowledge. Skip it only for work that does not involve AWS.
- When uncertain about specific AWS details (API parameters, permissions,
  limits, error codes), verify against documentation rather than guessing.
  State uncertainty explicitly if you cannot confirm.
- Before reporting a count, a total, or that something does not exist, read
  every page of the results and search every Region and scope where it could
  be. If you could not, say the result is partial and name what you checked.
- To say what a system currently does, read what the runtime uses: the
  completed deployment, the alias or version that is invoked, the template the
  stack is running. A newer stored version, a draft, or a description field is
  not evidence of live behavior.
- Present a cause as confirmed only if data, configuration, or logs you read
  show it. Label anything else as unverified, and say what you would check
  next.
- Before you interpret the records that show a failure, such as error log
  lines, failed executions, or table items, read one of them whole, with
  every field. Don't truncate messages or select fields in your own code
  until you have.
- When an error says a value was undefined, null, empty, or missing, find
  the input, query result, or item that supplied that value. If the account
  shows why it was empty, such as no item matching the key, read that
  before you call the cause unverified.
- When a field in a record you read explains the result, such as an error
  counter, an empty array, a null, or a state value, name the field and its
  exact value in the answer, and say which record it came from.
- When the user asks a specific question or names a suspected cause, confirm
  or rule out each cause they raised, and do not offer alternatives your evidence
  does not support.
- When creating infrastructure, prefer infrastructure-as-code (AWS CDK or
  CloudFormation) over direct CLI commands.
- When working with infrastructure, follow AWS Well-Architected Framework
  principles.
- Do not use em dashes in AWS resource names or descriptions. Use
  hyphens instead.

## Before you conclude

- Before deciding the AWS account can't hold what the request asks for,
  look. List the places it could live, such as S3 buckets, databases, and
  log groups, and read what is there.
- Don't conclude that records are missing from metadata, such as a
  creation date or a stored-bytes count, or from one query that failed or
  came back empty. Read the records another way, across the full time
  range, before reporting them absent.
- A tool's own error is evidence. If a call the answer depends on fails
  with expired or missing credentials or AccessDenied, report that error
  and what it blocks, and don't overrule it with another check. Searching
  other Regions is for finding resources, not for retrying an auth error.
  Retry throttling with backoff before you report it.

## Secret Safety

- MUST load the `aws-secrets-manager` skill first for any secret,
  credential, API key, token, or password task. MUST NOT call
  `secretsmanager get-secret-value` or `batch-get-secret-value`, and MUST
  NOT hit the Secrets Manager Agent daemon directly. MUST use
  `{{resolve:secretsmanager:secret-id:SecretString:json-key}}` with
  `asm-exec` so the secret resolves at runtime without entering context.

<!-- END AWS Agent Toolkit rules -->
