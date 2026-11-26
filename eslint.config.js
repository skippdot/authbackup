import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['extension/vendor/**', '_site/**', 'dist/**', 'tests/artifacts/**', 'node_modules/**'] },
  js.configs.recommended,
  // Omitting keys with `({ known, ...rest }) => rest` is a deliberate idiom here.
  { rules: { 'no-unused-vars': ['error', { ignoreRestSiblings: true }] } },
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  // Extension pages, content code and shared modules run in the browser with the chrome.* API.
  {
    files: ['extension/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser, ...globals.webextensions } },
    // A local `t` hides the imported i18n t(): parseAnyOtpText once threw "t is not a function" instead of its error.
    rules: { 'no-shadow': 'error' },
  },
  // MV3 service worker.
  {
    files: ['extension/background.js'],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.webextensions } },
  },
  // Bench page (served by bench/server.py) runs in a normal browser.
  {
    files: ['bench/**/*.js', 'site/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser } },
  },
  // Node tooling that also passes functions to page.evaluate(), which run in the browser (document, chrome.*).
  {
    files: ['tests/e2e.mjs', 'scripts/test-extension.mjs', 'scripts/store-assets.mjs'],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
  },
  // Node tooling: scripts and tests.
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', 'tests/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
  },
];
