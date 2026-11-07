#!/usr/bin/env bash
#
# Post-deploy health check for thechrisgrey.
#
# Verifies that all Lambda services are healthy after a deployment by checking:
#   1. Lambda health endpoints (where available)
#   2. CloudWatch alarm states (all alarms should be OK)
#   3. Recent error rates in CloudWatch Logs
#
# Usage:
#   ./scripts/post-deploy-check.sh                    # check all services
#   ./scripts/post-deploy-check.sh --region us-east-1 # override region
#   ./scripts/post-deploy-check.sh --verbose          # show all alarm details
#
# Exits non-zero if any check fails.
#
# See docs/deployment-observability.md for the full monitoring reference.

set -euo pipefail

REGION="us-east-1"
VERBOSE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --region) REGION="$2"; shift 2 ;;
    --verbose) VERBOSE=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Pin every lookup to the personal account before checking live state.
. "$(dirname "$0")/lib/aws-preflight.sh"
tcg_aws_preflight

PASS=0
FAIL=0
SKIP=0

report_pass() { echo "[PASS] $1"; PASS=$((PASS + 1)); }
report_fail() { echo "[FAIL] $1 — $2"; FAIL=$((FAIL + 1)); }
report_skip() { echo "[SKIP] $1 — $2"; SKIP=$((SKIP + 1)); }

echo "=== Post-Deploy Health Check (region: ${REGION}) ==="
echo ""

# ─── 1. CloudWatch Alarm State ───────────────────────────────────────────────
#
# All thechrisgrey-* alarms should be in OK state after a deploy. Any ALARM
# state indicates an active issue that may have been caused or exposed by the
# deployment.

echo "--- CloudWatch Alarm States ---"

ALARM_STATES=$(aws cloudwatch describe-alarms \
  --region "$REGION" \
  --alarm-name-prefix "thechrisgrey-" \
  --query 'MetricAlarms[].[AlarmName,StateValue]' \
  --output text 2>/dev/null || echo "")

if [[ -z "$ALARM_STATES" ]]; then
  report_skip "CloudWatch alarms" "no thechrisgrey-* alarms found (run scripts/setup-alarms.sh first)"
else
  ALARM_COUNT=0
  ALARM_IN_ALARM=0
  while IFS=$'\t' read -r name state; do
    ALARM_COUNT=$((ALARM_COUNT + 1))
    if [[ "$state" == "ALARM" ]]; then
      ALARM_IN_ALARM=$((ALARM_IN_ALARM + 1))
      report_fail "alarm: $name" "state is ALARM"
    elif "$VERBOSE"; then
      echo "  $name: $state"
    fi
  done <<< "$ALARM_STATES"
  if [[ $ALARM_IN_ALARM -eq 0 ]]; then
    report_pass "All $ALARM_COUNT CloudWatch alarms in OK state"
  fi
fi

echo ""

# ─── 2. Lambda Health Endpoints ──────────────────────────────────────────────
#
# Two Lambdas expose health endpoints:
#   - metrics: GET /health (Cognito-auth'd, checks CloudWatch metric aggregates)
#   - mcp-server: GET /health (public, returns server info)

echo "--- Lambda Health Endpoints ---"

# MCP server health (public, no auth needed). Resolve the current Function URL
# from the service stack, never from a retired-account endpoint.
if [[ -z "${MCP_ENDPOINT:-}" ]]; then
  MCP_ENDPOINT="$(aws cloudformation describe-stacks \
    --region "$REGION" \
    --stack-name thechrisgrey-services \
    --query 'Stacks[0].Outputs[?OutputKey==`McpServerEndpoint`].OutputValue | [0]' \
    --output text 2>/dev/null || true)"
fi

if [[ -z "$MCP_ENDPOINT" || "$MCP_ENDPOINT" == "None" ]]; then
  report_skip "MCP server /health" "thechrisgrey-services is not deployed or MCP_ENDPOINT is unset"
