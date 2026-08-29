import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import loopcraft from 'eslint-plugin-loopcraft';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/.next/**', '**/.venv/**',
      '**/coverage/**', '**/*.d.ts',
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
    ],
    rules: { 'loopcraft/no-affect-inference': 'off' },
  },
);
