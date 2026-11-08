# Personal-account deployment status

Last verified: 2026-11-07 (America/Chicago)

This is the current deployment handoff for the personal AWS account. It
supersedes neither historical migration records nor their account-specific
facts; in particular, `docs/migration-execution-plan.md` documents an earlier
account migration and must not be used as the state of this deployment.

## Current state

- AWS profile: `qdev-personal`; account: `973662476023`; region: `us-east-1`.
- CloudFormation stacks `thechrisgrey-foundation` and
  `thechrisgrey-services` are `UPDATE_COMPLETE`.
- The foundation stack owns the Amplify app and its `main` branch. The active
  deployment (job 7, including the reviewed implementation) is available at
  `https://main.d1i0cd2r9ge2of.amplifyapp.com`.
- The service stack deploys nine Lambda services: chat stream, blueprint, KB
  builder, KB sync, metrics, MCP server, session token, contact email, and
  newsletter subscription. Obtain their current Function URLs from the
  `thechrisgrey-services` stack outputs instead of hard-coding them.
- Lambda account concurrency is now 1,000, verified with `GetAccountSettings`.
  AWS closed quota request `2fae6c8afcf94fba9d6b69449fbe60012lP54AQe`
  (support case `179407584300853`, submitted 2026-11-07). The requested value
  was 1,001; the applied value is 1,000, up from 10.
- Chat, visual answers, MCP answers, and Blueprint use Mistral Small 3.1 through
  the authenticated `thechrisgrey-inference` Cloudflare Worker. The AWS services
  retain session authentication, rate limits, cost ceilings, and guardrails.
  Published Sanity knowledge entries provide keyword retrieval while Bedrock
  embeddings remain unavailable. This is an explicit configuration choice,
  not an automatic provider switch on each failed request.
- The user authorized the custom-domain cutover on 2026-11-07. The new Amplify
  app now has a domain association for `thechrisgrey.com` and
  `www.thechrisgrey.com`, both mapped to `main`. Its status is
  `PENDING_VERIFICATION` at the previous migration check. The public domain
  still serves the older Cloudflare-hosted deployment. No DNS changes were
  made as part of this implementation; handle that migration separately.

### Pending Cloudflare records

Read and retain the existing apex and `www` records before replacing them.
Add the certificate validation CNAME first, using DNS-only mode:

- Name: `_8c4f01b652b60d2600adadd7b12ee3de.thechrisgrey.com`
- Target: `_1f217f6aeb9fd567ecb8c485f2956b6d.wzccmgtwzk.acm-validations.aws`

Amplify generated `ddw1q9y0onq5g.cloudfront.net` as the routing CNAME target
for both the apex and `www`. Re-read the Amplify domain association before
cutover to confirm these records are still current. Preserve the zone's
`www`-to-apex redirect because the backend CORS configuration allows the apex
origin. Preserve email, provider-validation, and unrelated subdomain records.

## Verified implementation changes

- Admin authentication verifies Cognito JWT signature, issuer, access-token use,
  app client, expiry, subject, and the verified-email allowlist. The pool now
  requires authenticator MFA and permits only admin-created users. The frontend
  supports initial password replacement, authenticator enrollment, and repeat
  MFA challenges.
- Rate-limit window resets are atomic and fail closed for paid services.
  Blueprint binds the token to the device and reserves an allowance before
  generation, commits it only after success, and releases it after failure.
  Global hourly/daily request ceilings bound aggregate AI usage.
- Turnstile validates action and hostname. The staging host is allowed by both
  the widget and the session issuer. MCP uses a separate token scope. Function
  URL CORS is the only response-header layer, and both Sanity projects allow
  the staging origin without credentials.
- Newsletter and Blueprint subscriptions use separate Resend segments. A
  single-use, 24-hour, hashed confirmation token must be explicitly confirmed
  before a contact is activated. Confirmation fragments are removed from the
  address bar, and the confirmation page is noindex.
