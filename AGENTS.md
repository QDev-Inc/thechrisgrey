# AGENTS.md

Guidance for autonomous coding agents working in this repository. This is the
canonical, machine-facing entry point. `CLAUDE.md` holds the deep architectural
reference; read it when you need subsystem detail. This file gives you the
essentials to set up, build, test, and change the code correctly.

## What this repo is

Personal website for Christian Perez (`thechrisgrey.com`). A React 19 +
TypeScript + Vite single-page app (deployed on AWS Amplify) plus nine
independently deployable AWS Lambda services under `lambda/`. The AI chat agent
"Alti" is powered by Amazon Bedrock (Claude Haiku 4.5) with RAG.

## Shared lessons — Hive Mind

The cross-project lessons vault is at `/Users/cperez/dev/hive-mind`. Before
making a non-trivial infrastructure, build, security, or tooling decision,
read `/Users/cperez/dev/hive-mind/CONVENTIONS.md` and consult relevant notes in
`/Users/cperez/dev/hive-mind/Lessons/`. Add only
new, project-agnostic lessons there, following its conventions; retain
project-specific facts in this repository's documentation.

## Setup

- **Node 22** is required (pinned in `.nvmrc`). Use `nvm use` before anything.
- Package manager is **npm** (a committed `package-lock.json` is the source of truth).
- **npm workspaces** manages the frontend + 10 Lambda packages as a monorepo.
  `npm install` at the root installs all workspace deps and symlinks `lambda-shared`.

```bash
nvm use            # switch to Node 22
npm install        # install frontend + all Lambda workspace deps
npm run dev        # dev server at http://localhost:5173
```

Copy `.env.example` to `.env.local` and fill required `VITE_*` values before the
app can talk to its backends. Never commit `.env` or `.env.local`.

A dev container is configured in `.devcontainer/devcontainer.json` for VS Code
Remote Containers and GitHub Codespaces. It uses the Node 22 JavaScript image
with AWS CLI, GitHub CLI, ESLint, Prettier, Tailwind IntelliSense, and Vitest
extensions pre-installed. Opening the repo in a supported editor will prompt to
rebuild in the container automatically.

## Core commands

| Command                                | What it does                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `npm run dev`                          | Vite dev server (localhost:5173)                                              |
| `npm run build`                        | Full production pipeline (see below)                                          |
| `npm run build:timed`                  | Build with per-step timing report                                             |
| `npm run build:compare`                | Compare build timing vs previous CI run                                       |
| `npm run bundle:size`                  | Measure + budget-check the built frontend bundle                              |
| `npm run lambda:size`                  | Measure + budget-check every Lambda deployment package                        |
| `npm run build:analyze`                | Interactive bundle treemap (vite-bundle-visualizer)                           |
| `npm run preview`                      | Serve the production build locally                                            |
| `npm run lint`                         | ESLint on `src/` (`--max-warnings 0`)                                         |
| `npm run lint:lambda`                  | ESLint on `lambda/` `.mjs` handlers                                           |
| `npm run tsc:lambda`                   | Type-check Lambda `.mjs` files via tsc                                        |
| `npm run format`                       | Prettier auto-format all files (`--write`)                                    |
| `npm run format:check`                 | Prettier check (CI gate, no writes)                                           |
| `npm test`                             | Vitest run (frontend unit + integration)                                      |
| `npm run test:watch`                   | Vitest in watch mode                                                          |
| `npm run test:coverage`                | Vitest with v8 coverage + thresholds                                          |
| `npm run test:lambda`                  | `node --test` suites for every Lambda                                         |
| `npm run test:lambda:coverage`         | Lambda tests with coverage threshold check                                    |
| `npm run test:lambda:turbo`            | Run every Lambda's `test` task via Turborepo (cached, parallel)               |
| `npm run cy:run`                       | Cypress e2e (headless)                                                        |
| `npm run cy:open`                      | Cypress interactive runner                                                    |
| `npm run validate:agents`              | Check this file stays in sync with the code                                   |
| `npm run knip`                         | Dead code and unused dependency detection                                     |
| `npm run jscpd`                        | Duplicate code detection (threshold 5%)                                       |
| `npm run check:tech-debt`              | TODO/FIXME must link to an issue                                              |
| `npm run syncpack`                     | Detect dependency version drift across workspaces                             |
| `npm run check:dep-age`                | Check dependency updates meet minimum release age                             |
| `npm run check:feature-flags`          | Detect dead or orphaned feature flags                                         |
| `npm run deploy:personal -- --dry-run` | Package every Lambda and validate the personal-account stack without writes   |
| `npm run deploy:personal`              | Deploy all Lambda artifacts and the application stack to the personal account |
| `npm run deploy:frontend:personal`     | Build and manually deploy the static frontend to personal-account Amplify     |
| `npm run deploy:lambda -- <name>`      | Deploy one Lambda (see Deployment)                                            |
| `npm run changelog`                    | Preview changelog from conventional commits                                   |
| `npm run docs:api`                     | Generate TypeScript API docs via TypeDoc (HTML)                               |
| `npm run docs:openapi`                 | Generate Lambda API reference markdown from OpenAPI specs                     |
| `npm run docs:gen`                     | Generate all documentation (TypeDoc + OpenAPI markdown)                       |

