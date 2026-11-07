#!/usr/bin/env bash
#
# CloudWatch alarm setup for thechrisgrey Lambda fleet.
#
# Creates metric alarms AND log-based metric filters for ALL services, including
# the three that previously lacked alerting: mcp-server, session-token, kb-builder.
#
# All alarms publish to the existing SNS topic: thechrisgrey-site-alerts.
#
# Usage:
#   ./scripts/setup-alarms.sh                    # create all alarms
#   ./scripts/setup-alarms.sh --dry-run          # print commands without executing
#   ./scripts/setup-alarms.sh --region us-east-1 # override region (default us-east-1)
#
# Prerequisites:
#   - AWS CLI v2 configured with cloudwatch:PutMetricAlarm,
#     logs:PutMetricFilter, logs:DescribeLogGroups permissions
#   - The SNS topic thechrisgrey-site-alerts must exist (created by the
#     infrastructure setup in docs/superpowers/plans/2026-03-23-differentiated-page-experiences.md)
#   - Runs as profile qdev-personal and refuses unless the caller account is
#     Christian Perez - Personal Account 973662476023 (scripts/lib/aws-preflight.sh); the alarms and their SNS
#     action both go to that asserted account

set -euo pipefail

REGION="us-east-1"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --region) REGION="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Pin and assert the account before any AWS call (scripts/lib/aws-preflight.sh).
# A dry run resolves the account from the profile name without calling AWS.
. "$(dirname "$0")/lib/aws-preflight.sh"
if $DRY_RUN; then tcg_aws_resolve; else tcg_aws_preflight; fi

SNS_TOPIC_ARN="arn:aws:sns:${REGION}:${TCG_AWS_ACCOUNT}:thechrisgrey-site-alerts"

# Wrap aws CLI so --dry-run prints instead of executing.
if $DRY_RUN; then
  aws() { echo "  aws $*"; }
fi

echo "=== Setting up CloudWatch alarms (region: ${REGION}) ==="
echo "    SNS topic: ${SNS_TOPIC_ARN}"
echo ""

# ─── Existing alarms (re-created to ensure consistency) ──────────────────────

echo "--- Frontend / Site Metrics ---"

aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-high-cls" \
  --alarm-description "CLS exceeds 0.25 in a 1-hour window" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/SiteMetrics" \
  --metric-name "CLS" \
  --statistic "Average" \
  --period 3600 \
  --evaluation-periods 1 \
  --threshold 0.25 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-csp-violations" \
  --alarm-description "CSP violations exceed 20 in a 1-hour window" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/SiteMetrics" \
  --metric-name "CSPViolation" \
  --statistic "Sum" \
  --period 3600 \
  --evaluation-periods 1 \
  --threshold 20 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

echo ""
echo "--- Chat Stream ---"

aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-kb-failures" \
  --alarm-description "KB retrieval failures exceed 5 in a 1-hour window" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/SiteMetrics" \
  --metric-name "KBRetrievalFailure" \
  --statistic "Sum" \
  --period 3600 \
  --evaluation-periods 1 \
  --threshold 5 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-rate-limit-surge" \
  --alarm-description "Rate limit rejections exceed 50 in a 1-hour window" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/SiteMetrics" \
  --metric-name "RateLimitRejection" \
  --statistic "Sum" \
  --period 3600 \
  --evaluation-periods 1 \
  --threshold 50 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-bedrock-cost" \
  --alarm-description "Bedrock cost exceeds \$25/day (estimated from token metrics)" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/SiteMetrics" \
  --metric-name "BedrockInputTokens" \
  --statistic "Sum" \
  --period 86400 \
  --evaluation-periods 1 \
  --threshold 1500000 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

# Chat-stream agent timeouts — indicates Bedrock or KB is hanging.
aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-chat-agent-timeout" \
  --alarm-description "Chat agent timeouts exceed 5 in a 15-minute window (Bedrock or KB hang)" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/SiteMetrics" \
  --metric-name "AgentTimeout" \
  --statistic "Sum" \
  --period 900 \
  --evaluation-periods 1 \
  --threshold 5 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

# Unhandled handler errors — the catch-all in index.mjs. Anything that reaches
# it is a bug the more specific alarms below did not classify.
aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-chat-unhandled-errors" \
  --alarm-description "Chat handler unhandled errors exceed 5 in a 1-hour window" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/SiteMetrics" \
  --metric-name "UnhandledError" \
  --statistic "Sum" \
  --period 3600 \
  --evaluation-periods 1 \
  --threshold 5 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

