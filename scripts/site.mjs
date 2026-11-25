// Builds the authbackup.com site into _site/ (published by .github/workflows/pages.yml).
// The landing page is rendered once per language from site/home.template.html + site/i18n/<lang>.json;
// the privacy policy page (English only) is rendered from PRIVACY.md, so the repo, the Chrome Web Store
// listing and the site share one source. Images are the extension icons and a store screenshot.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, '_site');

/** Site languages: code (BCP 47, also the i18n file name), URL path and the name shown in the language list. */
export const LANGS = [
  { code: 'en', path: '/', name: 'English' },
  { code: 'es', path: '/es/', name: 'Español' },
  { code: 'pt-BR', path: '/pt-br/', name: 'Português (Brasil)' },
  { code: 'fr', path: '/fr/', name: 'Français' },
  { code: 'de', path: '/de/', name: 'Deutsch' },
  { code: 'ja', path: '/ja/', name: '日本語' },
  { code: 'zh-CN', path: '/zh-cn/', name: '简体中文' },
  { code: 'id', path: '/id/', name: 'Bahasa Indonesia' },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Fills {{key}} placeholders; every placeholder must have a value. */
function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`missing placeholder value: ${key}`);
    return vars[key];
  });
}

export function buildSite() {
  rmSync(OUT, { recursive: true, force: true });
  // Templates, translations and markdown are build inputs, not part of the published site.
  const i18nDir = `${sep}site${sep}i18n`;
  cpSync(join(ROOT, 'site'), OUT, {
    recursive: true,
    filter: (src) => !/\.template\.html$|\.md$/.test(src) && !src.includes(i18nDir),
  });
  mkdirSync(join(OUT, 'img'), { recursive: true });
  for (const size of [48, 128]) cpSync(join(ROOT, `extension/icons/${size}.png`), join(OUT, `img/icon-${size}.png`));
  cpSync(join(ROOT, 'docs/store-assets/en-1-scan.png'), join(OUT, 'img/en-1-scan.png'));

  const home = readFileSync(join(ROOT, 'site/home.template.html'), 'utf8');
  const en = JSON.parse(readFileSync(join(ROOT, 'site/i18n/en.json'), 'utf8'));
  const alternates = [
    ...LANGS.map((l) => `  <link rel="alternate" hreflang="${l.code}" href="https://authbackup.com${l.path}">`),
    '  <link rel="alternate" hreflang="x-default" href="https://authbackup.com/">',
  ].join('\n');
  for (const lang of LANGS) {
    const strings = JSON.parse(readFileSync(join(ROOT, `site/i18n/${lang.code}.json`), 'utf8'));
    const missing = Object.keys(en).filter((k) => !(k in strings));
    if (missing.length) throw new Error(`site/i18n/${lang.code}.json: missing ${missing.join(', ')}`);
    const vars = Object.fromEntries(Object.entries(strings).map(([k, v]) => [k, esc(v)]));
    // "[privacy policy]" in offline_p2 becomes the link to the (English) policy page.
    if (!/\[[^\]]+\]/.test(vars.offline_p2)) throw new Error(`site/i18n/${lang.code}.json: offline_p2 needs a [link]`);
    vars.offline_p2 = vars.offline_p2.replace(/\[([^\]]+)\]/, '<a href="/privacy">$1</a>');
    const langs = LANGS.map((l) => (l === lang
      ? `<a href="${l.path}" lang="${l.code}" aria-current="page">${esc(l.name)}</a>`
      : `<a href="${l.path}" lang="${l.code}" hreflang="${l.code}">${esc(l.name)}</a>`)).join('');
    const page = fill(home, { ...vars, lang: lang.code, path: lang.path, alternates, langs });
    mkdirSync(join(OUT, lang.path), { recursive: true });
    writeFileSync(join(OUT, lang.path, 'index.html'), page);
  }

  const body = marked.parse(readFileSync(join(ROOT, 'PRIVACY.md'), 'utf8'));
  const policy = readFileSync(join(ROOT, 'site/privacy.template.html'), 'utf8')
    .replace('{{content}}', `<article lang="en">${body}</article>`);
  writeFileSync(join(OUT, 'privacy.html'), policy);
  writeFileSync(join(OUT, '.nojekyll'), '');
  return OUT;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) console.log(`_site/ ready: ${buildSite()}`);