### Build pipeline

`npm run build` runs, in order:

```
validate-env -> generate-podcast-episodes -> lint -> tsc -> vite build
  -> generate-og-images -> prerender -> validate-prerender-seo
  -> generate-sitemap -> generate-rss
```

Any step failing fails the build. `tsc` runs in `--noEmit` type-check mode and
lint runs with zero-warning tolerance, so type and lint errors block the build.

Build-step timing is tracked (`npm run build:timed`) and compared against both
the previous CI run and the committed absolute ceilings in
`build-performance-budgets.json` (`npm run build:compare`). The non-blocking
`build-performance` CI job caches the Vite build, uploads the report, and
surfaces regressions and budget breaches in the run summary. See
`docs/build-performance.md`.

Frontend bundle size is measured and budgeted after the build: `npm run
bundle:size` (`scripts/track-bundle-size.mjs`) computes gzip/raw size for every
emitted chunk and checks the named code-split groups + JS/CSS totals against
`bundle-size-budgets.json`, failing on regressions. The same `build-performance`
CI job runs it against the freshly built dist output, reports gzip-size deltas
vs the previous run, and uploads a `bundle-size-report` artifact. For an interactive
treemap, run `npm run build:analyze`.

Lambda deployment package sizes are measured and budgeted by `npm run
lambda:size` (`scripts/track-lambda-size.mjs`). For each service it reinstalls
the production dependency tree self-contained (`--no-workspaces`, matching
`scripts/deploy-lambda.sh`), dereferences `lambda-shared` into `node_modules`,
then measures the unzipped source + `node_modules` size and the `function.zip`
size, checking both against per-service ceilings in `lambda-size-budgets.json`.
AWS Lambda enforces 250 MB unzipped / 50 MB zipped hard limits; the budgets
carry ~40% headroom under those, so a heavy-dependency regression fails the
check before it breaks a deploy. Pass `--no-install` to measure an already
installed tree (e.g. in CI after the Lambda install step), `--lambda <name>` to
measure a single service, or `--output report.json` to emit a JSON report.

## Testing

- **Frontend:** Vitest + React Testing Library, jsdom environment. Test files
  are `src/**/*.test.{ts,tsx}`; integration tests live in
  `src/__tests__/integration/`. Coverage thresholds are enforced in
  `vitest.config.ts` (lines 66 / statements 64 / branches 62 / functions 60).
- **Lambdas:** Node's built-in test runner (`node --test`) over
  `lambda/**/__tests__/*.test.mjs`. Run all via `npm run test:lambda`.
- **E2E:** Cypress specs in `cypress/e2e/`. Only mock-stubbed specs run in CI;
  WebGL-dependent specs (home, navigation, chat widget) are excluded there.
- **Live-API contract tests (opt-in):** suites that hit the real Cognito,
  Sanity, Bedrock KB, and guardrail boundaries. They skip cleanly unless their
  env flag is set. See `.env.example` for flags and required AWS permissions.

**Verification rule:** green unit tests are NOT proof a feature works. For
anything touching an external service (Bedrock, Amplify, streaming, auth),
exercise the real deployed path before claiming it works. Distrust mocks that
assume behavior the live SDK may not exhibit.

Run before finishing any change: `npm run format:check`, `npm run lint`, `npm run
lint:lambda` and `npm run tsc:lambda` (if you touched `lambda/`), `npm test`, and
`npm run test:lambda` (if you touched `lambda/`), and `npm run test:lambda:coverage`
(if you touched `lambda/`). Pre-commit hooks (husky + lint-staged) auto-run ESLint
and Prettier on staged files, but the full checks above should still be run manually.