- Contact drafts use navigation state, optional analytics respect consent,
  recording/autocapture are disabled, and telemetry strips sensitive fields and
  URL query/fragment data. RUM requires an explicit `VITE_ENABLE_RUM=true` opt-in.
- The homepage has a compact responsive grid and direct project/contact paths.
  Navigation remains visible at intermediate widths, keyboard menus restore
  focus, browser Back restores scroll, and the consent banner no longer covers
  the mobile chat composer. Typography, form placement, and page spacing were
  refined. Heavy mascot assets load on interaction.
- The portrait uses responsive JPEGs of 21 KB, 56 KB, and 88 KB, retaining the
  original 1.88 MB PNG fallback. No new WebP conversion was introduced. Existing
  responsive pictures recover to their original image if a modern format fails.
- Deployed Lambda ZIPs are now extracted and imported outside the repository
  before upload. This catches dependencies accidentally resolved from the
  monorepo root. Bedrock roles list the exact Haiku/Opus model ARNs in all three
  regions returned by the configured inference profiles.
- The inference adapter preserves tool calls and results across the Strands
  agent loop. Chat/MCP input and output screening still uses AWS Guardrails;
  Blueprint preserves its dedicated input screening and output schema/quality
  validation. Provider failures do not expose internal details. The Worker
  accepts only its fixed model, limits request/output size, requires a
  server-only bearer secret, and applies an additional rate limit.
- Blueprint reads only published golden examples, without the obsolete Sanity
  read token. Its 100-second Lambda deadline, 110-second browser deadline, and
  120-second quota reservation are checked together so retries have time to
  finish without allowing overlapping generations.
- The existing Blueprint rollout flag remains disabled on the public preview:
  `/blueprint` shows the waitlist. Backend generation checks do not constitute
  a public feature launch.

## Verification results

- Strict production build: 32 prerendered routes, no SEO violations, all image
  decode/size checks passed. Frontend and all nine Lambda package size budgets
  passed.
- Frontend: 1,960 passing tests in 144 files. Lambda: 736 passing tests, five
  opt-in suites skipped. Lambda coverage: 92.79% lines, 86.48% branches, 92.75%
  functions. Formatting, frontend/Lambda lint, TypeScript checks, syncpack, and
  feature-flag checks passed.
- Browser checks on the actual Amplify host passed for 14 routes at 390 px and
  1,440 px, including image decoding/MIME responses and layout overflow.
  Navigation bounds passed at five widths. Deliberately aborting the portrait
  JPEG requests recovered to the original PNG. Keyboard menus, mobile chat
  geometry, and browser Back scroll restoration passed.
- Fresh homepage transfer was approximately 395 KB on mobile and 430 KB on
  desktop. A repeat mobile test with 150 ms network latency, 200 KB/s download,
  and 4x CPU throttling measured LCP at 1.81 s and CLS at 0.0081, compared with
  the earlier 19.68 s LCP baseline. These are local lab measurements, not field
  Core Web Vitals.
- Live Cognito browser verification passed password replacement, MFA setup,
  repeat MFA sign-in, invalid-code rejection, and logout. The shared validator
  accepted a real access token and rejected an ID token and wrong-client
  configuration. The deployed admin API rejected a non-allowlisted user.
  Temporary users were removed and no Cognito email was sent.
- A real browser Turnstile challenge successfully issued session credentials.
  Live MCP blog search succeeded with an MCP token and rejected a chat token.
  Public Function URL health checks passed with one correct CORS origin;
  unauthenticated metrics health returned 401 as expected.
- With the deployed Cloudflare provider, a real Turnstile-backed browser chat
  answered a published-knowledge question, rendered a career-comparison card,
  and completed a blog-search/citation tool cycle. A deployed MCP `ask_alti`
  request correctly retrieved the favorite-color knowledge entry. Direct
  gateway checks rejected unauthenticated access and demonstrated real AWS
  input/output screening, including rejection of harmful input before inference.
