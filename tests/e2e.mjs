// E2E: real Chromium with the extension + the bench. Records video and screenshots into tests/artifacts/<timestamp>/.
//   node tests/e2e.mjs            - headless
//   HEADED=1 node tests/e2e.mjs   - with browser windows
// Scenario:
//  1) the bench shows an enrollment QR (SHA256, 8 digits) -> the popup finds it on the page -> "Save + code"
//     -> the code is entered on the bench -> the (Python) server accepts it;
//  2) the bench shows a 3-key Google Authenticator export -> "Scan page" -> "Save all"
//     -> the server accepts every code from the popup;
//  3) another export is saved as a PNG file -> imported via the management page -> the codes are accepted again;
//  4) registry password: only ciphertext in storage, locking by button and by alarm, wrong/right password;
//  5) "Google Auth style" export (QR -> PNG -> import again = same keys), encrypted backup, otpauth.txt;
//  6) changing and removing the password.
// Also: backup reminder, no CSP violations. UI language: E2E_LANG=en|ru (default en).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumPath } from '../scripts/chromium.mjs';
import { prepareTestExtension, openPopupFor } from '../scripts/test-extension.mjs';
import { openVault } from '../extension/lib/vault.js';
import { parseOtpauthUri } from '../extension/lib/otpauth.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 8794;
const BENCH = `http://localhost:${PORT}`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = join(ROOT, 'tests/artifacts', stamp);
mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log('•', ...a);
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✖'} ${name}${extra ? ` — ${extra}` : ''}`);
};

// --- bench ---
const server = spawn('python3', [join(ROOT, 'bench/server.py'), String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res, rej) => {
  server.stdout.on('data', (d) => String(d).includes('TOTP bench') && res());
  server.on('exit', (c) => rej(new Error(`bench exited ${c}`)));
  setTimeout(() => rej(new Error('bench did not start within 10 s')), 10000);
});
const api = async (path, body) => (await fetch(BENCH + path, body ? { method: 'POST', body: JSON.stringify(body) } : {})).json();

// --- test copy of the extension (scripts/test-extension.mjs); release code has none of these changes ---
const LANG = process.env.E2E_LANG || 'en';
const { dir: extDir, M, cleanup: cleanupExt } = prepareTestExtension(LANG);

const profile = mkdtempSync(join(tmpdir(), 'authbackup-profile-'));
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: chromiumPath(),
  headless: !process.env.HEADED,
  viewport: { width: 1280, height: 860 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 860 } },
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
// CSP violations and unhandled errors on extension pages are failures too.
const consoleProblems = [];
const watchPage = (p) => {
  p.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text()) || (m.type() === 'error' && p.url().startsWith('chrome-extension://'))) {
      consoleProblems.push(`${m.type()}: ${m.text().slice(0, 200)}`);
    }
  });
  p.on('pageerror', (e) => p.url().startsWith('chrome-extension://') && consoleProblems.push(`pageerror: ${e.message}`));
};
ctx.on('page', watchPage);
ctx.pages().forEach(watchPage);

/** Wait until at least 4 s remain before the code changes, so the popup and the server look at the same step. */
async function safeMoment(period = 30) {
  const left = period - (Math.floor(Date.now() / 1000) % period);
  if (left < 4) await new Promise((r) => setTimeout(r, (left + 0.3) * 1000));
}

async function popupCodes(popup) {
  return popup.$$eval('#list li', (lis) => lis.map((li) => ({
    title: li.querySelector('.t').textContent.trim(),
    sub: li.querySelector('.s').childNodes[0]?.textContent.trim() ?? '',
    code: li.querySelector('.code').textContent.replace(/\s/g, ''),
  })));
}

/** Find each bench account in the popup and send its code to the server. */
async function verifyAllViaServer(popup, enrollments, label) {
  await safeMoment();
  const shown = await popupCodes(popup);
  for (const e of enrollments) {
    // Different exports can share names, so take the latest one (new entries are appended to the end).
    const row = shown.findLast((r) => r.title === e.issuer && r.sub === e.account);
    if (!row) {
      check(`${label}: ${e.issuer} is in the popup`, false);
      continue;
    }
    const r = await api('/api/verify', { id: e.id, code: row.code });
    check(`${label}: ${e.issuer} (${e.algorithm}/${e.digits}) - server accepted the code`, r.ok, r.ok ? row.code : r.error);
  }
}

