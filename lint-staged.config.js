// lint-staged runs only on staged files, making pre-commit fast.
// ESLint --fix auto-fixes lint issues; Prettier --write formats.
// Files already ignored by .prettierignore or eslint.config.js are skipped.

export default {
  'src/**/*.{ts,tsx}': 'eslint --max-warnings 0 --no-warn-ignored --fix',
  'lambda/**/*.mjs': 'eslint --max-warnings 0 --no-warn-ignored --fix',
  'scripts/**/*.{js,mjs}': 'eslint --max-warnings 0 --no-warn-ignored --fix',
  '**/*': 'prettier --write --ignore-unknown',
};