# Bedrock throttling — sustained ThrottlingException means the account is at its
# Haiku TPM/RPM ceiling, which reads to a visitor as a chat that just fails.
aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-chat-bedrock-throttled" \
  --alarm-description "Bedrock throttling on chat exceeds 5 in a 1-hour window (account quota ceiling)" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/SiteMetrics" \
  --metric-name "BedrockThrottled" \
  --statistic "Sum" \
  --period 3600 \
  --evaluation-periods 1 \
  --threshold 5 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

# Visitor-memory read failures — DynamoDB is degraded or the table/IAM changed.
# The chat still answers, so nothing else surfaces this: returning visitors
# silently lose their remembered context.
aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-memory-load-failures" \
  --alarm-description "Visitor memory load failures exceed 5 in a 1-hour window (DynamoDB degraded)" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/SiteMetrics" \
  --metric-name "MemoryLoadFailure" \
  --statistic "Sum" \
  --period 3600 \
  --evaluation-periods 1 \
  --threshold 5 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

# POST /forget failures. Threshold 0, not 5: a visitor asked for their data to be
# deleted and it was not. One occurrence is the whole signal.
aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-memory-forget-failures" \
  --alarm-description "A visitor data-deletion request (POST /forget) failed" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/SiteMetrics" \
  --metric-name "ForgetFailure" \
  --statistic "Sum" \
  --period 3600 \
  --evaluation-periods 1 \
  --threshold 0 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

# KB returned zero passages. Bedrock returns the top-K nearest neighbours for any
# query, so "no results at all" is an emptied or broken vector index, not a
# question with no good answer. kb-failures cannot see it: the empty path is in
# neither term of the success/failure ratio.
aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-kb-empty" \
  --alarm-description "KB retrieval returned zero passages more than 5 times in a 1-hour window (emptied or broken index)" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/SiteMetrics" \
  --metric-name "KBRetrievalEmpty" \
  --statistic "Sum" \
  --period 3600 \
  --evaluation-periods 1 \
  --threshold 5 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

# KB returned passages carrying no content.text — a response-shape or ingestion
# regression. Alti falls back to the un-grounded prompt and keeps answering, so
# without this alarm the degradation is invisible.
aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-kb-unparseable" \
  --alarm-description "KB retrieval returned unparseable passages more than 5 times in a 1-hour window" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/SiteMetrics" \
  --metric-name "KBRetrievalUnparseable" \
  --statistic "Sum" \
  --period 3600 \
  --evaluation-periods 1 \
  --threshold 5 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

# Podcast KB retrieval failures (includes timeouts). The podcast KB is a separate
# knowledge base behind the search_podcast tool; no Podcast* metric was watched
# before, so an outage there only showed up as Alti claiming there are no episodes.
aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-podcast-kb-failures" \
  --alarm-description "Podcast KB retrieval failures exceed 5 in a 1-hour window" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/SiteMetrics" \
  --metric-name "PodcastKBRetrievalFailure" \
  --statistic "Sum" \
  --period 3600 \
  --evaluation-periods 1 \
  --threshold 5 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

# Podcast passages that no longer carry videoId/startSeconds — exactly what a
# re-ingest that drops the transcript metadata contract produces.
aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-podcast-kb-unparseable" \
  --alarm-description "Podcast KB returned unparseable passages more than 5 times in a 1-hour window (ingestion metadata drift)" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/SiteMetrics" \
  --metric-name "PodcastKBRetrievalUnparseable" \
  --statistic "Sum" \
  --period 3600 \
  --evaluation-periods 1 \
  --threshold 5 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

# GenUi runs Opus 4.6 from inside chat-stream, so its spend lands in
# TheChrisGrey/SiteMetrics, NOT TheChrisGrey/Blueprint. Same arithmetic as
# thechrisgrey-blueprint-opus-cost: ~$25/day of Opus input tokens.
aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-genui-opus-cost" \
  --alarm-description "GenUi Opus 4.6 spend exceeds \$25/day" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/SiteMetrics" \
  --metric-name "GenUiOpusInputTokens" \
  --statistic "Sum" \
  --period 86400 \
  --evaluation-periods 1 \
  --threshold 1600000 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

