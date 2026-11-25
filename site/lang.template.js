// authbackup.com language helper (generated into /lang.js by scripts/site.mjs, which embeds the language table
// and the banner strings). No network, no cookies; the only state is localStorage "authbackup.lang".
// 1. Saved preference + visitor on the root page "/" in another language -> go to the saved language.
// 2. No preference and the browser language differs from the page -> suggest it in a dismissible banner.
// Nothing here redirects first-time visitors, so search engines and new visitors always get the page they asked for.
(function () {
  'use strict';
  var LANGS = /*LANG_DATA*/[];
  var KEY = 'authbackup.lang';
  var byCode = {};
  LANGS.forEach(function (l) { byCode[l.code] = l; });

  function load() { try { return localStorage.getItem(KEY); } catch { return null; } }
  function save(code) { try { localStorage.setItem(KEY, code); } catch { /* private mode: no preference */ } }

  // choosing a language in the footer list is an explicit preference
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.langs a[lang]');
    if (a) save(a.lang);
  });

  var page = document.documentElement.lang;
  var saved = load();
  if (saved && !byCode[saved]) saved = null;

  if (saved) {
    if (location.pathname === '/' && saved !== page) location.replace(byCode[saved].path + location.search + location.hash);
    return;
  }

  /** Maps a BCP 47 tag from navigator.languages to a site language code, or null. */
  function match(tag) {
    var t = String(tag).toLowerCase().replace('_', '-');
    var primary = t.split('-')[0];
    if (primary === 'pt') return 'pt-BR';
    if (primary === 'zh') return /^zh-(tw|hk|mo|hant)/.test(t) ? null : 'zh-CN';
    return byCode[primary] ? primary : null;
  }
  var wanted = null;
  var prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
  for (var i = 0; i < prefs.length && !wanted; i++) wanted = match(prefs[i]);
  if (!wanted || wanted === page || !byCode[page]) return;

  function build() {
    var to = byCode[wanted];
    var here = byCode[page];
    var bar = document.createElement('div');
    bar.className = 'langbar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', to.label);
    bar.lang = to.code;
    var inner = document.createElement('div');
    inner.className = 'wrap inner';
    var text = document.createElement('p');
    text.textContent = to.text;
    function button(cls, label) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = label;
      return b;
    }
    var go = button('go', to.switchLabel);
    var stay = button('stay', here.name);
    stay.lang = here.code;
    var close = button('x', '✕');
    close.setAttribute('aria-label', to.close);
    go.addEventListener('click', function () { save(to.code); location.assign(to.path); });
    function dismiss() { save(page); bar.remove(); }
    stay.addEventListener('click', dismiss);
    close.addEventListener('click', dismiss);
    inner.append(text, go, stay, close);
    bar.append(inner);
    document.body.insertBefore(bar, document.body.firstChild);
  }

  document.addEventListener('DOMContentLoaded', function () {
    build();
  });
})();