try {
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  log('extension id', extId, '· lang', LANG);
  sw.on?.('console', (m) => /Content Security Policy|Refused to/i.test(m.text()) && consoleProblems.push(`sw: ${m.text()}`));

  // ---------- 1. 2FA enrollment from the page ----------
  const bench = ctx.pages()[0] ?? (await ctx.newPage());
  await bench.goto(BENCH);
  await bench.selectOption('#algorithm', 'SHA256');
  await bench.selectOption('#digits', '8');
  await bench.click('#enroll');
  await bench.waitForSelector('#enrollQr[src^="data:"]');
  await api('/api/codes');
  // open the popup in a separate window so the bench tab stays active (captureVisibleTab captures it)
  const popup = await openPopupFor(ctx, sw, `${BENCH}/`); // ctx.on('page') already watches its console
  await popup.waitForSelector('#found .item', { timeout: 10000 });
  const foundText = await popup.textContent('#found');
  check('Auto-scan found the enrollment QR on the page', foundText.includes('TOTP Bench') && foundText.includes('SHA256') && foundText.includes(M('nDigits', 8)));
  await popup.screenshot({ path: join(OUT, '1-popup-found.png') });

  await safeMoment();
  await popup.click('#found button[data-save="0"]');
  await popup.waitForSelector('#list li');
  const [first] = await popupCodes(popup);
  check('Account saved to the registry', first?.title === 'TOTP Bench' && first.code.length === 8, first?.code);
  await popup.waitForSelector('#copies:not([hidden])');
  check('2+1: the first key has no copy in the app or in a file',
    (await popup.textContent('#rowApp .txt')) === M('copyAppMissing', 1) && (await popup.textContent('#rowFile .txt')) === M('copyFileMissing', 1));

  await bench.bringToFront();
  await bench.fill('#code', first.code);
  await bench.click('#verify');
  await bench.waitForSelector('#verifyOut b');
  const verifyText = await bench.textContent('#verifyOut');
  check('Bench accepted the code from the extension (SHA256, 8 digits)', verifyText.includes('2FA enabled'), verifyText.trim());
  await bench.screenshot({ path: join(OUT, '2-bench-verified.png') });

  // ---------- 2. Google Authenticator export from the page ----------
  const mig = await api('/api/migration', {}); // create via the API, but show it on the page the same way
  await bench.evaluate((uri) => {
    return import('/vendor/qrcode.mjs').then(({ default: qrcode }) => {
      const qr = qrcode(0, 'M');
      qr.addData(uri);
      qr.make();
      document.querySelector('#migrateQr').src = qr.createDataURL(5, 4);
      document.querySelector('#migrateOut').hidden = false;
    });
  }, mig.uri);
  await bench.waitForTimeout(300);
  await popup.click('#scan');
  await popup.waitForFunction(() => document.querySelector('#found [data-save-all]'), null, { timeout: 10000 });
  const found2 = await popup.textContent('#found');
  check('Scan found the GA export: 3 new + 1 already saved', found2.includes(M('saveAll', 3)) && found2.includes(M('alreadySaved')));
  await popup.screenshot({ path: join(OUT, '3-popup-migration-found.png') });
  await popup.click('#found [data-save-all]');
  await popup.waitForFunction(() => document.querySelectorAll('#list li').length === 4);
  await popup.screenshot({ path: join(OUT, '4-popup-list.png') });
  await verifyAllViaServer(popup, mig.accounts, 'GA export from the page');
  // The page has two QRs: enrollment (TOTP Bench, already saved) and the GA export (3 new). Keys from the export
  // count as in the app, while TOTP Bench came from an enrollment QR, so it still has no in-app copy.
  await popup.waitForFunction((ok) => document.querySelector('#rowFile .txt').textContent === ok, M('copyFileMissing', 4));
  check('2+1: the GA export counts as an in-app copy (only the enrollment-QR key lacks one), 4 keys have no file',
    (await popup.textContent('#rowApp .txt')) === M('copyAppMissing', 1));
  await popup.click('#copyAppHave');
  await popup.waitForFunction((ok) => document.querySelector('#rowApp .txt').textContent === ok, M('copyAppOk'));
  check('"Already have it": the app row is checked with no buttons, the file is still needed',
    await popup.$eval('#copyApp', (el) => !el.checkVisibility()) && (await popup.textContent('#rowFile .txt')) === M('copyFileMissing', 4));

  // ---------- 3. GA export as an image via the management page ----------
  await bench.bringToFront();
  await bench.click('#migrate'); // a new export with new secrets, now through the bench UI
  await bench.waitForTimeout(300);
  const pngPath = join(OUT, 'google-auth-export.png');
  await bench.locator('#migrateQr').screenshot({ path: pngPath });
  const codesNow = (await api('/api/codes')).items;
  const fileAccounts = codesNow.slice(-3);

  const manage = await ctx.newPage();
  await manage.goto(`chrome-extension://${extId}/manage.html`);
  await manage.setInputFiles('#files', pngPath);
  await manage.waitForSelector('#addPicked:not([disabled])');
  check('PNG import: 3 keys in the preview', (await manage.$$('#preview .item')).length === 3);
  await manage.screenshot({ path: join(OUT, '5-manage-preview.png'), fullPage: true });
  await manage.click('#addPicked');
  await manage.waitForFunction(() => document.querySelectorAll('#table tbody tr').length === 7);
  check('Registry: 7 accounts', true);
  check('2+1 in the registry: all 7 in the app, 7 without a file',
    (await manage.textContent('#backupStatus')).startsWith(M('copiesStatusOffsite', 7, '').split(' (')[0]));
  const enrollFull = fileAccounts.map((it) => ({ ...it, ...mig.accounts.find((m) => m.issuer === it.issuer) , id: it.id }));
  await popup.bringToFront();
  await verifyAllViaServer(popup, enrollFull, 'GA export from PNG');

  // Key details: seed/QR
  await manage.bringToFront();
  await manage.click('#table tbody tr:first-child button[data-act="details"]');
  await manage.waitForSelector('dialog[open] .qr svg');
  const dd = await manage.$$eval('dialog dd', (els) => els.map((e) => e.textContent));
  check('Key dialog: base32 and hex seed agree', dd[0].length > 0 && /^[0-9a-f]+$/.test(dd[1]) && dd[1].length === Math.floor((dd[0].length * 5) / 8) * 2, `seed ${dd[1].length / 2} bytes`);
  await manage.screenshot({ path: join(OUT, '6-manage-details.png'), fullPage: true });

  // ---------- 4. Registry password ----------
  const PW = 'bench-pass-123';
  const PW2 = 'other-pass-456';
  const storage = () => sw.evaluate(() => chrome.storage.local.get(null));
  const allSecrets = mig.accounts.map((a) => a.secret);
  const pwDialog = async (page, pw) => {
    await page.waitForSelector('dialog.pw-dialog[open]');
    await page.fill('dialog.pw-dialog input[name=pw]', pw);
    await page.click('dialog.pw-dialog button[type=submit]');
  };
  const toastWith = (page, part) => page.waitForFunction((p) => {
    const t = document.querySelector('#toast.show')?.textContent || '';
    return t.includes(p) && t;
  }, part, { timeout: 10000 }).then((h) => h.jsonValue());

  await manage.keyboard.press('Escape');
  await manage.fill('#setPw input[name=pw]', PW);
  await manage.fill('#setPw input[name=pw2]', PW);
  await manage.click('#setPw button[type=submit]');
  await manage.waitForSelector('#lockNow', { timeout: 10000 });
  let st = await storage();
  const raw = JSON.stringify(st);
  check('Password: storage.local holds only the vault, no plain list', !st.accounts && !!st.vault?.ct && !allSecrets.some((sec) => raw.includes(sec)));
  await manage.screenshot({ path: join(OUT, '7-manage-security.png'), fullPage: true });

  await popup.bringToFront();
  await popup.waitForFunction(() => !document.querySelector('#lockBtn').hidden);
  check('Popup after setting a password is open and shows 7 codes', (await popupCodes(popup)).length === 7);

  await popup.click('#lockBtn');
  await popup.waitForSelector('#lock:not([hidden])');
  await manage.waitForSelector('#lockScreen:not([hidden])');
  check('Lock button: popup and registry page are locked, codes removed', (await popup.$$('#list li')).length === 0);
  await popup.screenshot({ path: join(OUT, '8-popup-locked.png') });

  await popup.fill('#unlockPw', 'wrong-password');
  await popup.click('#lock button[type=submit]');
  await popup.waitForFunction((msg) => document.querySelector('#lock .err').textContent === msg, M('wrongPassword'));
  check('Wrong password rejected', true);
  await popup.fill('#unlockPw', PW);
  await popup.click('#lock button[type=submit]');
  await popup.waitForFunction(() => document.querySelectorAll('#list li').length === 7, null, { timeout: 10000 });
  await manage.waitForSelector('#app:not([hidden])');
  check('Correct password: popup and registry unlocked', true);
  await verifyAllViaServer(popup, enrollFull, 'After unlock');

  // auto-lock: a real chrome.alarms alarm (unpacked extensions have no 30 s minimum)
  await sw.evaluate(() => {
    const when = Date.now() + 800;
    return chrome.storage.session.set({ unlockUntil: when }).then(() => chrome.alarms.create('autolock', { when }));
  });
  await popup.waitForSelector('#lock:not([hidden])', { timeout: 10000 });
  check('Auto-lock by alarm fired', true);
  await popup.fill('#unlockPw', PW);
  await popup.click('#lock button[type=submit]');
  await popup.waitForFunction(() => document.querySelectorAll('#list li').length === 7, null, { timeout: 10000 });

  // ---------- 5. Export ----------
  await manage.bringToFront();
  await manage.waitForSelector('#exportCard:not([hidden])');
  await manage.click('[data-export="google"]');
  await pwDialog(manage, 'wrong-password');
  await manage.waitForFunction((msg) => document.querySelector('dialog.pw-dialog .err').textContent === msg, M('wrongPassword'));
  await manage.fill('dialog.pw-dialog input[name=pw]', PW);
  await manage.click('dialog.pw-dialog button[type=submit]');
  await manage.waitForSelector('#exportDialog[open] .qr svg', { timeout: 10000 });
  const pages = Number((await manage.textContent('#gaPage')).match(/(\d+)\D*$/)[1]);
  await manage.screenshot({ path: join(OUT, '9-export-google.png') });
  const pngs = [];
  for (let i = 0; i < pages; i++) {
    const dl = manage.waitForEvent('download');
    await manage.click('#exportDialog [data-png]');
    const file = join(OUT, `export-ga-${i + 1}.png`);
    await (await dl).saveAs(file);
    pngs.push(file);
    if (i < pages - 1) await manage.click('#exportDialog [data-nav="1"]');
  }
  await manage.click('#exportDialog [data-close]');
  await manage.setInputFiles('#files', pngs);
  await manage.waitForSelector('#preview .item');
  const items = await manage.$$eval('#preview .item', (els, known) => els.map((e) => e.textContent.includes(known)), M('alreadySaved'));
  check(`GA export -> ${pages} PNG -> import: all 7 keys recognized as already present (secrets match)`, items.length === 7 && items.every(Boolean), `${items.length} items`);
  await manage.click('#clearPreview');

  let dl = manage.waitForEvent('download');
  await manage.click('[data-export="encrypted"]');
  await pwDialog(manage, PW);
  const encPath = join(OUT, 'backup.encrypted.json');
  await (await dl).saveAs(encPath);
  const encText = readFileSync(encPath, 'utf8');
  const enc = JSON.parse(encText);
  const dec = await openVault(PW, enc.encrypted);
  check('Encrypted backup: no secrets in the file, 7 keys decrypt with the password',
    !allSecrets.some((sec) => encText.includes(sec)) && dec.data.accounts.length === 7);
  await manage.waitForFunction((ok) => document.querySelector('#backupStatus').textContent.startsWith(ok), M('copiesAllDone'));
  await popup.waitForSelector('#copiesDone:not([hidden])');
  check('After backup: the registry says all keys have 3 copies, the popup shows a single "3 copies" row',
    await popup.$eval('#copies', (el) => el.hidden) && (await popup.textContent('#copiesDone')).startsWith(M('copiesDone', '').trim()));

  dl = manage.waitForEvent('download');
  await manage.click('[data-export="otpauth"]');
  await pwDialog(manage, PW);
  const txtPath = join(OUT, 'export.otpauth.txt');
  await (await dl).saveAs(txtPath);
  const lines = readFileSync(txtPath, 'utf8').trim().split('\n').map(parseOtpauthUri);
  check('otpauth.txt export: 7 links, same secrets', lines.length === 7 && allSecrets.every((sec) => lines.some((l) => l.secret === sec)));

  await manage.setInputFiles('#importJson', encPath);
  await pwDialog(manage, PW);
  const restored = await toastWith(manage, M('restored', 0, 7));
  check('Encrypted backup restore: duplicates recognized', restored === M('restored', 0, 7), restored);

  // ---------- 6. Changing and removing the password ----------
  await manage.click('#changePwBtn');
  await manage.fill('#changePw input[name=current]', PW);
  await manage.fill('#changePw input[name=pw]', PW2);
  await manage.fill('#changePw input[name=pw2]', PW2);
  await manage.click('#changePw button[type=submit]');
  await manage.waitForFunction((msg) => document.querySelector('#toast.show')?.textContent === msg, M('pwChanged'), { timeout: 10000 });
  st = await storage();
  let oldWorks = true;
  try {
    await openVault(PW, st.vault);
  } catch {
    oldWorks = false;
  }
  check('Password change: the vault opens with the new password, not the old one', !oldWorks && (await openVault(PW2, st.vault)).data.accounts.length === 7);

  await manage.click('#removePwBtn');
  await pwDialog(manage, PW2);
  await manage.waitForSelector('#setPw');
  st = await storage();
  check('Password removal: registry is a plain list again, 7 keys', !st.vault && st.accounts?.length === 7);
  await popup.bringToFront();
  await popup.waitForFunction(() => document.querySelector('#lockBtn').hidden);
  await verifyAllViaServer(popup, enrollFull, 'After password removal');
  // ---------- 7. A new key after a complete set: the card expands again ----------
  await manage.bringToFront();
  await manage.fill('#manual [name=issuer]', 'Manual Co');
  await manage.fill('#manual [name=secret]', 'GEZDGNBVGY3TQOJQ');
  await manage.fill('#manual [name=period]', '2147483648');
  check('Manual key: the form refuses a period beyond the 32-bit limit of the mobile apps',
    await manage.$eval('#manual [name=period]', (i) => i.validity.rangeOverflow && !i.form.checkValidity()));
  await manage.fill('#manual [name=period]', '30');
  await manage.click('#manual [type=submit]');
  await popup.bringToFront();
  await popup.waitForSelector('#copies:not([hidden])');
  check('2+1: manual key: the card is expanded again (app 1, file 1)',
    (await popup.textContent('#rowApp .txt')) === M('copyAppMissing', 1) && (await popup.textContent('#rowFile .txt')) === M('copyFileMissing', 1));
  await popup.screenshot({ path: join(OUT, '9-popup-copies.png') });

  check('No CSP violations or errors on extension pages', !consoleProblems.length, consoleProblems.slice(0, 3).join(' | '));
} catch (e) {
  check(`Scenario crashed: ${e.message.split('\n')[0]}`, false);
} finally {
  await ctx.close(); // videos are finalized on close
  server.kill();
  rmSync(profile, { recursive: true, force: true });
  cleanupExt();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks OK. Video and screenshots: ${OUT}`);
process.exit(failed ? 1 : 0);