If you edit this file, run `npm run validate:agents` to confirm it stays in
sync with the code. That check verifies every documented `npm run` command, file
reference, and the Node version against the repo, and it also runs in CI so a
stale AGENTS.md fails the build.

## Repository layout

```
src/                 React app (components/, pages/, hooks/, sanity/, utils/, __tests__/)
src/routes.ts        Single source of truth for routes (see Conventions)
lambda/shared/       Shared Lambda utils (auth, rate limit, hmac, metrics, error tracking) - a library, not deployed alone
lambda/chat-stream/  Alti chat streaming (Strands + Bedrock + KB + guardrail)
lambda/blueprint/    Architecture generator (Bedrock Opus, Converse API)
lambda/kb-builder/   Cognito-auth'd Sanity kbEntry CRUD
lambda/kb-sync/      S3-triggered Bedrock KB ingestion
lambda/metrics/      Web Vitals + CSP ingestion to CloudWatch (has GET /health)
lambda/mcp-server/   Public MCP server (ask_alti, blog search)
lambda/session-token/ Turnstile-gated short-lived token issuer
lambda/contact-email/ Resend-backed contact form delivery
lambda/newsletter-subscription/ Resend-backed newsletter subscriptions
scripts/             Build-time generators + deploy/verify tooling
docs/                Internal plans and runbooks
```

**npm workspaces:** The root `package.json` lists all Lambda packages as
workspaces. `npm install` at the root installs all workspace deps and symlinks
`lambda-shared` into each workspace. Lambda deployment uses
`npm ci --no-workspaces --ignore-scripts` to install self-contained deps in each
Lambda directory (see `scripts/deploy-lambda.sh`).

**Turborepo** (`turbo.json`) provides task orchestration and caching across the
workspaces. Each Lambda package exposes a `test` task; `npm run test:lambda:turbo`
(`turbo run test`) runs them in parallel, respecting the `^test` dependency order
(so `lambda-shared` is tested before its dependents) and caching results keyed on
source inputs, so unchanged packages are skipped on re-run. The cache lives in a
gitignored .turbo directory.

## Code conventions

- **TypeScript strict mode** is on for `src/` (`tsconfig.json`); keep it type-clean
  (`noUnusedLocals`/`noUnusedParameters` are enforced). Do not add `@ts-nocheck`.
  Lambda `.mjs` files are type-checked via `lambda/tsconfig.json` (`checkJs` +
  JSDoc annotations); run `npm run tsc:lambda` to verify.
- **Naming conventions** are enforced by `@typescript-eslint/naming-convention`
  in ESLint:
  - **Variables:** `camelCase` (e.g. `const url = ...`), `UPPER_CASE` for
    constants (e.g. `const SITE_ORIGIN = ...`), `PascalCase` for React component
    assignments (e.g. `const MyComponent = () => {}`). `snake_case` is allowed
    only for destructured variables matching external API response keys.
  - **Functions:** `camelCase` for utilities (e.g. `validateInput`), `PascalCase`
    for React components (e.g. `function About() {}`).
  - **Types/Interfaces/Classes:** `PascalCase` (e.g. `SanityPost`, `BlueprintOutput`).
  - **Parameters:** `camelCase` with leading underscore allowed for unused params
    (e.g. `_key`). `PascalCase` allowed for React component params (e.g. `Tag`).
  - **Enum members / Type parameters:** `PascalCase`.
- **Comments:** default to none. Add one only for a non-obvious constraint,
  invariant, or workaround. Code should be self-documenting. No em dashes in prose.
- **Routing is single-source-of-truth:** add/change routes in `src/routes.ts`.
  `src/utils/routeManifest.ts` and `src/utils/pageContext.ts` derive from it and
  a drift test (`src/routes.test.ts`) enforces sync. The chat Lambda mirrors this
  via `lambda/chat-stream/validation.mjs` `VALID_PATHS` (drift test guards it).
- **Typography:** use `src/utils/typography.ts` styles (`typography.heroHeader`,
  etc.). Never add Google Fonts.
- **Navigation:** use `<ViewTransitionLink>` for internal links, not `<Link>`
  (except inside error boundaries).
- **Icons:** Material Icons via CDN (`<span className="material-icons">`); brand
  logos are inline SVG.
