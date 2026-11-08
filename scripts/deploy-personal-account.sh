#!/usr/bin/env bash
#
# Package and deploy the Lambda application layer into Christian Perez - Personal
# Account. The durable data plane is provisioned separately by
# infra/personal-account-foundation.yaml and must exist first.
#
# Usage:
#   cp infra/personal-account.env.example infra/personal-account.env
#   # populate the local secret file, then:
#   bash scripts/deploy-personal-account.sh
#   bash scripts/deploy-personal-account.sh --dry-run
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_PATH="${THECHRISGREY_INFRA_CONFIG:-$ROOT/infra/personal-account.env}"
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

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
    echo "Missing deployment configuration: $CONFIG_PATH" >&2
    echo "Copy infra/personal-account.env.example, populate it locally, and retry." >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  . "$CONFIG_PATH"
  set +a

  local name
  for name in \
    TURNSTILE_SECRET SANITY_WRITE_TOKEN RESEND_API_KEY RESEND_FROM_EMAIL \
    CONTACT_RECIPIENT_EMAIL RESEND_NEWSLETTER_SEGMENT_ID RESEND_BLUEPRINT_SEGMENT_ID
  do
    if [ -z "${!name:-}" ]; then
      echo "Missing required value in $CONFIG_PATH: $name" >&2
      exit 1
    fi
  done
  if [ "$RESEND_NEWSLETTER_SEGMENT_ID" = "$RESEND_BLUEPRINT_SEGMENT_ID" ]; then
    echo "Newsletter and Blueprint must use separate Resend segments." >&2
    exit 1
  fi
  if [ "${AI_PROVIDER:-bedrock}" = "cloudflare" ] && { [ -z "${CLOUDFLARE_AI_GATEWAY_URL:-}" ] || [ -z "${CLOUDFLARE_AI_GATEWAY_KEY:-}" ]; }; then
    echo "Cloudflare inference requires its gateway URL and server-only key." >&2
    exit 1
  fi
}

source "$ROOT/scripts/lib/aws-preflight.sh"
require_node_22
tcg_aws_preflight

aws cloudformation validate-template \
  --region us-east-1 \
  --template-body "file://$ROOT/infra/personal-account-services.yaml" \
  --output text >/dev/null

SERVICES=(
  chat-stream
  blueprint
  kb-builder
  kb-sync
  metrics
  mcp-server
  session-token
  contact-email
  newsletter-subscription
)

for service in "${SERVICES[@]}"; do
  npm run deploy:lambda -- "$service" --dry-run
done

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Personal-account dry run complete. No AWS resource or artifact upload was performed."
  exit 0
fi

require_config
ADMIN_ALLOWLIST="${ADMIN_ALLOWLIST:-$CONTACT_RECIPIENT_EMAIL}"

runtime_secret_name='thechrisgrey/runtime-signing-keys'
if ! aws secretsmanager describe-secret --region us-east-1 --secret-id "$runtime_secret_name" >/dev/null 2>&1; then
  runtime_secret_value="$(printf \
    '{"SESSION_TOKEN_KEY":"%s","CHAT_SIGNING_KEY":"%s","BLUEPRINT_SIGNING_KEY":"%s"}' \
    "$(openssl rand -hex 32)" \
    "$(openssl rand -hex 32)" \
    "$(openssl rand -hex 32)")"
  aws secretsmanager create-secret \
    --region us-east-1 \
    --name "$runtime_secret_name" \
    --secret-string "$runtime_secret_value" >/dev/null
fi
runtime_secret_value="$(aws secretsmanager get-secret-value \
  --region us-east-1 \
  --secret-id "$runtime_secret_name" \
  --query SecretString \
  --output text)"
runtime_secret_field() {
  local field="$1"
  printf '%s' "$runtime_secret_value" | node -e '
    const field = process.argv[1];
    let raw = "";
    process.stdin.on("data", (chunk) => (raw += chunk));
    process.stdin.on("end", () => {
      const value = JSON.parse(raw)[field];
      if (typeof value !== "string" || value.length < 32) process.exit(1);
      process.stdout.write(value);
    });
  ' "$field"
}
if ! SESSION_TOKEN_KEY="$(runtime_secret_field SESSION_TOKEN_KEY)" \
  || ! CHAT_SIGNING_KEY="$(runtime_secret_field CHAT_SIGNING_KEY)" \
  || ! BLUEPRINT_SIGNING_KEY="$(runtime_secret_field BLUEPRINT_SIGNING_KEY)"; then
  echo "Runtime signing secret has an invalid value. Rotate or repair $runtime_secret_name before retrying." >&2
  exit 1
fi

