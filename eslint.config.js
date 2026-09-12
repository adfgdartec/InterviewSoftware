import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import loopcraft from 'eslint-plugin-loopcraft';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/.next/**', '**/.venv/**',
      '**/coverage/**', '**/*.d.ts',
      // Cloudflare Workers build output and local wrangler state. Generated code, not
      // authored code; flat config does not read .gitignore, so it has to be named here.
      '**/.open-next/**', '**/.wrangler/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { loopcraft },
    rules: {
      // Guardrail 1 / spec §5.1 / acceptance criterion 4.
      'loopcraft/no-affect-inference': 'error',
      // No `any` in packages/* is enforced by tsconfig strictness; this catches the escape hatch.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Build-tool config that MUST be CommonJS. Metro loads metro.config.js with require(),
    // so it cannot be an ES module however much the rest of the repo is one -- these are the
    // tool's rules, not a style choice.
    files: ['**/metro.config.js', '**/babel.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'writable', __dirname: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Repo tooling that runs on Node directly, not through a bundler: scripts/preflight.mjs
    // and any build config beside it. `eslint .` from the root lints these -- which is what
    // CI's lint step runs -- and without Node's globals declared here every `console` and
    // `process` reference in them is a no-undef error. That is exactly what was failing CI:
    // the root `pnpm lint` used to run `turbo run lint`, which only covered two packages and
    // never looked at scripts/ at all, so the failure was invisible locally.
    files: ['scripts/**/*.{js,mjs,cjs}', '**/*.config.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
      },
    },
  },
  {
    // Test files legitimately quote the banned vocabulary in order to assert it is rejected.
    files: ['**/test/**', '**/*.test.ts', '**/*.test.js'],
    rules: { 'loopcraft/no-affect-inference': 'off' },
  },
  {
    // banned-tokens.ts *is* the vocabulary and cannot lint itself clean; this config file
    // and the plugin source both have to name the rule, whose id contains "affect".
    files: [
      'packages/core/src/banned-tokens.ts',
      'tooling/eslint-plugin-loopcraft/src/**',
      'eslint.config.js',
      // The compliance position paper and the calibration card exist to STATE the
      // prohibition. They are the one user-facing surface that must name the vocabulary --
      // "Loopcraft never infers emotion" cannot be written without the word. Both pages are
      // covered instead by a test asserting they only ever use the terms in the negative.
      'apps/web/src/app/compliance/page.tsx',
      'apps/web/src/app/calibration/page.tsx',
    ],
    rules: { 'loopcraft/no-affect-inference': 'off' },
  },
);
