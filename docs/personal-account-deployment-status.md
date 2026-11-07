# Personal-account deployment status

Last verified: 2026-11-07

This is the current deployment handoff for the personal AWS account. It
supersedes neither historical migration records nor their account-specific
facts; in particular, `docs/migration-execution-plan.md` documents an earlier
account migration and must not be used as the state of this deployment.

## Current state

- AWS profile: `qdev-personal`; account: `973662476023`; region: `us-east-1`.
- CloudFormation stacks `thechrisgrey-foundation` and
  `thechrisgrey-services` are `UPDATE_COMPLETE`.
- The foundation stack owns the Amplify app and its `main` branch. The active
  deployment (job 3, including the updated homepage) is available at
  `https://main.d1i0cd2r9ge2of.amplifyapp.com`.
- The service stack deploys nine Lambda services: chat stream, blueprint, KB
  builder, KB sync, metrics, MCP server, session token, contact email, and
  newsletter subscription. Obtain their current Function URLs from the
  `thechrisgrey-services` stack outputs instead of hard-coding them.
- Lambda account concurrency is currently 10. A request to raise the regional
  account quota to 1,001 is pending with AWS (request
  `2fae6c8afcf94fba9d6b69449fbe60012lP54AQe`, submitted 2026-11-07).
- The user authorized the custom-domain cutover on 2026-11-07. The new Amplify
  app now has a domain association for `thechrisgrey.com` and
  `www.thechrisgrey.com`, both mapped to `main`. Its status is
  `PENDING_VERIFICATION`; Cloudflare DNS has not been changed because an
  authenticated Cloudflare session is still needed. The public domain still
  serves the older Cloudflare-hosted deployment.

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

## Verified behavior

- The full production build completed with 31 routes prerendered and no SEO
  violations.
- The staging host returned 200 for `/`, `/about`, `/contact`, `/blog`,
  `/blog/the-imperative`, and `/health.json`.
- Function URL health checks passed for the public services. The metrics health
  endpoint returns 401 without Cognito credentials by design.
- The staging CSP contains the new Function URL origins. CORS preflight checks
  from the staging host passed for chat, contact, newsletter, and session-token
  services.
- Frontend tests passed: 1,956 tests in 141 files (`npm test -- --maxWorkers=4`;
  the initial unrestricted run timed out on one contact-form test). Lambda linting and
  type-checking passed; Lambda tests passed: 685, with five opt-in live tests
  skipped. Lambda coverage was 93.16% lines, 86.50% branches, and 93.56%
  functions.
- An intentionally invalid Turnstile token was rejected by the session-token
  service, proving its server-side verification gate is active. A valid
  browser challenge was not submitted during verification.

## Provider configuration

- Resend is configured for contact and newsletter services. The configured
  sender is `contact@thechrisgrey.com`; no live message was sent as part of
  verification.
- Turnstile protects the session-token, contact, newsletter, and waitlist
  flows. The server secret remains only in ignored local configuration and AWS
  Secrets Manager. Never place it in a `VITE_*` value or commit it.
- Local provider values live in ignored `infra/personal-account.env`; frontend
  values used for a manual deploy live in ignored `.env.local`. Use
  `infra/personal-account.env.example` as the shareable template.

## Remaining user-directed work

1. Add the Amplify staging hostname to the Turnstile allowed-hostnames list if
   protected form flows need to be tested at staging.
2. With permission to send a real message, submit the contact and newsletter
   forms in a browser and confirm delivery.
3. Complete the already-authorized Cloudflare DNS cutover after signing in,
   wait for Amplify certificate activation, and verify the public domain serves
   the same asset bundle as the new app. Inspect and detach any superseded
   hosting association once routing is healthy.

## Operational commands

```bash
npm run deploy:personal -- --dry-run
npm run deploy:personal
npm run deploy:frontend:personal
aws cloudformation describe-stacks --stack-name thechrisgrey-services --profile qdev-personal --region us-east-1
```

The deployment scripts package Lambda artifacts and publish the frontend;
neither command changes the custom-domain association or DNS.
