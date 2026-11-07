#!/usr/bin/env node
/**
 * Lambda deployment package size tracker + budget enforcer.
 *
 * The frontend has scripts/track-bundle-size.mjs to guard its Vite bundle.
 * This is the equivalent for the Lambda fleet: it measures each service's
 * deployment package (the production dependency tree + source that gets zipped
 * into function.zip by scripts/deploy-lambda.sh) and checks the unzipped and
 * zipped sizes against per-service budgets in lambda-size-budgets.json.
 *
 * Why this matters: AWS Lambda enforces a 250 MB unzipped / 50 MB zipped
 * deployment package limit. A dependency bump that pushes a service over the
 * limit breaks deploys in production with no warning. This script catches
 * heavy-dependency regressions before they ship, and reports per-service
 * sizes so cost/cold-start bloat is visible.
 *
 * For accurate results, each Lambda is installed self-contained with
 * --no-workspaces (matching scripts/deploy-lambda.sh) and lambda-shared is
 * dereferenced into node_modules. Pass --no-install to measure an already
 * installed tree (e.g. in CI after the "Install Lambda dependencies" step).
 *
 * Usage:
 *   node scripts/track-lambda-size.mjs                    # measure all + budget check
 *   node scripts/track-lambda-size.mjs --lambda session-token
 *   node scripts/track-lambda-size.mjs --no-install        # use existing node_modules
 *   node scripts/track-lambda-size.mjs --output report.json
 *   node scripts/track-lambda-size.mjs --summary           # write $GITHUB_STEP_SUMMARY
 *
 * Exits non-zero when any service exceeds its unzipped or zipped budget.
 */
import { execSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const LAMBDAS = [
  'chat-stream',
  'blueprint',
  'kb-builder',
  'metrics',
  'kb-sync',
  'mcp-server',
  'session-token',
  'contact-email',
  'newsletter-subscription',
];
const DEFAULT_BUDGETS_PATH = join(repoRoot, 'lambda-size-budgets.json');
const MB = 1024 * 1024;
// AWS Lambda deployment package limits (the hard ceilings budgets stay under).
const LAMBDA_UNZIPPED_LIMIT_MB = 250;
const LAMBDA_ZIPPED_LIMIT_MB = 50;

function parseArgs() {
  const args = process.argv.slice(2);
  const valueOf = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : null;
  };
  const only = valueOf('--lambda');
  return {
    only: only ? only.split(',').map((s) => s.trim()) : null,
    noInstall: args.includes('--no-install'),
    output: valueOf('--output'),
    budgets: valueOf('--budgets') ?? DEFAULT_BUDGETS_PATH,
    summary: args.includes('--summary'),
  };
}

function readJson(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function formatMB(bytes) {
  return `${(bytes / MB).toFixed(2)} MB`;
}

/** Sum file sizes under `dir`, skipping excluded dirs/files. */
function treeSize(dir, { excludeDirs = new Set(), excludeFilePatterns = [] } = {}) {
  const walk = (current) => {
    let bytes = 0;
    let files = 0;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return { bytes: 0, files: 0 };
    }
    for (const entry of entries) {
      if (excludeDirs.has(entry.name)) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        const sub = walk(full);
        bytes += sub.bytes;
        files += sub.files;
      } else if (entry.isFile()) {
        if (excludeFilePatterns.some((re) => re.test(entry.name))) continue;
        try {
          bytes += statSync(full).size;
          files += 1;
        } catch {
          // ignore vanishing files
        }
      }
    }
    return { bytes, files };
  };
  return walk(dir);
}

/** Size of node_modules/lambda-shared minus its own nested node_modules. */
function sharedDereferencedSize(lambdaDir) {
  const sharedDir = join(lambdaDir, 'node_modules', 'lambda-shared');
  if (!existsSync(sharedDir)) return { bytes: 0, files: 0 };
  return treeSize(sharedDir, {
    excludeDirs: new Set(['node_modules']),
  });
}

/**
 * Unzipped deployment package size = source files (excluding tests/fixtures) +
 * node_modules (excluding lambda-shared/node_modules). Mirrors deploy-lambda.sh
 * zip excludes.
 */
