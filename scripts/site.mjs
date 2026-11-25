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
const SITE = 'https://authbackup.com';
const REPO = 'https://github.com/skippdot/authbackup';

/** Site languages: code (BCP 47, also the i18n file name), Open Graph locale, URL path and the name shown in the language list. */
export const LANGS = [
  { code: 'en', og: 'en_US', path: '/', name: 'English' },
  { code: 'es', og: 'es_ES', path: '/es/', name: 'Español' },
  { code: 'pt-BR', og: 'pt_BR', path: '/pt-br/', name: 'Português (Brasil)' },
  { code: 'fr', og: 'fr_FR', path: '/fr/', name: 'Français' },
  { code: 'de', og: 'de_DE', path: '/de/', name: 'Deutsch' },
  { code: 'ja', og: 'ja_JP', path: '/ja/', name: '日本語' },
  { code: 'zh-CN', og: 'zh_CN', path: '/zh-cn/', name: '简体中文' },
  { code: 'id', og: 'id_ID', path: '/id/', name: 'Bahasa Indonesia' },
];

/** JSON for an inline <script>: "<" is escaped so the text can never close the tag. */
const jsonForScript = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Fills {{key}} placeholders; every placeholder must have a value. */
function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`missing placeholder value: ${key}`);
    return vars[key];
  });
}

/** Markdown headings below `level` are shifted down so several documents can sit under one H1; fenced code is left alone. */
function shiftHeadings(md, by) {
  let fenced = false;
  return md.split('\n').map((line) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    return !fenced && /^#{1,5} /.test(line) ? '#'.repeat(by) + line : line;
  }).join('\n');
}

