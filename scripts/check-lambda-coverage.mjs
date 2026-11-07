#!/usr/bin/env node

/**
 * Enforce minimum coverage thresholds for Lambda test suites.
 *
 * Uses Node.js's built-in --experimental-test-coverage flag (no external deps)
 * and parses the coverage report to enforce thresholds. Exits with code 1 if
 * any threshold is not met.
 *
 * Usage:
 *   node scripts/check-lambda-coverage.mjs
 */

import { execSync } from 'child_process';

const THRESHOLDS = {
  lines: 60,
  branches: 50,
  functions: 55,
};

const TEST_FILES = [
  'lambda/shared/__tests__/*.test.mjs',
  'lambda/blueprint/__tests__/*.test.mjs',
  'lambda/chat-stream/__tests__/*.test.mjs',
  'lambda/chat-stream/__tests__/tools/*.test.mjs',
  'lambda/mcp-server/__tests__/*.test.mjs',
  'lambda/metrics/__tests__/*.test.mjs',
  'lambda/kb-builder/__tests__/*.test.mjs',
  'lambda/kb-sync/__tests__/*.test.mjs',
  'lambda/session-token/__tests__/*.test.mjs',
  'lambda/contact-email/__tests__/*.test.mjs',
  'lambda/newsletter-subscription/__tests__/*.test.mjs',
].join(' ');

const CMD = `node --test --experimental-test-coverage --test-reporter=spec ${TEST_FILES} 2>&1`;

console.log('Running Lambda tests with coverage...\n');

let output;
try {
  output = execSync(CMD, {
    encoding: 'utf-8',
    cwd: process.cwd(),
    timeout: 120000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
} catch (err) {
  output = err.stdout || err.stderr || err.message;
}

const lines = output.split('\n');

// Parse the coverage report: look for the "all files" summary line.
// Format: ℹ all files    | 100.00 |    97.37 |  100.00 |
let allFilesLine = null;
for (const line of lines) {
  if (line.includes('all files') && line.includes('|')) {
    allFilesLine = line;
    break;
  }
}

if (!allFilesLine) {
  console.error('Could not find coverage summary in test output.');
  console.error('Make sure Node.js v22+ is available with --experimental-test-coverage.');
  process.exit(1);
}

const parts = allFilesLine.split('|').map((p) => p.trim());
// parts[0] = "ℹ all files", parts[1] = line %, parts[2] = branch %, parts[3] = funcs %
const linePct = parseFloat(parts[1]);
const branchPct = parseFloat(parts[2]);
const funcPct = parseFloat(parts[3]);

console.log('=== Lambda Coverage Report ===');
console.log(`  Lines:     ${linePct.toFixed(2)}%  (threshold: ${THRESHOLDS.lines}%)`);
console.log(`  Branches:  ${branchPct.toFixed(2)}%  (threshold: ${THRESHOLDS.branches}%)`);
console.log(`  Functions: ${funcPct.toFixed(2)}%  (threshold: ${THRESHOLDS.functions}%)`);

const failures = [];
if (linePct < THRESHOLDS.lines) {
  failures.push(`Lines: ${linePct.toFixed(2)}% < ${THRESHOLDS.lines}%`);
}
if (branchPct < THRESHOLDS.branches) {
  failures.push(`Branches: ${branchPct.toFixed(2)}% < ${THRESHOLDS.branches}%`);
}
if (funcPct < THRESHOLDS.functions) {
  failures.push(`Functions: ${funcPct.toFixed(2)}% < ${THRESHOLDS.functions}%`);
}

if (failures.length > 0) {
  console.error('\nCoverage threshold check FAILED:');
  for (const f of failures) {
    console.error(`  - ${f}`);
  }
  process.exit(1);
} else {
  console.log('\nAll coverage thresholds passed.');
}