- **Syntax highlighting:** import Shiki through the
  `src/utils/shikiHighlighter.ts` singleton, never `import('shiki')` directly.
- **3D / WebGL:** mock `AltiMascot`/Three.js in jsdom tests (no WebGL there).
- **Lambdas** are ESM `.mjs` on AWS SDK v3. Emit structured JSON logs
  (`console.log(JSON.stringify({ requestId, event, ... }))`) and never log PII.
  All logging goes through `lambda/shared/logger.mjs` `createLogger()`, which
  automatically redacts PII (emails, phone-shaped digit runs) and sensitive keys
  (authorization, token, password, secret, signingKey) from every log line via
  the `redact()` function. `lambda/chat-stream/memory.mjs` `sanitizeFactContent`
  enforces PII rejection for stored visitor facts. Error tracking is provided by
  `lambda/shared/errorTracking.mjs`, which integrates Sentry for contextualized
  error capture with request-scoped tags, breadcrumbs, and user context. It is
  opt-in (active only when `SENTRY_DSN` is set) and all functions are no-ops
  otherwise. PII is redacted via the same `redact()` function before being sent
  to Sentry.

- **Frontend structured logging** uses `src/utils/logger.ts` `createLogger()`,
  which mirrors the Lambda logger pattern: scoped loggers with debug/info/warn/
  error levels, automatic PII redaction (same patterns as the Lambda `redact()`),
  and integration with Sentry and RUM breadcrumbs for error context tracing. Use
  `createLogger('ModuleName')` instead of raw `console.*` calls. In development,
  logs are human-readable with scope prefixes; in production, structured JSON is
  emitted to the console and forwarded as breadcrumbs to Sentry/RUM.

- **Distributed tracing** uses `src/utils/traceId.ts` to propagate a UUID v4
  trace ID from the frontend to Lambda services via the `X-Request-Id` header.
  `withTraceId(fetchInit)` wraps any fetch call with the header and sets a RUM
  breadcrumb and Sentry tag so frontend errors can be correlated with CloudWatch
  logs by searching for the same trace ID. All 6 HTTP Lambda handlers read the
  `X-Request-Id` header and use it as the `requestId` in structured logs and
  Sentry context. For `sendBeacon` calls (web vitals), the trace ID is included
  in the request body instead of a header. Use `withTraceId` on every frontend
  API call; use `generateTraceId` directly when headers are not supported.

- **Frontend resilience patterns** are centralized in `src/utils/resilience.ts`:
  `withTimeout` bounds promise wait times (mirrors the Lambda `withTimeout`),
  `withRetry` provides exponential backoff with jitter for transient network
  errors, and `CircuitBreaker` tracks consecutive failures per endpoint and
  fails fast when an external service is down. The session-token manager uses a
  circuit breaker to avoid repeated Turnstile challenges when the issuer Lambda
  is unavailable. Lambda services use `withTimeout` from `lambda-shared/timeout`
  and `AbortController` for SDK calls that accept abort signals.

- **Product analytics** is unified across frontend and backend via PostHog.
  The frontend uses `posthog-js` (consent-gated, `src/utils/posthog.ts`) for
  pageviews and custom events. The Lambda fleet uses `posthog-node`
  (`lambda/shared/productAnalytics.mjs`) to emit server-side product events
  (e.g. "ChatMessageSent", "BlueprintGenerated", "KBSyncTriggered",
  "SessionTokenIssued") at key handler moments. The Lambda module is opt-in
  (active only when `POSTHOG_KEY` is set) and all functions are no-ops
  otherwise. Only anonymous, non-PII properties are sent (outcome, latency,
  tool name). Call `flushProductAnalytics()` in finally blocks alongside
  `flushSentry()` to ensure events ship before the Lambda freezes.
- **Tailwind v4** is CSS-first: theme colors live in the `@theme` block in
  `src/index.css`, not in a standalone Tailwind JS config file.
- **CSP:** when adding an external resource, update the CSP allowlist in
  `amplify.yml` / `customHttp.yml`.

## Log scrubbing

All logging in this repository, both frontend and backend, is sanitized to
prevent PII and sensitive data from reaching logs or error tracking services.

**Lambda services:** `lambda/shared/logger.mjs` `createLogger()` automatically
applies the `redact()` function to every log line before writing to CloudWatch.
The `redact()` function scrubs:

