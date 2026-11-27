// Release build checks (called by both the unit test and scripts/build.mjs). Returns a list of problems; empty means clean.
// Catches what would otherwise surface only for users or in Web Store review:
//   en/ru dictionaries diverged, a key used in code is missing from messages.json, a test hook is left in the code,
//   a page tries to use the network or uses inline styles that CSP blocks.
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXT = fileURLToPath(new URL('../extension', import.meta.url));
export const PERMISSIONS = ['storage', 'activeTab', 'scripting', 'clipboardWrite', 'alarms'];
const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** The public repo is English-only; Cyrillic is allowed only in translation data files. */
export const CYRILLIC_ALLOWED = [
  'extension/_locales/ru/messages.json', 'scripts/locales/ru.json',
  'ios/App/Resources/Localizable.xcstrings', 'ios/App/Resources/InfoPlist.xcstrings',
  'android/app/src/main/res/values-ru/strings.xml',
];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

const placeholders = (msg) => [...new Set(msg.match(/\$\d/g) || [])].sort().join(',');

export function checkRelease() {
  const problems = [];
  const files = walk(EXT).filter((f) => !f.includes('/vendor/') && !f.endsWith('.DS_Store'));
  const src = Object.fromEntries(files.filter((f) => /\.(js|html|json)$/.test(f) && !f.includes('/_locales/'))
    .map((f) => [relative(EXT, f), readFileSync(f, 'utf8')]));
  const code = Object.entries(src).filter(([f]) => /\.(js|html)$/.test(f));

  // --- dictionaries ---
  const locales = readdirSync(join(EXT, '_locales'));
  const dict = Object.fromEntries(locales.map((l) => [l, JSON.parse(readFileSync(join(EXT, '_locales', l, 'messages.json'), 'utf8'))]));
  const base = dict.en;
  if (!base) problems.push('missing _locales/en (default_locale)');
  for (const [lang, d] of Object.entries(dict)) {
    for (const k of Object.keys(base)) {
      if (!d[k]) problems.push(`${lang}: missing key ${k}`);
      else if (placeholders(d[k].message) !== placeholders(base[k].message)) problems.push(`${lang}.${k}: placeholders differ from en`);
    }
    for (const k of Object.keys(d)) if (!base[k]) problems.push(`${lang}: extra key ${k}`);
  }

  // --- keys in code <-> dictionary ---
  const used = new Set();
  for (const [, s] of code) {
    for (const m of s.matchAll(/\bt\(\s*'(\w+)'/g)) used.add(m[1]);
    for (const m of s.matchAll(/\bt\(\s*[^()?]*\?\s*'(\w+)'\s*:\s*'(\w+)'/g)) used.add(m[1]).add(m[2]);
    for (const m of s.matchAll(/data-i18n(?:-[a-z-]+)?="(\w+)"/g)) if (!m[0].startsWith('data-i18n-args')) used.add(m[1]);
    for (const m of s.matchAll(/KEYS = \{([^}]+)\}/g)) for (const k of m[1].matchAll(/'(\w+)'/g)) used.add(k[1]);
  }
  for (const m of src['manifest.json'].matchAll(/__MSG_(\w+)__/g)) used.add(m[1]);
  for (const k of used) if (base && !base[k]) problems.push(`key ${k} is used but missing from messages.json`);
  if (base) for (const k of Object.keys(base)) if (!used.has(k)) problems.push(`key ${k} is not used anywhere`);

  // --- manifest ---
  const m = JSON.parse(src['manifest.json']);
  if (m.default_locale !== 'en') problems.push('default_locale must be en');
  if (m.host_permissions?.length) problems.push(`host_permissions in release: ${m.host_permissions}`);
  if (JSON.stringify(m.permissions) !== JSON.stringify(PERMISSIONS)) problems.push(`permissions changed: ${m.permissions}`);
  if (!/connect-src 'none'/.test(m.content_security_policy?.extension_pages || '')) problems.push("CSP without connect-src 'none'");

  // --- code ---
  for (const [f, s] of code) {
    if (/location\.search/.test(s)) problems.push(`${f}: test hook`);
    if (/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/.test(s)) problems.push(`${f}: network call`);
    if (/\beval\(|new Function\(/.test(s)) problems.push(`${f}: eval`);
    if (/\sstyle="/.test(s)) problems.push(`${f}: inline style="" (CSP style-src 'self')`);
    if (/<script(?![^>]*\bsrc=)/.test(s)) problems.push(`${f}: inline <script>`);
  }
  problems.push(...checkEnglishOnly());
  return problems;
}

/** Every text file the repo would publish (tracked + new, minus .gitignore) must be free of Cyrillic. */
export function checkEnglishOnly() {
  let list;
  try {
    list = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  } catch {
    return []; // not a git checkout (e.g. unpacked release zip): nothing to check
  }
  const problems = [];
  for (const f of list.split('\n').filter(Boolean)) {
    if (CYRILLIC_ALLOWED.includes(f) || /\.(png|jpe?g|gif|ico|zip|jar|woff2?)$/i.test(f)) continue;
    let text;
    try { text = readFileSync(join(ROOT, f), 'utf8'); } catch { continue; } // deleted in the working tree
    const line = text.split('\n').findIndex((l) => /[\u0400-\u04FF]/.test(l));
    if (line >= 0) problems.push(`${f}:${line + 1}: Cyrillic outside translation files (the repo is English-only)`);
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const p = checkRelease();
  console.log(p.length ? p.join('\n') : 'release-check: OK');
  process.exit(p.length ? 1 : 0);
}
