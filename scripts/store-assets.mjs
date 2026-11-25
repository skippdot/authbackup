// Assets for the Chrome Web Store -> docs/store-assets/:
//   <lang>-1-scan.png … <lang>-4-security.png - 1280x800 screenshots (en, ru); promo-440x280.png is the small promo tile;
//   og-1200x630.png is the Open Graph / social preview image of the website.
// The real extension (test copy, scripts/test-extension.mjs) is captured on fictional services with test
// secrets; then the frame is composed: caption + browser window + popup on top. No third-party logos or brands.
//   node scripts/store-assets.mjs            - both languages
//   LANGS=en node scripts/store-assets.mjs   - English only
//   ONLY=og node scripts/store-assets.mjs    - only og-1200x630.png (Open Graph image of the site)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumPath } from './chromium.mjs';
import { prepareTestExtension, openPopupFor } from './test-extension.mjs';
import qrcode from '../extension/vendor/qrcode.mjs';
import { buildOtpauthUri } from '../extension/lib/otpauth.js';
import { planMigrationExport } from '../extension/lib/migration.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'docs/store-assets');
const ONLY_OG = process.env.ONLY === 'og'; // ONLY=og: just the Open Graph image (no extension capture)
const LANGS = ONLY_OG ? [] : (process.env.LANGS || 'en,ru').split(',');
mkdirSync(OUT, { recursive: true });

// --- fictional accounts (names are classic placeholder companies, secrets are test values) ---
const acc = (issuer, account, secret, extra = {}) => ({
  type: 'totp', issuer, account, secret, algorithm: 'SHA1', digits: 6, period: 30, counter: 0, ...extra,
});
const NEW_KEY = acc('Acme Cloud', 'alex@example.com', 'JBSWY3DPEHPK3PXP');
const SAVED = [
  acc('Northwind Mail', 'alex@example.com', 'KRSXG5CTMVRXEZLU'),
  acc('Contoso VPN', 'alex.k', 'GEZDGNBVGY3TQOJQ'),
  acc('Fabrikam Bank', 'alex@example.com', 'MFRGGZDFMZTWQ2LK', { digits: 8 }),
  acc('Tailspin Git', 'alexk', 'NBSWY3DPO5XXE3DE', { algorithm: 'SHA256' }),
  acc('Woodgrove Pay', 'alex@example.com', 'ONSWG4TFOQYTEMZU'),
];
const TO_IMPORT = [
  acc('Litware CRM', 'alex@example.com', 'MZXW6YTBOI3DCMRT'),
  acc('Proseware Docs', 'alex', 'OBQXG43XN5ZGIMJS'),
  acc('Adatum Shop', 'alex@example.com', 'KVKFKRCPNZQUYMLX'),
];
const stored = (list) => list.map((a, i) => ({
  ...a, id: `demo-${i}`, source: 'page', addedAt: new Date(Date.now() - (list.length - i) * 86400e3).toISOString(),
}));

// --- frame texts: per-language data in scripts/locales/<lang>.json ---
const loadLocale = (lang) => JSON.parse(readFileSync(join(ROOT, 'scripts/locales', `${lang}.json`), 'utf8'));
const COPY = { en: loadLocale('en'), ru: loadLocale('ru') };