# GenUi generation errors — the block set is dropped and the visitor gets plain
# text, so a broken GenUi path degrades silently.
aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-genui-errors" \
  --alarm-description "GenUi generation errors exceed 3 in a 15-minute window" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/SiteMetrics" \
  --metric-name "GenUiError" \
  --statistic "Sum" \
  --period 900 \
  --evaluation-periods 1 \
  --threshold 3 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

# GenUi timeouts — the counterpart to thechrisgrey-blueprint-opus-timeout for the
# Opus call chat-stream makes.
aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-genui-timeout" \
  --alarm-description "GenUi Opus generation timeouts exceed 3 in a 15-minute window" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/SiteMetrics" \
  --metric-name "GenUiTimeout" \
  --statistic "Sum" \
  --period 900 \
  --evaluation-periods 1 \
  --threshold 3 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

echo ""
echo "--- Blueprint ---"

aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-blueprint-opus-cost" \
  --alarm-description "Blueprint Opus 4.6 spend exceeds \$25/day" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/Blueprint" \
  --metric-name "BlueprintOpusInputTokens" \
  --statistic "Sum" \
  --period 86400 \
  --evaluation-periods 1 \
  --threshold 1600000 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-blueprint-errors" \
  --alarm-description "Blueprint handler errors exceed 20% over 15 min" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/Blueprint" \
  --metric-name "BlueprintHandlerError" \
  --statistic "Sum" \
  --period 900 \
  --evaluation-periods 1 \
  --threshold 3 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-blueprint-validation-failures" \
  --alarm-description "Haiku 4.5 rejects >10% of blueprints — prompt/schema drift likely" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/Blueprint" \
  --metric-name "BlueprintValidationFailure" \
  --statistic "Sum" \
  --period 3600 \
  --evaluation-periods 1 \
  --threshold 5 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

# Blueprint Opus timeouts — indicates Bedrock is hanging on generation.
aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-blueprint-opus-timeout" \
  --alarm-description "Blueprint Opus generation timeouts exceed 3 in a 15-minute window" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/Blueprint" \
  --metric-name "BlueprintOpusTimeout" \
  --statistic "Sum" \
  --period 900 \
  --evaluation-periods 1 \
  --threshold 3 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

# Blueprint generation errors — Opus generation failures (not validation, not handler).
aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-blueprint-generation-errors" \
  --alarm-description "Blueprint Opus generation errors exceed 5 in a 1-hour window" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/Blueprint" \
  --metric-name "BlueprintGenerationError" \
  --statistic "Sum" \
  --period 3600 \
  --evaluation-periods 1 \
  --threshold 5 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

echo ""
echo "--- KB Sync ---"

aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-kb-sync-failure" \
  --alarm-description "KB sync (S3 trigger -> Bedrock ingestion) failed" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/SiteMetrics" \
  --metric-name "KBSyncFailure" \
  --statistic "Sum" \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 0 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

# ─── NEW: Metrics Lambda alarm ───────────────────────────────────────────────

echo ""
echo "--- Metrics Lambda (NEW) ---"

# Metrics Lambda handler errors — this Lambda is the telemetry pipeline for the
# frontend (Web Vitals, CSP reports). If it fails, the CLS/CSP alarms go blind
# (treat-missing-data is notBreaching, so they won't fire on the outage).
# A log-based metric filter catches handler_error events from the structured logger.
METRICS_LOG_GROUP="/aws/lambda/thechrisgrey-metrics"

if aws logs describe-log-groups --region "$REGION" --log-group-name-prefix "$METRICS_LOG_GROUP" 2>/dev/null | grep -q "$METRICS_LOG_GROUP"; then
  aws logs put-metric-filter \
    --region "$REGION" \
    --log-group-name "$METRICS_LOG_GROUP" \
    --filter-name "MetricsHandlerErrors" \
    --filter-pattern '{ $.event = "handler_error" }' \
    --metric-transformations "metricName=MetricsHandlerError,metricNamespace=TheChrisGrey/SiteMetrics,metricValue=1"

  aws cloudwatch put-metric-alarm \
    --region "$REGION" \
    --alarm-name "thechrisgrey-metrics-errors" \
    --alarm-description "Metrics Lambda handler errors exceed 5 in a 15-minute window (telemetry pipeline down)" \
    --alarm-actions "$SNS_TOPIC_ARN" \
    --namespace "TheChrisGrey/SiteMetrics" \
    --metric-name "MetricsHandlerError" \
    --statistic "Sum" \
    --period 900 \
    --evaluation-periods 1 \
    --threshold 5 \
    --comparison-operator "GreaterThanThreshold" \
    --treat-missing-data "notBreaching"