- Real DynamoDB contention tests admitted exactly one of 20 requests at a
  one-request window boundary, and exactly one of ten concurrent Blueprint
  reservations. Release allowed retry; commit blocked reuse. All test records
  were removed. The deployed Blueprint API rejected malformed input/device
  mismatch before reserving an allowance; a provider failure released its
  reservation without consuming the allowance or exposing provider details.
- After the deadline fix, the deployed Blueprint API generated a schema-valid
  five-service architecture in 26 seconds and emitted its terminal `complete`
  event. The next request was rejected with 429 after exactly one allowance
  was committed. The temporary quota record was removed. The quality pass
  returned review notes about generic rationales and an incomplete artifact;
  generated scaffolds were not compiled or deployed. Further artifact-quality
  evaluation is needed before enabling the public Blueprint feature.
- Amplify job 7 serves all three portrait JPEG variants and the original PNG
  with HTTP 200 and image MIME types; every downloaded image fully decoded.
  The full mobile/desktop route checks passed on job 6, whose image and layout
  assets are unchanged in job 7 (the last frontend change extends the Blueprint
  request deadline).
- Live subscription confirmation activated a temporary contact only in the
  Blueprint segment. Replayed and expired tokens were rejected. The contact
  and confirmation records were removed. This tested the confirmation/provider
  integration without sending email.
- CloudWatch now receives dimensionless aggregate vital samples; p75 retrieval
  returned data from actual browser checks. Mermaid labels remain visible
  after SVG sanitization, and the AWS topology renders without its previous
  worker/CSP error.

## Provider configuration and remaining blockers

- Resend's existing key now has the required contact-management permissions.
  The sending domain is verified, with click and open tracking disabled.
  Dedicated newsletter and Blueprint segment IDs are stored only in ignored
  provider configuration and the service environment. No live email was sent,
  so inbox delivery remains unverified.
- After explicit user approval, Anthropic first-time-use details were submitted
  in account `973662476023` on 2026-11-07. The stored form was read back and
  checked against every approved field: Christian Perez; https://thechrisgrey.com;
  external users; Software and Technology; "A public website assistant answering
  questions about published work, plus an AWS architecture planning tool".
  The availability API reports Haiku and Opus as authorized and entitled, but
  Haiku agreement availability became `AVAILABLE` on the 2026-11-08 recheck. A real Haiku Converse
  request still fails with `ThrottlingException: Too many tokens per day`.
  The earlier Bedrock-backed deployed chat logged the same provider message as
  a Strands `ModelError`; the browser received a generic error without internal
  details. The active Cloudflare provider avoids that inference dependency.
- AWS reports zero cross-region RPM/TPM quotas for Haiku 4.5 and Opus 4.6, and
  zero on-demand RPM/TPM quotas for Titan Text Embeddings V2. A real KB retrieval
  is throttled. Native podcast vector retrieval still requires those embedding
  quotas; timestamped keyword search now uses the packaged public transcripts.
  Main knowledge retrieval uses published Sanity entries;
  this keyword lookup is not equivalent to the original vector search. The Titan
  quotas are marked non-adjustable in Service Quotas. A Haiku request for
  100,000 TPM, with automatic support-case creation disabled, was rejected:
  the quota API requires a value greater than its published 5,000,000 default,
  despite the applied value being zero. No Bedrock quota request was created.
  AWS Support exposes an Account Activation / Bedrock Allowlisting category;
  case `179410471300991` was submitted with explicit user authorization and
  read back to verify its exact contents. Its latest checked status is `unassigned`.
- Production dependency audits report no high or critical advisories in the
  root or any standalone Lambda package. Five moderate findings remain in the
  root workspace graph: the disabled RUM/uuid chain and the Strands SDK's
  transitive Hono Node adapter. The chat package has the latter moderate
  finding; the other standalone packages have none. Development dependencies
  still have audit findings and were not broadly upgraded in this change.
- Local provider secrets remain in ignored `infra/personal-account.env`;
  public frontend deployment values remain in ignored `.env.local`. Neither
  should be committed. The custom domain and DNS were not changed during this
  implementation.

