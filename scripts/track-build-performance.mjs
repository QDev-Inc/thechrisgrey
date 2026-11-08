#!/usr/bin/env node

/**
 * Build performance tracker.
 *
 * Runs each step of the production build pipeline individually, measures
 * execution time, and emits a JSON report. The report is uploaded as a CI
 * artifact so build-step timing can be monitored over time.
 *
 * Usage:
 *   node scripts/track-build-performance.mjs              # run all steps, emit report
 *   node scripts/track-build-performance.mjs --output out.json  # write to file
 *
 * In CI, the report is uploaded via actions/upload-artifact for trend analysis.
 * Locally, the report is printed to stdout for immediate feedback.
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, delimiter } from 'path';

// Steps like `tsc` and `vite build` invoke binaries that live in
// node_modules/.bin. npm adds that directory to PATH for `npm run` scripts, but
// this tracker is invoked directly (`node scripts/...`) in CI, where .bin is
// NOT on PATH — so those steps failed silently. Prepend .bin explicitly so
// every step is measured regardless of how the tracker is launched.
const localBin = join(dirname(dirname(fileURLToPath(import.meta.url))), 'node_modules', '.bin');

const STEPS = [
  { name: 'validate-env', command: 'node scripts/validate-env.js' },
  { name: 'generate-podcast-episodes', command: 'node scripts/generate-podcast-episodes.js' },
  { name: 'lint', command: 'npm run lint' },
  { name: 'tsc', command: 'tsc' },
  { name: 'vite-build', command: 'vite build && node scripts/check-critical-images.mjs' },
  { name: 'generate-og-images', command: 'node scripts/generate-og-images.mjs' },
  { name: 'prerender', command: 'node scripts/prerender.js' },
  { name: 'validate-prerender-seo', command: 'node scripts/validate-prerender-seo.mjs' },
  { name: 'generate-sitemap', command: 'node scripts/generate-sitemap.js' },
  { name: 'generate-rss', command: 'node scripts/generate-rss.js' },
];

const BUILD_ENV = {
  ...process.env,
  PATH: `${localBin}${delimiter}${process.env.PATH ?? ''}`,
  VITE_CONTACT_ENDPOINT: process.env.VITE_CONTACT_ENDPOINT || 'https://placeholder.example.com',
  VITE_NEWSLETTER_ENDPOINT: process.env.VITE_NEWSLETTER_ENDPOINT || 'https://placeholder.example.com',
  VITE_CHAT_ENDPOINT: process.env.VITE_CHAT_ENDPOINT || 'https://placeholder.example.com',
  VITE_CHAT_SIGNING_KEY: process.env.VITE_CHAT_SIGNING_KEY || 'ci-placeholder-key',
  VITE_SESSION_ENDPOINT: process.env.VITE_SESSION_ENDPOINT || 'https://placeholder.example.com',
  VITE_TURNSTILE_SITE_KEY: process.env.VITE_TURNSTILE_SITE_KEY || 'ci-placeholder-turnstile',
  VITE_COGNITO_USER_POOL_ID: process.env.VITE_COGNITO_USER_POOL_ID || 'us-east-1_placeholder',
  VITE_COGNITO_CLIENT_ID: process.env.VITE_COGNITO_CLIENT_ID || 'placeholder',
  VITE_KB_BUILDER_ENDPOINT: process.env.VITE_KB_BUILDER_ENDPOINT || 'https://placeholder.example.com',
  VITE_METRICS_ENDPOINT: process.env.VITE_METRICS_ENDPOINT || 'https://placeholder.example.com',
};

function runStep(step) {
  const start = performance.now();
  try {
    execSync(step.command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: BUILD_ENV,
      timeout: 120000,
    });
    const durationMs = Math.round(performance.now() - start);
    return { ...step, durationMs, success: true };
  } catch (error) {
    const durationMs = Math.round(performance.now() - start);
    return {
      ...step,
      durationMs,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const startTime = new Date().toISOString();
console.log(`Build performance tracking started at ${startTime}\n`);

const results = [];
let totalMs = 0;
let failures = 0;

for (const step of STEPS) {
  process.stdout.write(`  ${step.name.padEnd(30)} ... `);
  const result = runStep(step);
  results.push(result);
  totalMs += result.durationMs;

  if (result.success) {
    console.log(`${formatDuration(result.durationMs).padStart(8)}  OK`);
  } else {
    failures++;
    console.log(`${formatDuration(result.durationMs).padStart(8)}  FAIL`);
    console.error(`    Error: ${result.error?.split('\n')[0] || 'unknown'}`);
  }
}

const endTime = new Date().toISOString();
const report = {
  startTime,
  endTime,
  totalDurationMs: totalMs,
  totalDurationFormatted: formatDuration(totalMs),
  stepCount: STEPS.length,
  successCount: STEPS.length - failures,
  failureCount: failures,
  nodeVersion: process.version,
  steps: results.map(({ name, durationMs, success, error }) => ({ name, durationMs, success, error })),
};

console.log(`\nTotal: ${formatDuration(totalMs)} (${failures} failure${failures === 1 ? '' : 's'})`);

const outputPath = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null;

if (outputPath) {
  writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`Report written to ${outputPath}`);
} else {
  console.log('\n--- JSON Report ---');
  console.log(JSON.stringify(report, null, 2));
}

process.exit(failures > 0 ? 1 : 0);