// --- demo site (localhost) ---
const qrSvg = (text) => {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
};
const siteCss = `body{margin:0;font:15px/1.45 -apple-system,system-ui,sans-serif;color:#1d2330;background:#f6f7fb}
header{display:flex;align-items:center;gap:28px;padding:14px 32px;background:#fff;border-bottom:1px solid #e5e8ef}
.logo{font-weight:800;font-size:19px;color:#e2562f;letter-spacing:-.3px}nav{display:flex;gap:20px;color:#5b6475}nav b{color:#1d2330}
main{max-width:860px;margin:28px auto;padding:0 32px}.card{background:#fff;border:1px solid #e5e8ef;border-radius:12px;padding:24px 28px}
h1{font-size:24px;margin:0 0 4px}.lead{color:#5b6475;margin:0 0 20px}.step{font-weight:600;margin:16px 0 10px}
.qr{display:flex;gap:24px;align-items:center}.qr svg{width:168px;height:168px}.key{font-family:ui-monospace,Menlo,monospace;
background:#f1f3f8;padding:6px 10px;border-radius:6px;display:inline-block;margin-top:6px}input{font:inherit;padding:9px 12px;
border:1px solid #cdd3df;border-radius:8px;width:160px;letter-spacing:3px}button{font:inherit;padding:9px 16px;border-radius:8px;
border:0;background:#e2562f;color:#fff;margin-left:8px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:18px}
.grid .card b{display:block;font-size:30px;margin-top:6px}`;
function sitePage(lang, kind) {
  const s = COPY[lang].site;
  const nav = s.nav.map((n, i) => (i === (kind === 'setup' ? 3 : 0) ? `<b>${n}</b>` : n)).join('</span><span>');
  const body = kind === 'setup'
    ? `<div class="card"><h1>${s.h1}</h1><p class="lead">${s.lead}</p>
        <div class="step">${s.step1}</div>
        <div class="qr">${qrSvg(buildOtpauthUri(NEW_KEY))}<div>${s.cant}<br><span class="key">JBSW Y3DP EHPK 3PXP</span></div></div>
        <div class="step">${s.step2}</div><input value="" placeholder="••••••"><button>${s.btn}</button></div>`
    : `<h1>${s.dash}</h1><div class="grid">${s.cards.map((c, i) => `<div class="card">${c}<b>${[12, 37, 2][i]}</b></div>`).join('')}</div>`;
  return `<!doctype html><meta charset="utf-8"><title>Acme Cloud</title><style>${siteCss}</style>
    <header><span class="logo">acme cloud</span><nav><span>${nav}</span></nav></header><main>${body}</main>`;
}
const server = createServer((req, res) => {
  const [, lang, kind] = req.url.split('/');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(sitePage(COPY[lang] ? lang : 'en', kind === 'setup' ? 'setup' : 'dash'));
}).listen(0);
const SITE = `http://localhost:${server.address().port}`;

// --- compose a 1280x800 frame ---
const png64 = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

/** Frames with codes are captured at the start of a 30-second period: otherwise the codes are orange ("about to change")
 * and a click copies the next code, so the toast would not match what is on screen. */
async function calmMoment(period = 30, needLeft = 15) {
  const left = period - ((Date.now() / 1000) % period);
  if (left < needLeft) await new Promise((r) => setTimeout(r, (left + 0.5) * 1000));
}
const ICON = png64(readFileSync(join(ROOT, 'extension/icons/48.png')));
function stageHtml({ title, sub, url, site, popup }) {
  return `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;width:1280px;height:800px;overflow:hidden;font-family:-apple-system,system-ui,sans-serif;
    background:linear-gradient(135deg,#eef2ff 0%,#dde5ff 55%,#cfdaff 100%);color:#121a33}
  .cap{position:absolute;left:64px;top:44px;right:64px}
  h1{margin:0;font-size:40px;letter-spacing:-.6px;font-weight:750}p{margin:10px 0 0;font-size:20px;color:#3d4766;max-width:1000px}
  .win{position:absolute;left:64px;top:178px;width:1152px;height:680px;background:#fff;border-radius:12px;overflow:hidden;
    box-shadow:0 18px 50px rgba(20,35,90,.22),0 0 0 1px rgba(20,35,90,.08)}
  .bar{height:44px;background:#eef0f5;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid #dde1ea}
  .dot{width:12px;height:12px;border-radius:50%;background:#d0d4de}.url{flex:1;margin:0 14px;height:28px;border-radius:14px;
    background:#fff;color:#5b6475;font-size:14px;display:flex;align-items:center;padding:0 14px}
  .bar img{width:22px;height:22px;padding:3px;border-radius:6px;background:${popup ? '#dfe4f0' : 'transparent'}}
  .site{display:block;width:1152px}
  .popup{position:absolute;right:76px;top:226px;width:360px;max-height:560px;object-fit:cover;object-position:top;border-radius:10px;
    box-shadow:0 22px 60px rgba(20,35,90,.32),0 0 0 1px rgba(20,35,90,.12);background:#fff}
  </style>
  <div class="cap"><h1>${title}</h1><p>${sub}</p></div>
  <div class="win"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>
    <div class="url">${url}</div><img src="${ICON}"></div><img class="site" src="${site}"></div>
  ${popup ? `<img class="popup" src="${popup}">` : ''}`;
}