ARTIFACT_BUCKET="$(aws cloudformation describe-stacks \
  --region us-east-1 \
  --stack-name thechrisgrey-foundation \
  --query 'Stacks[0].Outputs[?OutputKey==`ArtifactBucketName`].OutputValue | [0]' \
  --output text)"
if [ -z "$ARTIFACT_BUCKET" ] || [ "$ARTIFACT_BUCKET" = "None" ]; then
  echo "thechrisgrey-foundation is missing ArtifactBucketName. Deploy the foundation stack first." >&2
  exit 1
fi

# The production origin remains the custom domain. When the personal-account
# Amplify app exists, add its default domain as an explicit staging origin so
# the hosted pre-cutover site can exercise the same Function URLs without a DNS
# change. Lambda handlers receive the comma-separated value; Function URL CORS
# splits it into individual origins in the service template.
CORS_ORIGINS="$CORS_ORIGIN"
AMPLIFY_MAIN_BRANCH_URL="$(aws cloudformation describe-stacks \
  --region us-east-1 \
  --stack-name thechrisgrey-foundation \
  --query 'Stacks[0].Outputs[?OutputKey==`AmplifyMainBranchUrl`].OutputValue | [0]' \
  --output text 2>/dev/null || true)"
if [ -n "$AMPLIFY_MAIN_BRANCH_URL" ] && [ "$AMPLIFY_MAIN_BRANCH_URL" != "None" ]; then
  case ",$CORS_ORIGINS," in
    *",$AMPLIFY_MAIN_BRANCH_URL,"*) ;;
    *) CORS_ORIGINS="${CORS_ORIGINS},${AMPLIFY_MAIN_BRANCH_URL}" ;;
  esac
fi

VERSION="$(date -u +%Y%m%dT%H%M%SZ)-$(git -C "$ROOT" rev-parse --short=12 HEAD)"
for service in "${SERVICES[@]}"; do
  aws s3 cp "$ROOT/lambda/$service/function.zip" "s3://$ARTIFACT_BUCKET/$VERSION/$service.zip" --only-show-errors
done

RESEND_SECRET_NAME='thechrisgrey/resend-api'
if aws secretsmanager describe-secret --region us-east-1 --secret-id "$RESEND_SECRET_NAME" >/dev/null 2>&1; then
  aws secretsmanager put-secret-value --region us-east-1 --secret-id "$RESEND_SECRET_NAME" --secret-string "$RESEND_API_KEY" >/dev/null
else
  aws secretsmanager create-secret --region us-east-1 --name "$RESEND_SECRET_NAME" --secret-string "$RESEND_API_KEY" >/dev/null
fi
RESEND_SECRET_ARN="$(aws secretsmanager describe-secret \
  --region us-east-1 \
  --secret-id "$RESEND_SECRET_NAME" \
  --query ARN \
  --output text)"

PARAMETERS=(
  "AiProvider=${AI_PROVIDER:-bedrock}"
  "KnowledgeSource=${KNOWLEDGE_SOURCE:-bedrock}"
  "InferenceGatewayUrl=${CLOUDFLARE_AI_GATEWAY_URL:-}"
  "InferenceGatewayKey=${CLOUDFLARE_AI_GATEWAY_KEY:-}"
  "ArtifactVersion=$VERSION"
  "CorsOrigin=${CORS_ORIGINS}"
  "ChatSigningKey=${CHAT_SIGNING_KEY}"
  "SessionTokenKey=${SESSION_TOKEN_KEY}"
  "BlueprintSigningKey=${BLUEPRINT_SIGNING_KEY}"
  "TurnstileSecret=${TURNSTILE_SECRET}"
  "SanityWriteToken=${SANITY_WRITE_TOKEN}"
  "SanityReadToken=${SANITY_READ_TOKEN:-}"
  "AdminAllowlist=${ADMIN_ALLOWLIST}"
  "ResendSecretArn=$RESEND_SECRET_ARN"
  "ResendFromEmail=${RESEND_FROM_EMAIL}"
  "ContactRecipientEmail=${CONTACT_RECIPIENT_EMAIL}"
  "ResendNewsletterSegmentId=${RESEND_NEWSLETTER_SEGMENT_ID:-}"
  "ResendBlueprintSegmentId=${RESEND_BLUEPRINT_SEGMENT_ID:-}"
)

aws cloudformation deploy \
  --region us-east-1 \
  --stack-name thechrisgrey-services \
  --template-file "$ROOT/infra/personal-account-services.yaml" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides "${PARAMETERS[@]}"

aws cloudformation describe-stacks \
  --region us-east-1 \
  --stack-name thechrisgrey-services \
  --query 'Stacks[0].Outputs' \
  --output table
