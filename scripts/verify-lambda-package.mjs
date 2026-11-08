import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const archive = resolve(process.argv[2] || 'function.zip');
const directory = mkdtempSync(join(tmpdir(), 'lambda-package-check-'));
try {
  execFileSync('unzip', ['-q', archive, '-d', directory]);
  // Import outside the repository so workspace-hoisted dependencies cannot hide omissions.
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `globalThis.awslambda = { streamifyResponse: f => f, HttpResponseStream: { from: s => s } };
       await import('./index.mjs');
       console.log('Isolated deployment package imports successfully');
       process.exit(0);`,
    ],
    {
      cwd: directory,
      stdio: 'inherit',
      timeout: 30000,
      env: {
        ...process.env,
        NODE_PATH: '',
        SANITY_WRITE_TOKEN: 'package-import-check',
        SENTRY_DSN: '',
        POSTHOG_KEY: '',
      },
    },
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