const stageBrowser = await chromium.launch({ executablePath: chromiumPath() });
async function compose(file, opts) {
  const page = await stageBrowser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await page.setContent(stageHtml(opts));
  await page.waitForLoadState('load');
  await page.screenshot({ path: join(OUT, file) });
  await page.close();
  console.log('•', file);
}

// --- capture one language ---
async function shoot(lang) {
  const { dir, cleanup } = prepareTestExtension(lang);
  const profile = mkdtempSync(join(tmpdir(), 'authbackup-assets-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: chromiumPath(), headless: true, deviceScaleFactor: 2, viewport: { width: 1152, height: 636 },
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  try {
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
    const extId = new URL(sw.url()).host;
    const seed = (list) => sw.evaluate((accounts) => chrome.storage.local.clear().then(() => chrome.storage.local.set({
      // all "2+1" copies are present: the frame shows the collapsed "3 copies" row, not the reminder card
      accounts, settings: { lockMinutes: 15, lastFileAt: accounts[0]?.addedAt,
        copies: Object.fromEntries(accounts.map((a) => [a.id, { app: a.addedAt, file: a.addedAt }])) },
    })), stored(list));
    const [title1, title2, title3, title4] = COPY[lang].shots;
    // popup sized to its content (like the real one, it does not stretch to 600 px); the toast, if visible, sits right below the list
    const popupShot = async (popup) => {
      const { bottom, toast } = await popup.evaluate(() => ({
        bottom: Math.max(...[...document.body.children].filter((e) => e.id !== 'toast' && !e.hidden && e.tagName !== 'SCRIPT')
          .map((e) => e.getBoundingClientRect().bottom)),
        toast: !!document.querySelector('#toast.show'),
      }));
      await popup.setViewportSize({ width: 360, height: Math.ceil(bottom) + (toast ? 58 : 6) });
      await popup.waitForTimeout(300); // the toast slides in with an animation
      return popup.screenshot();
    };

    // 1. 2FA setup page + popup found the QR
    await seed(SAVED.slice(0, 3));
    const site = ctx.pages()[0] ?? (await ctx.newPage());
    await site.goto(`${SITE}/${lang}/setup`);
    const siteSetup = await site.screenshot();
    await calmMoment();
    let popup = await openPopupFor(ctx, sw, `${SITE}/`, { width: 360, height: 600 });
    await popup.waitForSelector('#found .item', { timeout: 10000 });
    await compose(`${lang}-1-scan.png`, {
      title: title1[0], sub: title1[1], url: 'acme-cloud.example/settings/security', site: png64(siteSetup), popup: png64(await popupShot(popup)),
    });
    await popup.close();

    // 2. code list, the first one was just copied
    await seed(SAVED);
    await site.goto(`${SITE}/${lang}/dash`);
    const siteDash = await site.screenshot();
    await calmMoment();
    popup = await openPopupFor(ctx, sw, `${SITE}/`, { width: 360, height: 600 });
    await popup.waitForSelector('#list li .code:not(:empty)');
    await popup.click('#list li:first-child');
    await popup.waitForSelector('#toast.show');
    await compose(`${lang}-2-codes.png`, {
      title: title2[0], sub: title2[1], url: 'acme-cloud.example/dashboard', site: png64(siteDash), popup: png64(await popupShot(popup)),
    });
    await popup.close();

    // 3. registry page: importing a Google Authenticator export (three new keys in the preview)
    const manage = await ctx.newPage();
    await manage.setViewportSize({ width: 1152, height: 636 });
    await manage.goto(`chrome-extension://${extId}/manage.html`);
    // transfer export image: a QR with three keys, as saved from a phone
    const qrPage = await stageBrowser.newPage({ viewport: { width: 420, height: 420 } });
    await qrPage.setContent(`<body style="margin:0;background:#fff;padding:20px">${qrSvg(planMigrationExport(TO_IMPORT).uris[0])}</body>`);
    const qrFile = join(profile, 'authenticator-export.png');
    await qrPage.locator('svg').screenshot({ path: qrFile });
    await qrPage.close();
    await manage.setInputFiles('#files', qrFile);
    await manage.waitForSelector('#preview .item');
    await manage.evaluate(() => window.scrollTo(0, 0));
    await compose(`${lang}-3-import.png`, {
      title: title3[0], sub: title3[1], url: 'AuthBackup', site: png64(await manage.screenshot()),
    });

    // 4. password enabled: security section + export
    await manage.click('#clearPreview');
    await manage.fill('#setPw input[name=pw]', 'demo-pass-123');
    await manage.fill('#setPw input[name=pw2]', 'demo-pass-123');
    await manage.click('#setPw button[type=submit]');
    await manage.waitForSelector('#lockNow', { timeout: 15000 });
    await manage.waitForSelector('#toast.show');
    await manage.evaluate(() => document.querySelector('#toast')?.classList.remove('show'));
    // bottom padding so the export card lines up with the top edge of the frame instead of a cut-off table row
    await manage.evaluate(() => {
      document.body.style.paddingBottom = '600px';
      document.querySelector('#exportCard').scrollIntoView({ block: 'start' });
      window.scrollBy(0, -20);
    });
    await compose(`${lang}-4-security.png`, {
      title: title4[0], sub: title4[1], url: 'AuthBackup', site: png64(await manage.screenshot()),
    });
  } finally {
    await ctx.close();
    rmSync(profile, { recursive: true, force: true });
    cleanup();
  }
}

try {
  for (const lang of LANGS) await shoot(lang);

  // Promo tile 440x280 (language-neutral, English caption)
  const page = await stageBrowser.newPage({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    body{margin:0;width:440px;height:280px;display:flex;align-items:center;justify-content:center;gap:22px;
      font-family:-apple-system,system-ui,sans-serif;color:#fff;background:linear-gradient(135deg,#3a63f0,#2445c9)}
    img{width:96px;height:96px;border-radius:22px;box-shadow:0 10px 30px rgba(0,0,30,.35)}
    h1{margin:0;font-size:38px;letter-spacing:-.5px}p{margin:6px 0 0;font-size:18px;opacity:.9}</style>
    <img src="${png64(readFileSync(join(ROOT, 'extension/icons/128.png')))}"><div><h1>AuthBackup</h1><p>${COPY.en.promo}</p></div>`);
  await page.screenshot({ path: join(OUT, 'promo-440x280.png') });
  console.log('• promo-440x280.png');

  // Open Graph image 1200x630 for the website (same style as the promo tile, English, 24-bit PNG)
  const og = await stageBrowser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await og.setContent(`<!doctype html><meta charset="utf-8"><style>
    body{margin:0;width:1200px;height:630px;display:flex;align-items:center;justify-content:center;gap:56px;
      font-family:-apple-system,system-ui,sans-serif;color:#fff;background:linear-gradient(135deg,#3a63f0,#2445c9)}
    img{width:220px;height:220px;border-radius:50px;box-shadow:0 22px 60px rgba(0,0,30,.4)}
    h1{margin:0;font-size:96px;letter-spacing:-2px}p{margin:14px 0 0;font-size:38px;opacity:.92;max-width:640px;line-height:1.25}
    small{display:block;margin-top:26px;font-size:26px;opacity:.75}</style>
    <img src="${png64(readFileSync(join(ROOT, 'extension/icons/128.png')))}"><div><h1>AuthBackup</h1><p>${COPY.en.promo}</p><small>authbackup.com</small></div>`);
  await og.screenshot({ path: join(OUT, 'og-1200x630.png') });
  console.log('• og-1200x630.png');
} finally {
  await stageBrowser.close();
  server.close();
}
if (!ONLY_OG) writeFileSync(join(OUT, 'README.md'), COPY.en.readme);