## Remaining external verification

1. Resolve Bedrock account access and establish nonzero model quotas, then
   verify native podcast vector retrieval. Timestamped keyword search has an
   independent path using the bundled transcripts. Retest native Bedrock inference and
   vector retrieval before switching either provider configuration back.
   The Anthropic use-case form and AWS Support case are already submitted.
2. With explicit permission to send a message, verify contact delivery and the
   newsletter confirmation email through an actual inbox.
3. Handle the previously recorded custom-domain migration separately; re-read
   current Amplify and DNS state before making any routing changes.

### Submitted AWS Support case

Case: `179410471300991`, submitted 2026-11-07 at 20:25 America/Chicago.
Initial status: `unassigned`. Exact correspondence was read back and verified.

Service: Account Activation (`account-management`). Category: Bedrock Allowlisting
(`bedrock-allowlisting`). Severity: general guidance.

Subject: Bedrock account enablement: zero inference quotas in us-east-1

```text
Please review Amazon Bedrock account eligibility and enable nonzero inference
quotas for account 973662476023 in us-east-1.

Organization: Christian Perez
Website: https://thechrisgrey.com
Use case: A public website assistant answering questions about published work,
plus an AWS architecture planning tool. External users; Software and Technology.
The Anthropic first-time-use form was submitted and read back on 2026-11-07.

Observed account quotas:
- Claude Haiku 4.5 cross-region RPM (L-CCA5DF70): 0
- Claude Haiku 4.5 cross-region TPM (L-58BE175A): 0
- Claude Opus 4.6 cross-region RPM (L-11DFF789): 0
- Claude Opus 4.6 cross-region TPM (L-0AD9BBE8): 0
- Titan Text Embeddings V2 on-demand RPM (L-26C560CE): 0, not adjustable
- Titan Text Embeddings V2 on-demand TPM (L-DE641971): 0, not adjustable

A minimal Haiku Converse request returns ThrottlingException: "Too many tokens
per day, please wait before trying again." Knowledge-base retrieval also
throttles. IAM includes the configured inference profiles and their exact
foundation model ARNs in all routed US regions. The model availability API
reports AUTHORIZED / entitlement AVAILABLE, but Anthropic agreement availability
is still NOT_AVAILABLE; Titan availability is AVAILABLE.

The Service Quotas API rejects a request for 100,000 Haiku TPM because it requires
a value greater than the published 5,000,000 default, even though this account's
applied value is zero. No Bedrock quota request was created.

Initial capacity requirements are modest: Haiku 30 RPM / 100,000 TPM, Opus 2 RPM /
50,000 TPM, and Titan embeddings 30 RPM. Application rate limits and global daily
request caps already restrict usage. Please review account enablement, provision
appropriate nonzero capacity and daily allowances, and advise if any further
account verification or model agreement action is required.
```

## Operational commands

### Active inference configuration

The ignored `infra/personal-account.env` currently selects:

```dotenv
AI_PROVIDER=cloudflare
KNOWLEDGE_SOURCE=sanity
CLOUDFLARE_AI_GATEWAY_URL=https://thechrisgrey-inference.deltacentric.workers.dev/v1/chat/completions
```

`CLOUDFLARE_AI_GATEWAY_KEY` is a random 64-character hex secret stored only in
that ignored file, the CloudFormation `NoEcho` parameter/Lambda environments,
and the Worker's `GATEWAY_KEY` secret binding. It must never enter frontend
configuration or committed metadata. The Worker belongs to Cloudflare account
`c9c4e10b030e0df45d3b1876f7fcef05` (Christian Perez - Account).

The Worker source and non-secret bindings are in `workers/inference/`. Its
deployment uses the Cloudflare API's multipart script upload: `index.mjs`, the
checked-in metadata, and a `secret_text` binding named `GATEWAY_KEY` populated
from the ignored server configuration. Enable the Worker's `workers.dev`
subdomain with preview URLs disabled. The normal AWS deployer updates Lambda
configuration and artifacts; it does not upload Worker code. Verify `/health`,
unauthenticated rejection, and a real model/tool/guardrail call after a Worker
update. Keep the Worker secret and the Lambda configuration in sync.

