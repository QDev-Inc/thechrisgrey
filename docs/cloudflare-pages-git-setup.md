# Cloudflare Pages: Git integration setup

> Historical plan, superseded by the personal-account Amplify deployment.
> Use `docs/personal-account-deployment-status.md` for the current hosting
> target and cutover status. The endpoint values below belong to the retired
> deployment and must not be used for new builds.

Connecting `thechrisgrey.com` to GitHub so every push to `main` deploys automatically.

## Why a new project is required

The Pages project serving the site today (`thechrisgrey`) was created as **Direct Upload**, because that was the only path that needed no browser OAuth during the outage. Cloudflare does not allow converting between the two modes:

> If you choose Direct Upload, you cannot switch to Git integration later. You will have to create a new project with Git integration to use automatic deployments.

So Git integration means a second project, and moving the custom domain onto it. A custom domain can only be attached to one Pages project at a time, which is why the cutover is a discrete step at the end rather than something that can overlap.

The plan below builds and fully verifies the new project on its own `*.pages.dev` URL **before** the domain moves, so the live site is never pointed at something unverified.

## Step 0 — push the pending build changes first

The Cloudflare build will run `npm run build` from the repo. Three uncommitted changes are load-bearing, and the build **fails without them**:

| File                              | Why it matters                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `scripts/generate-cf-headers.mjs` | New. Emits `dist/_headers` and `dist/404.html`. Missing file means the build aborts.                              |
| `package.json`                    | Adds that generator to the end of the `build` chain.                                                              |
| `customHttp.yml`                  | CSP pruned to 1,541 chars. The original 2,104-char version exceeds Cloudflare's 2,000-char `_headers` line limit. |

Nothing else in the working tree needs to ship. `docs/feature-optimization.md`, `.impeccable/`, `PRODUCT.md` and `typescript` are unrelated.

## Step 1 — create the Git-connected project

In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**.

- Authorize the Cloudflare GitHub App against the `thechrisgrey` org
- Grant it access to the `thechrisgrey/thechrisgrey` repository
- Project name: `thechrisgrey-git` (the name `thechrisgrey` is taken by the live project and cannot be reused until that one is deleted)
- Production branch: `main`

This step needs the dashboard — the GitHub App installation is an interactive OAuth grant with no API equivalent.

## Step 2 — build settings

| Setting                | Value           |
| ---------------------- | --------------- |
| Framework preset       | None            |
| Build command          | `npm run build` |
| Build output directory | `dist`          |
| Root directory         | `/`             |

Set `NODE_VERSION` to `22` as an environment variable. The repo pins Node 22 in `.nvmrc`, and Pages honours that file, but setting the variable explicitly removes the ambiguity.

## Step 3 — environment variables

Set these on the **Production** environment. Add them to Preview too if you want PR previews that actually talk to the backend.

### Public values — safe to paste as-is

Every one of these is already compiled into the shipped JavaScript bundle and allowlisted in the CSP. None is a secret.

| Variable                    | Value                                                                   |
| --------------------------- | ----------------------------------------------------------------------- |
| `VITE_CHAT_ENDPOINT`        | `https://mrrpf6f34n7vpkolurdc24c5fu0jruad.lambda-url.us-east-1.on.aws/` |
| `VITE_CONTACT_ENDPOINT`     | `https://vrs4egsi745nep54y6abvwlcwq0smqak.lambda-url.us-east-2.on.aws/` |
| `VITE_NEWSLETTER_ENDPOINT`  | `https://sf5bejshafrb6t7zbbfw5knu7a0axlyp.lambda-url.us-east-2.on.aws/` |
| `VITE_SESSION_ENDPOINT`     | `https://fx6pbx5hkhyrccf6c7pqk6x5fq0idpiv.lambda-url.us-east-1.on.aws`  |
| `VITE_METRICS_ENDPOINT`     | `https://dnsio2ypcuxamxgzjpxr7knwpe0ybbuq.lambda-url.us-east-1.on.aws`  |
| `VITE_KB_BUILDER_ENDPOINT`  | `https://zk46cokyuwgtdtz2ocdlhtjcji0fnidk.lambda-url.us-east-1.on.aws`  |
| `VITE_BLUEPRINT_ENDPOINT`   | `https://b6u7jlyktwv7wtseebhl45lv4y0byxnl.lambda-url.us-east-1.on.aws`  |
| `VITE_COGNITO_USER_POOL_ID` | `us-east-1_9NPz8jCWP`                                                   |
| `VITE_COGNITO_CLIENT_ID`    | `1g8162r8c17o0u4g6oavip8snl`                                            |
| `VITE_RUM_APP_MONITOR_ID`   | `56b9ac44-26a0-40b7-aa4a-49cdd87c82a4`                                  |
| `VITE_RUM_IDENTITY_POOL_ID` | `us-east-1:4cce466e-64a0-42c5-a4a6-15a74e2dd404`                        |
| `VITE_RUM_REGION`           | `us-east-1`                                                             |
| `NODE_VERSION`              | `22`                                                                    |