else
  echo "  (skipping metrics log filter: log group $METRICS_LOG_GROUP not found)"
fi

# ─── NEW: MCP Server alarms ──────────────────────────────────────────────────

echo ""
echo "--- MCP Server (NEW) ---"

# MCP rate limit rejections — sustained rate limiting indicates abuse or a
# misconfigured client hammering the endpoint.
aws cloudwatch put-metric-alarm \
  --region "$REGION" \
  --alarm-name "thechrisgrey-mcp-ratelimit-surge" \
  --alarm-description "MCP server rate limit rejections exceed 20 in a 1-hour window" \
  --alarm-actions "$SNS_TOPIC_ARN" \
  --namespace "TheChrisGrey/McpServer" \
  --metric-name "McpRateLimitRejection" \
  --statistic "Sum" \
  --period 3600 \
  --evaluation-periods 1 \
  --threshold 20 \
  --comparison-operator "GreaterThanThreshold" \
  --treat-missing-data "notBreaching"

# MCP errors — log-based metric filter catches handler errors that don't have
# a dedicated CloudWatch metric. The mcp-server logs structured JSON with
# level:"error" for any handler or rate-limit error.
MCP_LOG_GROUP="/aws/lambda/thechrisgrey-mcp-server"

# Check if the log group exists before creating the filter.
if aws logs describe-log-groups --region "$REGION" --log-group-name-prefix "$MCP_LOG_GROUP" 2>/dev/null | grep -q "$MCP_LOG_GROUP"; then
  aws logs put-metric-filter \
    --region "$REGION" \
    --log-group-name "$MCP_LOG_GROUP" \
    --filter-name "McpHandlerErrors" \
    --filter-pattern '{ $.level = "error" }' \
    --metric-transformations "metricName=McpHandlerError,metricNamespace=TheChrisGrey/McpServer,metricValue=1"

  aws cloudwatch put-metric-alarm \
    --region "$REGION" \
    --alarm-name "thechrisgrey-mcp-errors" \
    --alarm-description "MCP server handler errors exceed 10 in a 15-minute window" \
    --alarm-actions "$SNS_TOPIC_ARN" \
    --namespace "TheChrisGrey/McpServer" \
    --metric-name "McpHandlerError" \
    --statistic "Sum" \
    --period 900 \
    --evaluation-periods 1 \
    --threshold 10 \
    --comparison-operator "GreaterThanThreshold" \
    --treat-missing-data "notBreaching"
else
  echo "  (skipping MCP log filter: log group $MCP_LOG_GROUP not found)"
fi

# ─── NEW: Session Token alarms ───────────────────────────────────────────────

echo ""
echo "--- Session Token (NEW) ---"

# Session token issuance uses log-based metric filters since the handler does
# not publish CloudWatch metrics directly. The structured logger emits events
# like "turnstile_failed", "issuance_rate_limited", and "tokens_issued".
SESSION_LOG_GROUP="/aws/lambda/thechrisgrey-session-token"