- Email addresses (regex: `[^\s@]+@[^\s@]+\.[^\s@]+`)
- Phone numbers and long digit runs (regex: `(?:\+?\d[\s().-]*){10,}`)
- Sensitive keys (authorization, token, accessToken, secret, password,
  signingKey, sessionTokenKey) — values replaced with `[REDACTED]` regardless
  of content

Additionally, `lambda/chat-stream/memory.mjs` `sanitizeFactContent` rejects
facts containing emails or phone-shaped digit runs before persistence (not just
redaction — full rejection). `lambda/shared/errorTracking.mjs` applies the same
`redact()` function before sending context and breadcrumb data to Sentry.

**Frontend:** `src/utils/logger.ts` `createLogger()` applies the same `redact()`
function (exported from the module) to all `extra` fields before writing to the
browser console. The PII patterns and sensitive keys mirror the Lambda
implementation exactly for consistency. All frontend modules use `createLogger()`
instead of raw `console.*` calls, so no PII reaches the browser console or
Sentry/RUM breadcrumbs without being scrubbed first. The `redact()` function is
also exported for standalone use (e.g., scrubbing data before sending to
analytics or error tracking outside the logger).

## Security

- Never commit secrets. `.env` files (except `.env.example`) are gitignored.
- Frontend `VITE_*` values are public (bundled). Server secrets live only on the
  Lambdas / Amplify env, never in the bundle (e.g. Turnstile secret is server-only).
- Chat requests use short-lived scoped session tokens (Turnstile-gated, issued by
  `lambda/session-token/`, sent as `Authorization: Bearer` via
  `src/utils/sessionToken.ts`) and are rate-limited server-side. Preserve those
  checks when editing `lambda/chat-stream/`.
- **Security scanning layers:** SAST (ESLint, gitleaks secret scanning in CI),
  SCA (npm audit + Dependabot), and DAST (OWASP ZAP baseline scan, weekly via
  `.github/workflows/dast-scan.yml`). The ZAP scan is passive/non-destructive and
  safe to run against production. Findings open a tracked GitHub issue.

## Deployment

- **Frontend:** the foundation stack owns a manually deployed Amplify app and its
  `main` branch. Run `npm run deploy:frontend:personal` to publish the static
  frontend to the default Amplify domain. Do not attach the custom domain or
  change DNS without explicit user direction.
- **Lambdas:** use the personal-account deployer for a normal release. It packages
  every Lambda, uploads immutable artifacts to the foundation bucket, and updates
  the application stack. It reads provider secrets only from ignored
  `infra/personal-account.env`; never commit that file.

```bash
npm run deploy:personal -- --dry-run  # package + validate, no resource or artifact writes
npm run deploy:personal               # asserts qdev-personal / 973662476023, then deploys the stack
npm run deploy:frontend:personal      # builds and deploys to the default Amplify domain, no DNS changes
```

`npm run deploy:lambda -- <name>` remains available for targeted emergency
code updates after the service stack exists; the next full personal deploy
restores the stack-managed artifact version.

## Health checks

Every deployed service has a health check mechanism:

| Service                 | Type        | Endpoint / Method                                     |
| ----------------------- | ----------- | ----------------------------------------------------- |
| Frontend (SPA)          | Static file | `GET /health.json` (served by Amplify from `public/`) |
| chat-stream             | HTTP        | `GET /health` (no auth)                               |
| blueprint               | HTTP        | `GET /health` (no auth)                               |
| kb-builder              | HTTP        | `GET /health` (no auth)                               |
| metrics                 | HTTP        | `GET /health` (Cognito-auth'd, returns 24h snapshot)  |
| mcp-server              | HTTP        | `GET /health` (no auth)                               |
| session-token           | HTTP        | `GET /` (no auth, returns service status)             |
| contact-email           | HTTP        | `GET /` (no auth, returns service status)             |
| newsletter-subscription | HTTP        | `GET /` (no auth, returns service status)             |
| kb-sync                 | Event-based | `{"healthCheck":true}` payload via EventBridge or CLI |

The frontend health check is a static JSON file (`public/health.json`) that
Amplify serves at the `/health.json` path. It provides a liveness probe for
external monitors (Route 53, UptimeRobot).

The kb-sync Lambda has no HTTP endpoint (S3-event-triggered). Its health check
is invoked via `aws lambda invoke --function-name thechrisgrey-kb-sync
--payload '{"healthCheck":true}'` or an EventBridge scheduled rule. The handler
detects the `healthCheck` flag and returns a status response without performing
a KB sync or publishing metrics.

## Releases

Releases are automated via a tag-triggered workflow. To cut a release:

```bash
git tag v1.1.0
git push origin v1.1.0
```

The Release workflow (`.github/workflows/release.yml`) generates a changelog
entry from conventional commits via `scripts/generate-changelog.mjs`, commits
the updated `CHANGELOG.md` back to main, and creates a GitHub Release with
auto-generated notes. GitHub release-notes categorization is configured in
`.github/release.yml`. Preview an unreleased entry locally with
`npm run changelog`.

## Dependency update policy

- **Minimum release age:** dependency updates must target versions published at
  least **7 days** ago. This cooling period mitigates supply chain attacks by
  ensuring new releases have time to be vetted before adoption.
- **Enforcement:** a CI check (`check:dep-age` workflow) runs on all PRs labeled
  `dependencies` and fails if any target version is too new. Run
  `npm run check:dep-age` locally to preview.
- **Dependabot** manages updates across the root and all Lambda workspaces
  (see `.github/dependabot.yml`). Updates are grouped (patch+minor batched,
  majors individual) and arrive weekly.
- **Version consistency** across workspaces is enforced by syncpack
  (`npm run syncpack`), which runs in CI to detect version drift. The config
  (`.syncpackrc.json`) enforces two rules: (1) a shared dependency must resolve
  to a single version across every workspace, and (2) all ranges use a caret
  (`^`), except deliberately exact-pinned packages (e.g. `turbo`). A mismatched
  version or an inconsistent range style (`~`, `>=`, `*`, exact) fails the
  `syncpack lint` gate. Run `npm run syncpack:fix` to auto-align versions and
  ranges.

## Feature flag lifecycle

Feature flags are defined in `src/utils/featureFlags.ts` in the `FLAGS` object.
Each flag has a key, type, description, optional env var, optional PostHog
`remoteKey`, and a default value. See the `add-feature-flag` skill for the full
creation workflow.

**Lifecycle:**

1. **Add**: define the flag in `FLAGS`, add the env var to `.env.example`,
   optionally configure a PostHog remote key for progressive rollout.
2. **Use**: reference via `isFeatureEnabled()`, `getFeatureFlag()`, or
   `useFeatureFlag()` in components and hooks.
3. **Remove**: when a feature is fully launched and the flag is no longer
   needed, remove the flag definition from `FLAGS`, remove all code references,
   remove the env var from `.env.example`, and remove the PostHog flag from the
   dashboard.
4. **Verify**: run `npm run check:feature-flags` to confirm no dead or orphaned
   flags remain. This check runs in CI and fails the build on dead flags.

**Dead flag detection** (`scripts/check-dead-feature-flags.mjs`): scans the
codebase for flag usage and compares against flag definitions. Flags defined
but never referenced outside the definition file and tests are reported as dead.
Flag keys referenced in code but not defined are reported as orphaned. The
check runs in CI as a build gate.

## API contracts

Each deployable service ships an OpenAPI 3.1 spec documenting its input/output
contract, auth, request/response schemas, and status codes:

- `lambda/chat-stream/openapi.yaml` - streaming chat + `/forget` (framed events)
- `lambda/blueprint/openapi.yaml` - NDJSON blueprint generation
- `lambda/kb-builder/openapi.yaml` - Cognito-auth'd kbEntry CRUD + publish
- `lambda/kb-sync/openapi.yaml` - S3 event trigger schema + health check mode
- `lambda/metrics/openapi.yaml` - Web Vitals / CSP ingestion + Cognito health
- `lambda/mcp-server/openapi.yaml` - JSON-RPC 2.0 MCP endpoint + health
- `lambda/session-token/openapi.yaml` - Turnstile-gated token issuer
- `lambda/contact-email/openapi.yaml` - Resend-backed contact form delivery
- `lambda/newsletter-subscription/openapi.yaml` - Resend-backed newsletter subscriptions
- `src/openapi.yaml` - frontend health endpoint + consumed API references

When you change a handler's routes or payloads, update its spec so the contract
stays accurate.

## Where to look next

- `CLAUDE.md`: full architecture, design system, subsystem internals.
- `README.md`: public project overview and AWS infrastructure table.
- `docs/`: implementation plans, runbooks, and cost/logging notes.
- `docs/ideas-to-consider.md`: pending feature ideas.
