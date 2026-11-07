#!/usr/bin/env node

/**
 * Records a deployment event to CloudWatch as a custom metric.
 *
 * This creates a visible marker in the CloudWatch dashboard that correlates
 * deploys with metric changes (error spikes, latency shifts, etc.).
 *
 * Called automatically by scripts/deploy-lambda.sh after a successful Lambda
 * deploy. Can also be run manually for frontend (Amplify) deploys.
 *
 * Usage:
 *   node scripts/mark-deployment.mjs <service-name> [--region us-east-1]
 *   node scripts/mark-deployment.mjs frontend --region us-east-2
 *   node scripts/mark-deployment.mjs chat-stream
 *
 * The metric is written to namespace TheChrisGrey/Deployments with:
 *   MetricName: Deployment
 *   Value: 1
 *   Dimension: Service=<service-name>
 *
 * Requires AWS credentials with cloudwatch:PutMetricData permission.
 * Fails silently (exit 0) if AWS is unavailable — deploy marking is
 * best-effort and must not block a deployment.
 */

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { pinAwsAccount } from './lib/aws-preflight.mjs';

const service = process.argv[2];
const regionArg = process.argv.find((a) => process.argv[process.argv.indexOf(a) - 1] === '--region');
const REGION = regionArg || process.env.AWS_REGION || 'us-east-1';

// Same account pin as scripts/lib/aws-preflight.sh: profile qdev-personal
// (Christian Perez - Personal Account 973662476023), never the ambient AWS_PROFILE. deploy-lambda.sh has
// already asserted the account and exported the profile; this best-effort marker
// does not repeat the STS check, and skips rather than write anywhere else.
const PROFILE = process.env.THECHRISGREY_AWS_PROFILE || 'qdev-personal';
if (PROFILE !== 'qdev-personal') {
  console.warn(`[mark-deployment] THECHRISGREY_AWS_PROFILE='${PROFILE}' is not this repo's home; skipping the marker.`);
  process.exit(0);
}
process.env.AWS_PROFILE = PROFILE;

if (!service) {
  console.error('Usage: node scripts/mark-deployment.mjs <service-name> [--region us-east-1]');
  process.exit(1);
}

const VALID_SERVICES = [
  'frontend',
  'chat-stream',
  'blueprint',
  'kb-builder',
  'kb-sync',
  'metrics',
  'mcp-server',
  'session-token',
  'contact-email',
  'newsletter-subscription',
];

if (!VALID_SERVICES.includes(service)) {
  console.error(`Invalid service: ${service}. Valid: ${VALID_SERVICES.join(', ')}`);
  process.exit(1);
}

try {
  pinAwsAccount();
  const client = new CloudWatchClient({ region: REGION });
  const command = new PutMetricDataCommand({
    Namespace: 'TheChrisGrey/Deployments',
    MetricData: [
      {
        MetricName: 'Deployment',
        Value: 1,
        Unit: 'Count',
        Timestamp: new Date(),
        Dimensions: [
          { Name: 'Service', Value: service },
          { Name: 'Environment', Value: process.env.ENVIRONMENT || 'production' },
        ],
      },
    ],
  });

  await client.send(command);
  console.log(`[mark-deployment] Recorded deploy marker for ${service} in ${REGION}`);
} catch (err) {
  console.warn(`[mark-deployment] Could not record deploy marker: ${err.message}`);
}
