// Localization via chrome.i18n: the language comes from the browser UI, texts from _locales/<lang>/messages.json,
// if the language is missing Chrome uses default_locale (en). Substitutions are positional $1…$9, a dollar sign is written $$.
// In Node (library unit tests) there is no chrome: t() returns the key so errors stay distinguishable.
const api = globalThis.chrome?.i18n;

export function t(key, ...subs) {
  const msg = api?.getMessage(key, subs.map(String));
  if (msg) return msg;
  return subs.length ? `${key}: ${subs.join(', ')}` : key;
}

// Language of the chosen translation, not of the browser UI: with a Ukrainian Chrome the texts will be en (there is no uk translation),
// and numbers/dates/page lang must be en, not uk.
export const uiLang = () => (api ? t('langCode') : 'en');

/** Date such as "Nov 25, 2026", in the translation's language. */
export const fmtDate = (iso) => new Date(iso).toLocaleDateString(uiLang(), { day: 'numeric', month: 'short', year: 'numeric' });

// userAgentData gives "macOS", navigator.platform gives "MacIntel": compare case-insensitively.
const platform = globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || '';
const isMac = /mac|iphone|ipad/i.test(platform);
/** Paste shortcut, for hints, so Windows does not show ⌘V. */
export const pasteKeys = () => (isMac ? '⌘V' : 'Ctrl+V');

/**
 * Fills texts into the markup: data-i18n → textContent, data-i18n-title/-placeholder/-aria-label → attribute.
 * data-i18n-args="paste" substitutes the paste shortcut into $1.
 */
export function localize(root = document) {
  const args = (el) => (el.dataset.i18nArgs === 'paste' ? [pasteKeys()] : []);
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n, ...args(el));
  for (const attr of ['title', 'placeholder', 'aria-label']) {
    for (const el of root.querySelectorAll(`[data-i18n-${attr}]`)) el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`)));
  }
  if (root === document) document.documentElement.lang = uiLang();
}