function measureUnzipped(lambdaDir) {
  const source = treeSize(lambdaDir, {
    excludeDirs: new Set(['__tests__', '__fixtures__', 'node_modules', '.turbo']),
    excludeFilePatterns: [/\.test\.mjs$/, /\.zip$/, /^README\.md$/],
  });
  const nodeModules = treeSize(join(lambdaDir, 'node_modules'), {
    excludeDirs: new Set(['lambda-shared']),
  });
  // node_modules above skipped the lambda-shared dir; add its dereferenced size
  // (minus its own node_modules) back, since shared ships inside the package.
  const shared = sharedDereferencedSize(lambdaDir);
  const bytes = source.bytes + nodeModules.bytes + shared.bytes;
  return { bytes, files: source.files + nodeModules.files + shared.files };
}

/** Build function.zip (same excludes as deploy-lambda.sh) and return its size. */
function measureZipped(lambdaDir) {
  const zipPath = join(lambdaDir, 'function.zip');
  try {
    rmSync(zipPath, { force: true });
    execSync(
      `zip -rq function.zip . -x '__tests__/*' -x '__fixtures__/*' -x '*.test.mjs' -x 'function.zip' -x '*.zip' -x 'README.md' -x 'node_modules/lambda-shared/node_modules/*'`,
      { cwd: lambdaDir, stdio: 'ignore' },
    );
    return existsSync(zipPath) ? statSync(zipPath).size : 0;
  } catch {
    return 0;
  } finally {
    rmSync(zipPath, { force: true });
  }
}

function installProdDeps(lambdaDir) {
  const hasLock = existsSync(join(lambdaDir, 'package-lock.json'));
  const cmd = hasLock
    ? 'npm ci --omit=dev --no-audit --no-fund --no-workspaces --ignore-scripts'
    : 'npm install --omit=dev --no-audit --no-fund --no-workspaces --ignore-scripts';
  execSync(cmd, { cwd: lambdaDir, stdio: 'pipe' });
}

function dereferenceShared(lambdaDir) {
  const sharedLink = join(lambdaDir, 'node_modules', 'lambda-shared');
  if (!existsSync(sharedLink)) return;
  let isSymlink = false;
  try {
    isSymlink = lstatSync(sharedLink).isSymbolicLink();
  } catch {
    // not present or not a link — nothing to dereference
  }
  if (!isSymlink) return;
  rmSync(sharedLink, { force: true, recursive: true });
  const sharedSrc = join(repoRoot, 'lambda', 'shared');
  execSync(
    `mkdir -p node_modules/lambda-shared && cp -RL ${sharedSrc}/. node_modules/lambda-shared/ && rm -rf node_modules/lambda-shared/node_modules`,
    {
      cwd: lambdaDir,
      stdio: 'ignore',
      shell: true,
    },
  );
}

function measureLambda(name, { noInstall }) {
  const lambdaDir = join(repoRoot, 'lambda', name);
  if (!existsSync(join(lambdaDir, 'index.mjs'))) {
    return { name, skipped: true, reason: 'no index.mjs' };
  }
  if (!noInstall) {
    installProdDeps(lambdaDir);
  }
  if (!existsSync(join(lambdaDir, 'node_modules'))) {
    return {
      name,
      skipped: true,
      reason: 'node_modules missing (run with install, or after the CI install step)',
    };
  }
  dereferenceShared(lambdaDir);
  const unzipped = measureUnzipped(lambdaDir);
  const zipped = measureZipped(lambdaDir);
  return {
    name,
    skipped: false,
    unzippedBytes: unzipped.bytes,
    unzippedFiles: unzipped.files,
    zippedBytes: zipped,
  };
}

