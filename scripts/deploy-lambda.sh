#!/usr/bin/env bash
#
# Build a verified deployment bundle for a Lambda and update its code.
#
# Usage:
#   bash scripts/deploy-lambda.sh <name> [--region us-east-1] [--dry-run]
#   npm run deploy:lambda -- <name> [--region us-east-1] [--dry-run]
#   Deploys as profile qdev-personal and refuses unless the caller account is
#   Christian Perez - Personal Account 973662476023 (scripts/lib/aws-preflight.sh). A --dry-run makes
#   no AWS call.
#
# What it guarantees over the old hand-typed `zip` commands:
#   1. Installs from the committed lockfile (npm ci) when present.
#   2. Dereferences the lambda-shared symlink into a real, fresh copy so the
#      bundle can never ship a stale snapshot (the failure mode that left
#      sanityQueries.mjs out of a deployed chat-stream artifact).
#   3. Verifies the ENTIRE module graph resolves before upload — any missing
#      import aborts the deploy instead of crashing the Lambda on cold start.
#
set -euo pipefail

NAME="${1:?Usage: deploy-lambda.sh <lambda-name> [--region <r>] [--dry-run]}"; shift || true
REGION="us-east-1"; DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --region) REGION="$2"; shift 2;;
    --dry-run) DRY_RUN=1; shift;;
    *) echo "Unknown arg: $1" >&2; exit 1;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/lambda/$NAME"
[ -f "$DIR/index.mjs" ] || { echo "No deployable Lambda at $DIR" >&2; exit 1; }

# Pin and assert the account before any AWS call (scripts/lib/aws-preflight.sh).
. "$ROOT/scripts/lib/aws-preflight.sh"
if [ "$DRY_RUN" -eq 0 ]; then tcg_aws_preflight; fi
cd "$DIR"

echo "==> [$NAME] Installing deps"
# --no-workspaces: install locally in the Lambda dir, not hoisted to root.
# --ignore-scripts: skip root prepare (husky) which is irrelevant for Lambda bundles.
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund --no-workspaces --ignore-scripts
else
  npm install --no-audit --no-fund --no-workspaces --ignore-scripts
fi

if [ -L node_modules/lambda-shared ]; then
  echo "==> [$NAME] Dereferencing lambda-shared (avoids stale snapshot)"
  rm -f node_modules/lambda-shared
  mkdir -p node_modules/lambda-shared
  cp -RL "$ROOT/lambda/shared/." node_modules/lambda-shared/
  # shared's own node_modules (used only for its standalone tests) must never ship —
  # at runtime, shared resolves its deps from this Lambda's node_modules.
  rm -rf node_modules/lambda-shared/node_modules
fi

echo "==> [$NAME] Zipping"
rm -f function.zip
zip -rq function.zip . \
  -x '__tests__/*' -x '__fixtures__/*' -x '*.test.mjs' \
  -x 'function.zip' -x '*.zip' -x 'README.md' \
  -x 'node_modules/lambda-shared/node_modules/*'

echo "==> [$NAME] Verifying isolated deployment package"
node "$ROOT/scripts/verify-lambda-package.mjs" "$DIR/function.zip"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "==> [$NAME] Dry run — built function.zip ($(du -h function.zip | cut -f1)); skipping upload."
  exit 0
fi

echo "==> [$NAME] Deploying thechrisgrey-$NAME ($REGION)"
# --query narrows the response to deploy-relevant fields. Without it the CLI
# prints the ENTIRE function configuration - including Environment.Variables,
# which for these functions holds signing keys and API secrets - into the
# terminal, CI logs, and any transcript capturing the deploy. That exact leak
# forced a SESSION_TOKEN_KEY rotation on 2026-09-06.
aws lambda update-function-code \
  --function-name "thechrisgrey-$NAME" \
  --zip-file "fileb://function.zip" \
  --region "$REGION" \
  --query '{FunctionName:FunctionName,CodeSha256:CodeSha256,LastModified:LastModified,State:State,LastUpdateStatus:LastUpdateStatus}' \
  --output table

# Record a deployment marker in CloudWatch so deploys are visible in the
# thechrisgrey dashboard (correlates deploys with metric changes).
# Best-effort: failures are logged but do not block the deploy.
node "$ROOT/scripts/mark-deployment.mjs" "$NAME" --region "$REGION" 2>/dev/null || true

echo "==> [$NAME] Done."
