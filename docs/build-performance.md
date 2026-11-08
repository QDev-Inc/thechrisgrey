# Build performance tracking

The production build pipeline (`npm run build`) is measured, compared, and
budgeted so build-time regressions surface in CI instead of quietly
accumulating.

## How it works

| Piece                                                | Role                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `scripts/track-build-performance.mjs`                | Runs each pipeline step individually, times it, and emits a JSON report.                   |
| `scripts/compare-build-performance.mjs`              | Diffs the current report vs the previous CI run and vs the committed budgets.              |
| `build-performance-budgets.json`                     | Absolute per-step + total time ceilings (committed, deliberate targets).                   |
| `.github/workflows/ci.yml` (`build-performance` job) | Runs the timed build, caches `node_modules/.vite`, uploads the report, writes the summary. |

Local usage:

```bash
npm run build:timed     # run the full pipeline with per-step timings
npm run build:compare   # compare a report against the previous run + budgets
```

The tracker prepends `node_modules/.bin` to `PATH`, so binary steps (`tsc`,
`vite build`) are measured correctly whether launched via `npm run` or directly
as `node scripts/track-build-performance.mjs` (how CI invokes it).

## Caching and optimization

- **Vite persistent cache** (`cacheDir: node_modules/.vite` in `vite.config.ts`)
  is restored in CI via `actions/cache`, keyed on `package-lock.json`.
- **npm dependency cache** via `actions/setup-node` (`cache: 'npm'`).
- **Code splitting** groups (router, vendor, sanity, cognito, three, gsap) are
  configured in `vite.config.ts` to keep chunks lean.

## Budgets

`build-performance-budgets.json` defines absolute ceilings per step and for the
total build. The compare step flags any step (or the total) that exceeds its
budget and exits non-zero, independent of whether a previous-run artifact exists
(artifacts expire after 90 days and are absent on the first run).

Budgets carry deliberate headroom over observed local timings because
network-bound steps (Sanity, YouTube) and the Puppeteer prerender vary run to
run. Raise a budget only when a step's cost grows for a justified reason, and
treat a raise as a conscious decision rather than a rubber stamp.

The `build-performance` CI job is non-blocking (`continue-on-error: true`): it
reports regressions and budget breaches in the run summary without gating
merges, so performance stays visible without becoming a flaky merge blocker.

## Image and initial-load checks

Both production build paths validate the three responsive portrait JPEGs and
the original PNG with `scripts/check-critical-images.mjs`. Keep the PNG
fallback and verify decoded images on Amplify after deployment. Do not replace
these assets with WebP without repeating the hosted checks.

`node scripts/verify-site-browser.mjs <origin> <report-directory>` checks
14 routes at mobile and desktop widths, image responses and decoding, layout
overflow, five navigation breakpoints, and a deliberately failed JPEG request
that must recover to the original PNG. Each fresh homepage load has a 1 MB
transfer ceiling and must not eagerly request Three.js or diagram bundles.

The total JavaScript gzip ceiling is 2,550 KB after the Mermaid 12 security
update added its lazy ELK layout dependency. This does not relax the entry
chunk's 55 KB gzip limit or the homepage's independent initial-transfer check.
The verified Amplify build transferred approximately 395 KB on mobile and
430 KB on desktop before interaction.