function main() {
  const args = parseArgs();
  const budgetsRaw = readJson(args.budgets) ?? {};
  // Support both { services: { name: {...} }, default: {...} } and a flat map.
  const budgetMap = budgetsRaw.services ?? budgetsRaw;
  const defaultBudget = budgetsRaw.default ?? {};
  const toMeasure = args.only ?? LAMBDAS;
  const results = toMeasure.map((name) => measureLambda(name, { noInstall: args.noInstall }));

  const rows = results
    .filter((r) => !r.skipped)
    .map((r) => {
      const budget = budgetMap[r.name] ?? defaultBudget ?? {};
      const maxUnzipped = budget.maxUnzippedMB ?? LAMBDA_UNZIPPED_LIMIT_MB;
      const maxZipped = budget.maxZippedMB ?? LAMBDA_ZIPPED_LIMIT_MB;
      const unzippedMB = r.unzippedBytes / MB;
      const zippedMB = r.zippedBytes / MB;
      const overUnzipped = unzippedMB > maxUnzipped;
      const overZipped = zippedMB > maxZipped;
      return {
        ...r,
        unzippedMB,
        zippedMB,
        maxUnzippedMB: maxUnzipped,
        maxZippedMB: maxZipped,
        overBudget: overUnzipped || overZipped,
        overUnzipped,
        overZipped,
      };
    });

  const skipped = results.filter((r) => r.skipped);
  const overBudget = rows.filter((r) => r.overBudget);

  // Console report
  console.log('\nLambda deployment package sizes (production deps):\n');
  console.log('service         unzipped     zipped      budget(unzip/zip)       status');
  console.log('--------------- ------------ ----------- ----------------------- ----------');
  for (const r of rows) {
    const status = r.overBudget ? 'OVER' : 'ok';
    console.log(
      `${r.name.padEnd(16)}${formatMB(r.unzippedBytes).padStart(11)} ${formatMB(r.zippedBytes).padStart(11)} ${(String(r.maxUnzippedMB) + '/' + r.maxZippedMB + ' MB').padStart(23)}  ${status}`,
    );
  }
  for (const r of skipped) {
    console.log(`${r.name.padEnd(16)} skipped (${r.reason})`);
  }

  if (overBudget.length) {
    console.log(`\n${overBudget.length} service(s) over budget:`);
    for (const r of overBudget) {
      const reasons = [];
      if (r.overUnzipped) reasons.push(`unzipped ${r.unzippedMB.toFixed(2)} > ${r.maxUnzippedMB} MB`);
      if (r.overZipped) reasons.push(`zipped ${r.zippedMB.toFixed(2)} > ${r.maxZippedMB} MB`);
      console.log(`  - ${r.name}: ${reasons.join(', ')}`);
    }
  } else {
    console.log('\nAll services within budget.');
  }

  // JSON report
  const report = {
    measuredAt: new Date().toISOString(),
    lambdaLimits: { unzippedMB: LAMBDA_UNZIPPED_LIMIT_MB, zippedMB: LAMBDA_ZIPPED_LIMIT_MB },
    services: rows.map((r) => ({
      name: r.name,
      unzippedMB: Number(r.unzippedMB.toFixed(2)),
      zippedMB: Number(r.zippedMB.toFixed(2)),
      unzippedFiles: r.unzippedFiles,
      maxUnzippedMB: r.maxUnzippedMB,
      maxZippedMB: r.maxZippedMB,
      overBudget: r.overBudget,
    })),
    skipped: skipped.map((r) => ({ name: r.name, reason: r.reason })),
  };
  if (args.output) {
    writeFileSync(args.output, JSON.stringify(report, null, 2) + '\n');
    console.log(`\nReport written to ${relative(repoRoot, args.output)}`);
  }

  if (args.summary && process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      '### Lambda deployment package sizes',
      '',
      '| service | unzipped | zipped | budget (unzip/zip) | status |',
      '| --- | ---: | ---: | --- | --- |',
    ];
    for (const r of rows) {
      lines.push(
        `| ${r.name} | ${r.unzippedMB.toFixed(2)} MB | ${r.zippedMB.toFixed(2)} MB | ${r.maxUnzippedMB}/${r.maxZippedMB} MB | ${r.overBudget ? 'OVER' : 'ok'} |`,
      );
    }
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n', { flag: 'a' });
  }

  process.exitCode = overBudget.length > 0 ? 1 : 0;
}

main();