### Secrets — copy the values yourself

These are not in this document by design. Each value is already on your machine in `thechrisgrey/.env.local`; copy each into the Cloudflare dashboard and mark it **Encrypted**.

| Variable                  | Source                                   | If omitted                                                                                                                                                 |
| ------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SANITY_WRITE_TOKEN`      | `.env.local`                             | **Build fails.** `generate-blog-previews.js` cannot reach Sanity.                                                                                          |
| `VITE_POSTHOG_KEY`        | `.env.local`                             | Analytics silently stop reporting.                                                                                                                         |
| `VITE_POSTHOG_HOST`       | `.env.local`                             | Same.                                                                                                                                                      |
| `VITE_TURNSTILE_SITE_KEY` | `.env.local`                             | The chat widget's bot check cannot render.                                                                                                                 |
| `YOUTUBE_API_KEY`         | Amplify console, or Google Cloud console | Build still succeeds. `generate-podcast-episodes.js` falls back to the committed static episode list, so the podcast page goes stale rather than breaking. |

`VITE_CHAT_SIGNING_KEY` is deliberately **not** on this list. It appears in `scripts/track-build-performance.mjs` and a security test, neither of which runs during `npm run build`.

## Step 4 — verify before cutover

The first build runs automatically once the project is created. When it finishes, check the new project's `*.pages.dev` URL and confirm:

- The twelve public routes plus `/chat` return 200
- `/nope-not-real`, `/admin` and `/blueprint` return **404**, not 200 — a 200 here means `dist/404.html` did not get generated and Pages has fallen back to SPA mode, which would let search engines index unlimited soft-404s
- `content-security-policy` is present on `/` and roughly 1,540 characters. Absent or truncated means the `_headers` line limit was exceeded again
- `access-control-allow-origin` is **absent** — Pages adds it by default and the generator detaches it, because it contradicts `Cross-Origin-Resource-Policy: same-origin`
- A hashed asset under `/assets/` carries `Cache-Control: public, max-age=31536000, immutable`

## Step 5 — move the domain

Once Step 4 is clean, `thechrisgrey.com` and `www.thechrisgrey.com` are removed from the old project and added to the new one. The gap is the time between those two API calls — on the order of seconds, not the 2m51s of the August cutover, because DNS does not change. Both hostnames already point at Cloudflare and stay pointed there.

The `www` → apex 301 redirect rule lives at the **zone** level, not on the Pages project, so it survives this move untouched.

## Rollback

If the new project misbehaves after cutover, move both custom domains back to the `thechrisgrey` project. That project keeps its last good deployment and is not deleted as part of this work.

The AWS Amplify app `d3du8eg39a9peo` in account 205930636302 also remains running and untouched as a deeper fallback, though returning to it would require re-creating its domain association and is a much slower path.

## Known issue, unrelated to this setup

Alti's chat currently returns "Unable to process request" on the live site, with a `TurnstileError` in the browser console. This predates the Git integration work and is not caused by it. It is worth tracking separately — the Turnstile widget is configured per-hostname in Cloudflare, and the site now serves from Pages rather than CloudFront, which is a plausible but **unconfirmed** link.