/** One plain-markdown reference for agents, built from README.md and PRIVACY.md so it cannot drift from them. */
function llmsFull(version) {
  const prep = (file) => {
    const md = readFileSync(join(ROOT, file), 'utf8')
      .split('\n').filter((l) => !/^\s*(\[?!\[|<img\b)/.test(l)).join('\n') // badge and image lines
      .replace(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g, `](${REPO}/blob/HEAD/$1)`); // relative links -> absolute
    return shiftHeadings(md, 2).trim();
  };
  return [
    '# AuthBackup: full reference', '',
    `> Complete reference for AuthBackup ${version}, an offline, open-source (MIT) 2FA/TOTP authenticator extension for Chrome. Short version: ${SITE}/llms.txt. Generated at build time from README.md and PRIVACY.md.`, '',
    '## README.md', '', prep('README.md'), '',
    '## PRIVACY.md', '', prep('PRIVACY.md'), '',
  ].join('\n');
}

export function buildSite() {
  rmSync(OUT, { recursive: true, force: true });
  // Templates, translations and markdown are build inputs, not part of the published site.
  const i18nDir = `${sep}site${sep}i18n`;
  cpSync(join(ROOT, 'site'), OUT, {
    recursive: true,
    filter: (src) => !/\.template\.(html|js|md)$|\.md$/.test(src) && !src.includes(i18nDir),
  });
  mkdirSync(join(OUT, 'img'), { recursive: true });
  for (const size of [48, 128]) cpSync(join(ROOT, `extension/icons/${size}.png`), join(OUT, `img/icon-${size}.png`));
  cpSync(join(ROOT, 'docs/store-assets/en-1-scan.png'), join(OUT, 'img/en-1-scan.png'));
  cpSync(join(ROOT, 'docs/store-assets/og-1200x630.png'), join(OUT, 'img/og-1200x630.png'));
  const { version } = JSON.parse(readFileSync(join(ROOT, 'extension/manifest.json'), 'utf8'));

  const home = readFileSync(join(ROOT, 'site/home.template.html'), 'utf8');
  const en = JSON.parse(readFileSync(join(ROOT, 'site/i18n/en.json'), 'utf8'));
  const alternates = [
    ...LANGS.map((l) => `  <link rel="alternate" hreflang="${l.code}" href="https://authbackup.com${l.path}">`),
    '  <link rel="alternate" hreflang="x-default" href="https://authbackup.com/">',
  ].join('\n');
  const all = Object.fromEntries(LANGS.map((l) => [l.code, JSON.parse(readFileSync(join(ROOT, `site/i18n/${l.code}.json`), 'utf8'))]));
  for (const lang of LANGS) {
    const strings = all[lang.code];
    const missing = Object.keys(en).filter((k) => !(k in strings));
    const extra = Object.keys(strings).filter((k) => !(k in en));
    if (missing.length) throw new Error(`site/i18n/${lang.code}.json: missing ${missing.join(', ')}`);
    if (extra.length) throw new Error(`site/i18n/${lang.code}.json: keys not in en.json: ${extra.join(', ')}`);
    const vars = Object.fromEntries(Object.entries(strings).map(([k, v]) => [k, esc(v)]));
    // "[privacy policy]" in offline_p2 becomes the link to the (English) policy page.
    if (!/\[[^\]]+\]/.test(vars.offline_p2)) throw new Error(`site/i18n/${lang.code}.json: offline_p2 needs a [link]`);
    vars.offline_p2 = vars.offline_p2.replace(/\[([^\]]+)\]/, '<a href="/privacy">$1</a>');
    // "[GitHub Releases]" in install_s1 becomes the link to the latest release; chrome://extensions is shown as code.
    if (!/\[[^\]]+\]/.test(vars.install_s1)) throw new Error(`site/i18n/${lang.code}.json: install_s1 needs a [link]`);
    if (!vars.install_s3.includes('chrome://extensions')) throw new Error(`site/i18n/${lang.code}.json: install_s3 must mention chrome://extensions`);
    vars.install_s1 = vars.install_s1.replace(/\[([^\]]+)\]/, `<a href="${REPO}/releases/latest">$1</a>`);
    vars.install_s3 = vars.install_s3.replace('chrome://extensions', '<code>chrome://extensions</code>');
    const ogAlternates = LANGS.filter((l) => l !== lang)
      .map((l) => `  <meta property="og:locale:alternate" content="${l.og}">`).join('\n');
    const jsonld = {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'AuthBackup',
      description: strings.description,
      url: `${SITE}${lang.path}`,
      applicationCategory: 'SecurityApplication',
      operatingSystem: 'Chrome',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      isAccessibleForFree: true,
      license: `${REPO}/blob/HEAD/LICENSE`,
      softwareVersion: version,
      inLanguage: lang.code,
      sameAs: [REPO],
      image: `${SITE}/img/og-1200x630.png`,
      screenshot: `${SITE}/img/en-1-scan.png`,
      author: { '@type': 'Organization', name: 'AuthBackup contributors', url: REPO },
    };
    const langs = LANGS.map((l) => (l === lang
      ? `<a href="${l.path}" lang="${l.code}" aria-current="page">${esc(l.name)}</a>`
      : `<a href="${l.path}" lang="${l.code}" hreflang="${l.code}">${esc(l.name)}</a>`)).join('');
    const page = fill(home, {
      ...vars, lang: lang.code, path: lang.path, alternates, langs, og_locale: lang.og, og_alternates: ogAlternates,
      jsonld: jsonForScript(jsonld),
    });
    mkdirSync(join(OUT, lang.path), { recursive: true });
    writeFileSync(join(OUT, lang.path, 'index.html'), page);
  }

  const body = marked.parse(readFileSync(join(ROOT, 'PRIVACY.md'), 'utf8'));
  const policy = readFileSync(join(ROOT, 'site/privacy.template.html'), 'utf8')
    .replace('{{content}}', `<article lang="en">${body}</article>`);
  writeFileSync(join(OUT, 'privacy.html'), policy);

  // lang.js: language table + banner strings embedded, loaded as an external script (no inline JS on the site).
  const table = LANGS.map((l) => ({
    code: l.code, path: l.path, name: l.name,
    label: all[l.code].lang_banner_label, text: all[l.code].lang_banner_text,
    switchLabel: all[l.code].lang_banner_switch, close: all[l.code].lang_banner_close,
  }));
  writeFileSync(join(OUT, 'lang.js'),
    readFileSync(join(ROOT, 'site/lang.template.js'), 'utf8').replace('/*LANG_DATA*/[]', JSON.stringify(table, null, 2)));

  // crawlers and agents
  const aiBots = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai',
    'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Bytespider', 'Meta-ExternalAgent'];
  writeFileSync(join(OUT, 'robots.txt'), [
    'User-agent: *', 'Allow: /', '',
    ...aiBots.flatMap((b) => [`User-agent: ${b}`, 'Allow: /', '']),
    `Sitemap: ${SITE}/sitemap.xml`, '',
  ].join('\n'));
  const links = LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l.code}" href="${SITE}${l.path}"/>`)
    .concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/"/>`).join('\n');
  writeFileSync(join(OUT, 'sitemap.xml'), [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...LANGS.map((l) => `  <url>\n    <loc>${SITE}${l.path}</loc>\n${links}\n  </url>`),
    `  <url>\n    <loc>${SITE}/privacy</loc>\n  </url>`,
    '</urlset>', '',
  ].join('\n'));
  writeFileSync(join(OUT, 'llms.txt'),
    readFileSync(join(ROOT, 'site/llms.template.md'), 'utf8').replace(/\{\{version\}\}/g, version));
  writeFileSync(join(OUT, 'llms-full.txt'), llmsFull(version));
  writeFileSync(join(OUT, '.nojekyll'), '');
  return OUT;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) console.log(`_site/ ready: ${buildSite()}`);
