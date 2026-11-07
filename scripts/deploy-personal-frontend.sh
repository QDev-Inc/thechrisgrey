#!/usr/bin/env bash
#
# Build and manually deploy the static site to the personal-account Amplify app.
# The app and its main branch are managed by personal-account-foundation.yaml.
# This deploys only to Amplify's default domain; it never creates a custom-domain
# association or changes DNS.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_PATH="${THECHRISGREY_FRONTEND_CONFIG:-$ROOT/.env.local}"
REGION="us-east-1"

require_node_22() {
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" != "22" ]; then
    echo "Node 22 is required (found $(node --version)). Run 'nvm use 22' and retry." >&2
    exit 1
  fi
}

require_config() {
  if [ ! -f "$CONFIG_PATH" ]; then
    echo "Missing frontend configuration: $CONFIG_PATH" >&2
    echo "Copy .env.example to .env.local, populate the public endpoint values, and retry." >&2
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  . "$CONFIG_PATH"
  set +a

  local name
  for name in \
    VITE_NEWSLETTER_ENDPOINT VITE_CONTACT_ENDPOINT VITE_CHAT_ENDPOINT \
    VITE_COGNITO_USER_POOL_ID VITE_COGNITO_CLIENT_ID VITE_KB_BUILDER_ENDPOINT \
    VITE_METRICS_ENDPOINT VITE_SESSION_ENDPOINT VITE_TURNSTILE_SITE_KEY
  do
    if [ -z "${!name:-}" ]; then
      echo "Missing required value in $CONFIG_PATH: $name" >&2
      exit 1
    fi
  done
}

source "$ROOT/scripts/lib/aws-preflight.sh"
require_node_22
tcg_aws_preflight
require_config

APP_ID="$(aws cloudformation describe-stacks \
  --region "$REGION" \
  --stack-name thechrisgrey-foundation \
  --query 'Stacks[0].Outputs[?OutputKey==`AmplifyAppId`].OutputValue | [0]' \
  --output text)"
APP_URL="$(aws cloudformation describe-stacks \
  --region "$REGION" \
  --stack-name thechrisgrey-foundation \
  --query 'Stacks[0].Outputs[?OutputKey==`AmplifyMainBranchUrl`].OutputValue | [0]' \
  --output text)"
if [ -z "$APP_ID" ] || [ "$APP_ID" = "None" ] || [ -z "$APP_URL" ] || [ "$APP_URL" = "None" ]; then
  echo "Amplify outputs are missing. Deploy infra/personal-account-foundation.yaml first." >&2
  exit 1
fi

npm run build

# Manual deployments do not run Amplify's Git build pipeline, so apply the
# repository's canonical security-header configuration through the app API.
aws amplify update-app \
  --region "$REGION" \
  --app-id "$APP_ID" \
  --custom-headers "file://$ROOT/customHttp.yml" \
  --query 'app.appId' \
  --output text >/dev/null

ARCHIVE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/thechrisgrey-amplify.XXXXXX")"
ARCHIVE_PATH="$ARCHIVE_DIR/deployment.zip"
trap 'rm -rf "$ARCHIVE_DIR"' EXIT
(
  cd "$ROOT/dist"
  zip -q -r "$ARCHIVE_PATH" .
)

DEPLOYMENT_JSON="$(aws amplify create-deployment \
  --region "$REGION" \
  --app-id "$APP_ID" \
  --branch-name main \
  --output json)"
JOB_ID="$(printf '%s' "$DEPLOYMENT_JSON" | node -e '
  let raw = "";
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => process.stdout.write(JSON.parse(raw).jobId));
')"
UPLOAD_URL="$(printf '%s' "$DEPLOYMENT_JSON" | node -e '
  let raw = "";
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => process.stdout.write(JSON.parse(raw).zipUploadUrl));
')"

curl --fail --silent --show-error --upload-file "$ARCHIVE_PATH" "$UPLOAD_URL"
aws amplify start-deployment \
  --region "$REGION" \
  --app-id "$APP_ID" \
  --branch-name main \
  --job-id "$JOB_ID" \
  --output text >/dev/null

for attempt in {1..60}; do
  STATUS="$(aws amplify get-job \
    --region "$REGION" \
    --app-id "$APP_ID" \
    --branch-name main \
    --job-id "$JOB_ID" \
    --query 'job.summary.status' \
    --output text)"
  case "$STATUS" in
    SUCCEED)
      echo "Frontend deployed successfully: $APP_URL"
      exit 0
      ;;
    FAILED|CANCELLED)
      echo "Amplify deployment $JOB_ID ended with status: $STATUS" >&2
      exit 1
      ;;
    *)
      echo "Amplify deployment $JOB_ID: $STATUS"
      sleep 5
      ;;
  esac
done

echo "Timed out waiting for Amplify deployment $JOB_ID. Check the Amplify console." >&2
exit 1