With `KNOWLEDGE_SOURCE=sanity`, chat searches published Sanity biography entries
and the packaged `lambda/chat-stream/podcast-index.json` transcript snapshot.
Podcast search ranks matching words and episode titles and preserves the actual
cue start time in each citation; it does not depend on embedding quotas. It is
keyword retrieval, so paraphrases without shared terms can miss relevant material.
The snapshot covers the nine currently published episodes (659 passages). It
contains only published transcripts and adds about 360 KiB to the Lambda source,
with no frontend bundle increase or new AWS permissions.

When publishing another episode, generate its transcript in `podcast-transcripts/`
and run `node scripts/ingest-podcast-transcripts.mjs --local-only`. Review and
commit the regenerated `lambda/chat-stream/podcast-index.json`, then deploy chat.
The generator refuses to replace the snapshot if any published episode lacks a
valid transcript; the catalog test catches missing episodes. The same run stages
text and metadata sidecars for the native KB. Sync those to the source bucket's
`content/` prefix and start ingestion after AWS enables Titan capacity. Removed
or materially edited episodes need an explicit review of obsolete S3 objects;
the upload scripts no longer delete objects automatically.

Switching back requires setting `AI_PROVIDER=bedrock` and/or
`KNOWLEDGE_SOURCE=bedrock`, redeploying the services, and exercising the real
paths. Do not switch back merely because AWS shows an entitlement: the live
inference and embedding quotas must work first. Responses from the current
provider are buffered before emitting the existing stream events; status
messages remain available while generation runs.

### AWS and frontend release

```bash
npm run deploy:personal -- --dry-run
npm run deploy:personal
npm run deploy:frontend:personal
aws cloudformation describe-stacks --stack-name thechrisgrey-services --profile qdev-personal --region us-east-1
```

The deployment scripts package Lambda artifacts and publish the frontend;
neither command changes the custom-domain association or DNS.

## Podcast search and Bedrock recheck, 2026-11-08

AWS Agent Toolkit MCP was used to read Support, model availability, applied
quotas, CloudWatch, the deployed podcast knowledge base and its data source,
and to test real model invocation, retrieval, and ingestion.

- Support case `179410471300991` remains `unassigned`, with no AWS response.
  The approved follow-up below was sent and read back successfully.
- Haiku agreement availability is now `AVAILABLE`; authorization, entitlement,
  and regional availability also succeed. The six applied Haiku/Opus/Titan
  RPM/TPM quotas remain zero. The quota inventory was capped at 1,000 entries;
  all six relevant codes were present, so this conclusion is limited to those
  six quotas rather than every Bedrock model.
- Haiku Converse with `maxTokens: 16` still returns `ThrottlingException:
Too many tokens per day` after retries. Titan embedding invocation and
  native podcast Retrieve also throttle after retries. CloudWatch's Haiku
  inference-profile metrics for the preceding 24 hours had no successful
  invocation/token samples and six throttle samples before these probes.
- The deployed podcast data source reads `content/`, but all three transcript
  scripts previously targeted the bucket root. They now use the configured
  prefix and avoid deleting unrelated objects. All nine published transcripts
  were staged as 659 text chunks and 659 matching metadata sidecars and
  uploaded to that prefix. No image assets or frontend build were changed.
- A real StartIngestionJob attempt failed before creating a job: the knowledge
  base role's Titan invocation returned HTTP 429 after four SDK attempts.
  Request ID: `d3e7c4ac-f2ed-4eb8-b7b6-2a2682397d1e`. This is provider throttling,
  not evidence of missing IAM permission.

### Deployed podcast search verification

