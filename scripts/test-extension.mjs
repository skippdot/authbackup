// Test copy of the extension for e2e and screenshot generation. None of this is in release code:
//  - host_permissions <all_urls>: an automated test cannot click the toolbar icon, and without that click activeTab is not granted;
//  - a single language in _locales + default_locale: on macOS the Chrome UI language cannot be switched with --lang;
//  - popup understands ?tab=&win=: it is opened as a separate window while a different tab must be captured.
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = fileURLToPath(new URL('../extension', import.meta.url));
const TAB_QUERY = 'const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });';

export function prepareTestExtension(lang = 'en') {
  const dir = mkdtempSync(join(tmpdir(), 'authbackup-ext-'));
  cpSync(EXT, dir, { recursive: true });
  const patch = (file, fn) => writeFileSync(join(dir, file), fn(readFileSync(join(dir, file), 'utf8')));
  patch('manifest.json', (src) => {
    const m = JSON.parse(src);
    m.host_permissions = ['<all_urls>'];
    m.default_locale = lang;
    return JSON.stringify(m, null, 2);
  });
  for (const l of readdirSync(join(dir, '_locales'))) if (l !== lang) rmSync(join(dir, '_locales', l), { recursive: true });
  patch('popup.js', (src) => {
    if (!src.includes(TAB_QUERY)) throw new Error('popup.js: could not find the place to inject the test ?tab=');
    return src.replace(TAB_QUERY, `const q = new URLSearchParams(location.search);
  if (q.get('tab')) return { id: Number(q.get('tab')), windowId: Number(q.get('win')) };
  ${TAB_QUERY}`);
  });

  // UI texts come from the same messages.json; $1... are substituted as in chrome.i18n, $$ -> $.
  const msgs = JSON.parse(readFileSync(join(dir, '_locales', lang, 'messages.json'), 'utf8'));
  const M = (key, ...subs) => {
    if (!msgs[key]) throw new Error(`missing key ${key}`);
    return msgs[key].message.replace(/\$(\d)/g, (_, n) => String(subs[n - 1] ?? '')).replace(/\$\$/g, '$');
  };
  return { dir, M, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Opens the popup as a separate window targeting the tabPage tab (the one it scans). */
export async function openPopupFor(ctx, sw, tabUrlPrefix, size = { width: 380, height: 600 }) {
  const extId = new URL(sw.url()).host;
  const tab = await sw.evaluate(async (url) => {
    const [t] = await chrome.tabs.query({ url: `${url}*` });
    return { id: t.id, windowId: t.windowId };
  }, tabUrlPrefix);
  const pagePromise = ctx.waitForEvent('page');
  await sw.evaluate(({ extId, tab, size }) => chrome.windows.create({
    url: `chrome-extension://${extId}/popup.html?tab=${tab.id}&win=${tab.windowId}`, type: 'popup', ...size,
  }), { extId, tab, size });
  const popup = await pagePromise;
  await popup.setViewportSize(size);
  return popup;
}