if aws logs describe-log-groups --region "$REGION" --log-group-name-prefix "$SESSION_LOG_GROUP" 2>/dev/null | grep -q "$SESSION_LOG_GROUP"; then
  # Turnstile failures — a spike indicates bot attacks or Turnstile service issues.
  aws logs put-metric-filter \
    --region "$REGION" \
    --log-group-name "$SESSION_LOG_GROUP" \
    --filter-name "SessionTurnstileFailures" \
    --filter-pattern '{ $.event = "turnstile_failed" }' \
    --metric-transformations "metricName=SessionTurnstileFailure,metricNamespace=TheChrisGrey/SessionToken,metricValue=1"

  aws cloudwatch put-metric-alarm \
    --region "$REGION" \
    --alarm-name "thechrisgrey-session-turnstile-failures" \
    --alarm-description "Session token Turnstile failures exceed 30 in a 1-hour window (bot attack or Turnstile outage)" \
    --alarm-actions "$SNS_TOPIC_ARN" \
    --namespace "TheChrisGrey/SessionToken" \
    --metric-name "SessionTurnstileFailure" \
    --statistic "Sum" \
    --period 3600 \
    --evaluation-periods 1 \
    --threshold 30 \
    --comparison-operator "GreaterThanThreshold" \
    --treat-missing-data "notBreaching"

  # Rate limited issuance — sustained rate limiting on token issuance indicates
  # abuse or a client bug causing rapid re-requests.
  aws logs put-metric-filter \
    --region "$REGION" \
    --log-group-name "$SESSION_LOG_GROUP" \
    --filter-name "SessionRateLimited" \
    --filter-pattern '{ $.event = "issuance_rate_limited" }' \
    --metric-transformations "metricName=SessionRateLimited,metricNamespace=TheChrisGrey/SessionToken,metricValue=1"

  aws cloudwatch put-metric-alarm \
    --region "$REGION" \
    --alarm-name "thechrisgrey-session-ratelimit-surge" \
    --alarm-description "Session token issuance rate limiting exceeds 50 in a 1-hour window" \
    --alarm-actions "$SNS_TOPIC_ARN" \
    --namespace "TheChrisGrey/SessionToken" \
    --metric-name "SessionRateLimited" \
    --statistic "Sum" \
    --period 3600 \
    --evaluation-periods 1 \
    --threshold 50 \
    --comparison-operator "GreaterThanThreshold" \
    --treat-missing-data "notBreaching"
else
  echo "  (skipping session-token log filters: log group $SESSION_LOG_GROUP not found)"
fi

# ─── NEW: KB Builder alarms ──────────────────────────────────────────────────

echo ""
echo "--- KB Builder (NEW) ---"

# KB builder handler errors — log-based metric filter catches any handler_error
# event emitted by the structured logger. KB builder failures can leave the
# knowledge base in an inconsistent state.
KB_LOG_GROUP="/aws/lambda/thechrisgrey-kb-builder"

if aws logs describe-log-groups --region "$REGION" --log-group-name-prefix "$KB_LOG_GROUP" 2>/dev/null | grep -q "$KB_LOG_GROUP"; then
  aws logs put-metric-filter \
    --region "$REGION" \
    --log-group-name "$KB_LOG_GROUP" \
    --filter-name "KbBuilderErrors" \
    --filter-pattern '{ $.event = "handler_error" }' \
    --metric-transformations "metricName=KbBuilderError,metricNamespace=TheChrisGrey/KBBuilder,metricValue=1"

  aws cloudwatch put-metric-alarm \
    --region "$REGION" \
    --alarm-name "thechrisgrey-kb-builder-errors" \
    --alarm-description "KB builder handler errors exceed 5 in a 15-minute window" \
    --alarm-actions "$SNS_TOPIC_ARN" \
    --namespace "TheChrisGrey/KBBuilder" \
    --metric-name "KbBuilderError" \
    --statistic "Sum" \
    --period 900 \
    --evaluation-periods 1 \
    --threshold 5 \
    --comparison-operator "GreaterThanThreshold" \
    --treat-missing-data "notBreaching"
else
  echo "  (skipping kb-builder log filter: log group $KB_LOG_GROUP not found)"
fi

echo ""
echo "=== Alarm setup complete ==="
echo ""
echo "Alarms configured (all 8 apps covered):"
echo "  Frontend:     high-cls, csp-violations"
echo "  Chat-stream:  kb-failures, kb-empty, kb-unparseable, rate-limit-surge, bedrock-cost,"
echo "                agent-timeout, chat-unhandled-errors, chat-bedrock-throttled,"
echo "                memory-load-failures, memory-forget-failures (threshold 0),"
echo "                podcast-kb-failures, podcast-kb-unparseable,"
echo "                genui-opus-cost, genui-errors, genui-timeout"
echo "  Blueprint:    opus-cost, errors, validation-failures, opus-timeout, generation-errors"
echo "  KB-builder:   kb-builder-errors (log-based, namespace TheChrisGrey/KBBuilder)"
echo "  KB-sync:      kb-sync-failure"
echo "  Metrics:      metrics-errors (log-based, telemetry pipeline health)"
echo "  MCP-server:   mcp-ratelimit-surge, mcp-errors (log-based)"
echo "  Session-token: session-turnstile-failures (log-based), session-ratelimit-surge (log-based)"
echo ""
echo "To verify all alarms:"
echo "  aws cloudwatch describe-alarms --region $REGION --alarm-name-prefix thechrisgrey- --query 'MetricAlarms[].[AlarmName,StateValue]' --output table"