The targeted chat release completed at `2026-11-08T17:14:19Z`. AWS MCP verified
`State=Active`, `LastUpdateStatus=Successful`, `AI_PROVIDER=cloudflare`,
`KNOWLEDGE_SOURCE=sanity`, podcast KB `J3WJKWK5LS`, and that session-token
configuration remains present. The deployed SHA-256 matches the local package:
`S4FHUTO57eWM72AOc6SOWkCQUDVOGukwNmrNL3yWafE=`. The next normal full deployment
will package this source into the CloudFormation-managed artifact release.

- Browser verification used the real Amplify site, session-token issuer, chat
  Lambda, model gateway, and citation cards. A Brittinie Wick query produced
  citations at 1:03, 0:43, and 24:24; clicking 24:24 opened video `ndX9SkIY7Mc`
  with `t=1464s`, and YouTube's actual seek slider showed 1,464 seconds.
- A multi-turn check exposed the model answering a later podcast question
  without retrieval. Explicit podcast searches now require `search_podcast`
  on the first model call and reject a provider response that ignores that
  requirement. Subsequent model calls use normal tool selection. The regression
  test uses the real Strands agent with prior conversation history.
- The deployed follow-up fix returned real Jay Getten passages at 2:34, 1:07,
  and 27:29, with the correct episode title. CloudWatch recorded eight matching
  passages retrieved in 2 ms for request
  `61b36d0d-ff32-4f80-876c-a59f80df6400`. An ordinary biography question still
  answered correctly afterward, and the browser recorded no console errors.
- The health endpoint succeeds. A request without credentials returned the
  expected system rejection frame, without model content. The streaming API
  uses HTTP 200 for this protocol-level rejection, so HTTP status alone must
  not be treated as authentication success.
- Required checks passed: format, frontend lint, Lambda lint and types,
  1,963 frontend/script tests, 748 Lambda tests (five opt-in contract tests
  skipped), and Lambda coverage at 92.82% lines, 86.89% branches, 92.86%
  functions. The isolated deployment package imports successfully and the
  chat package remains within its 120 MiB unzipped / 35 MiB zipped budgets
  (approximately 86.1 MiB / 26.3 MiB).
- AWS MCP enumerated all nine video prefixes without truncation and verified
  1,318 source objects: 659 text files and their 659 metadata sidecars. Native
  ingestion still needs AWS quota approval. No frontend deployment, image
  conversion, custom-domain association, or DNS change was made in this work.

### Submitted Support follow-up

Sent with explicit user approval to existing case `179410471300991` at
`2026-11-08T17:08:53.143Z`; the exact correspondence was read back through
AWS MCP. The case remains `unassigned`.

```text
Following up with fresh diagnostics from 2026-11-08 for account 973662476023,
region us-east-1. The Anthropic use-case form is already submitted. Haiku now
reports agreement AVAILABLE, authorization AUTHORIZED, entitlement AVAILABLE,
and region AVAILABLE, but all six applied Haiku/Opus/Titan RPM/TPM quotas in
the original case remain zero.

A minimal Haiku Converse request with maxTokens=16 fails after retries with
ThrottlingException: Too many tokens per day. Titan Text Embeddings V2
InvokeModel and podcast Knowledge Base Retrieve also throttle after retries.
StartIngestionJob for podcast KB J3WJKWK5LS / source RYB5T3ZCZB fails before
creating a job because the embedding model returns HTTP 429 (SDK Attempt
Count 4), request ID d3e7c4ac-f2ed-4eb8-b7b6-2a2682397d1e. The source now
contains 659 published podcast passages and timestamp metadata under its
configured content/ prefix.

Please review the account-level Bedrock restrictions and enable the initial
capacity requested in this case: Haiku 30 RPM / 100,000 TPM; Opus 2 RPM /
50,000 TPM; Titan embeddings 30 RPM with sufficient token capacity for this
small corpus. Titan quotas are marked non-adjustable and the Haiku quota API
previously rejected 100,000 TPM as below the published 5,000,000 default,
although this account's applied quota is zero. Please confirm whether any
additional account verification or customer action is required.
```