else
  MCP_HEALTH_URL="${MCP_ENDPOINT%/}/health"
  MCP_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 "$MCP_HEALTH_URL" 2>/dev/null || echo "000")
  if [[ "$MCP_RESPONSE" == "200" ]]; then
    MCP_BODY=$(curl -s --connect-timeout 5 --max-time 10 "$MCP_HEALTH_URL" 2>/dev/null || echo "{}")
    MCP_SERVER=$(echo "$MCP_BODY" | grep -o '"server":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
    report_pass "MCP server /health" "200, server=$MCP_SERVER"
  elif [[ "$MCP_RESPONSE" == "000" ]]; then
    report_skip "MCP server /health" "could not connect to $MCP_HEALTH_URL"
  else
    report_fail "MCP server /health" "HTTP $MCP_RESPONSE"
  fi
fi

# Metrics Lambda health (Cognito-auth'd, skip if no token)
if [[ -n "${METRICS_HEALTH_TOKEN:-}" ]] && [[ -n "${METRICS_ENDPOINT:-}" ]]; then
  METRICS_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
    --connect-timeout 5 --max-time 10 \
    -H "Authorization: Bearer $METRICS_HEALTH_TOKEN" \
    "${METRICS_ENDPOINT}/health" 2>/dev/null || echo "000")
  if [[ "$METRICS_RESPONSE" == "200" ]]; then
    report_pass "Metrics /health" "200 (Cognito-auth'd)"
  elif [[ "$METRICS_RESPONSE" == "000" ]]; then
    report_skip "Metrics /health" "could not connect"
  else
    report_fail "Metrics /health" "HTTP $METRICS_RESPONSE"
  fi
else
  report_skip "Metrics /health" "set METRICS_ENDPOINT + METRICS_HEALTH_TOKEN to check"
fi

echo ""

# ─── 3. Frontend Availability ────────────────────────────────────────────────
#
# The Amplify-hosted frontend should be reachable and return 200.

echo "--- Frontend ---"

if [[ -z "${SITE_URL:-}" ]]; then
  report_skip "Frontend" "SITE_URL is unset; the personal-account Amplify app has not been promoted"
else
  SITE_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 "$SITE_URL" 2>/dev/null || echo "000")
  if [[ "$SITE_RESPONSE" == "200" ]]; then
    report_pass "Frontend ($SITE_URL)" "200"
  elif [[ "$SITE_RESPONSE" == "000" ]]; then
    report_fail "Frontend ($SITE_URL)" "could not connect"
  else
    report_fail "Frontend ($SITE_URL)" "HTTP $SITE_RESPONSE"
  fi
fi

echo ""

# ─── 4. Recent Lambda Errors ─────────────────────────────────────────────────
#
# Check the last 15 minutes of CloudWatch Logs for each Lambda for error-level
# entries. A spike in errors after a deploy is the strongest signal of a
# regression.

echo "--- Recent Lambda Error Rates (last 15 min) ---"

LAMBDA_FUNCTIONS=(
  "thechrisgrey-chat-stream"
  "thechrisgrey-blueprint"
  "thechrisgrey-kb-builder"
  "thechrisgrey-kb-sync"
  "thechrisgrey-metrics"
  "thechrisgrey-mcp-server"
  "thechrisgrey-session-token"
  "thechrisgrey-contact-email"
  "thechrisgrey-newsletter-subscription"
)

ERROR_THRESHOLD=5

for fn in "${LAMBDA_FUNCTIONS[@]}"; do
  LOG_GROUP="/aws/lambda/${fn}"

  # Query CloudWatch Logs Insights for error-level entries in the last 15 min.
  QUERY_RESULT=$(aws logs start-query \
    --region "$REGION" \
    --log-group-name "$LOG_GROUP" \
    --start-time "$(($(date +%s) - 900))" \
    --end-time "$(date +%s)" \
    --query-string 'fields @timestamp
| filter level = "error" or event = "handler_error" or event = "kb_sync_failure" or event = "request_error"
| stats count(*) as errorCount
' \
    --query 'queryId' \
    --output text 2>/dev/null || echo "")

  if [[ -z "$QUERY_RESULT" ]]; then
    report_skip "$fn errors" "log group not found or query failed"
    continue
  fi

  # Wait for query to complete (poll up to 5 seconds).
  sleep 2
  ERROR_COUNT=$(aws logs get-query-results \
    --region "$REGION" \
    --query-id "$QUERY_RESULT" \
    --query 'results[0].[0].value' \
    --output text 2>/dev/null || echo "0")

  if [[ "$ERROR_COUNT" == "0" || -z "$ERROR_COUNT" ]]; then
    report_pass "$fn" "0 errors in last 15 min"
  elif [[ "$ERROR_COUNT" -gt $ERROR_THRESHOLD ]]; then
    report_fail "$fn" "$ERROR_COUNT errors in last 15 min (threshold: $ERROR_THRESHOLD)"
  else
    report_pass "$fn" "$ERROR_COUNT errors in last 15 min (under threshold $ERROR_THRESHOLD)"
  fi
done

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo "=== Summary: $PASS passed, $FAIL failed, $SKIP skipped ==="

if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo "FAILED checks — investigate before announcing the deploy is healthy."
  echo "See docs/deployment-observability.md for monitoring references."
  exit 1
fi

echo ""
echo "All checks passed. Deploy appears healthy."
exit 0
