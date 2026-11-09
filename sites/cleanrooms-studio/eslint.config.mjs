import js from '@eslint/js';
import globals from 'globals';

// Check authored runtime code. Generated bundles, fixtures and deployment
// intermediates have their own tests/build and must not mask source errors.
export default [
  { ignores: ['node_modules/**', 'dist/**', '.next/**', '.vinext/**', '.wrangler/**', '.sites-runtime/**', 'outputs/**', 'work/**', 'site/**', 'examples/**', 'src/*.bundle.js'] },
  {
    files: ['src/**/*.js', 'lib/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser, ...globals.node, ...globals.worker, Tweak: 'readonly' } },
    rules: {
      ...js.configs.recommended.rules,
      // Existing callback APIs intentionally expose unused positional args.
      'no-unused-vars': 'off',
      // Domain validators deliberately reject ASCII control characters.
      'no-control-regex': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
