import {
  getAccounts, addAccounts, markKnown, updateAccount, removeAccount, moveAccount,
  getLockState, lock, setPassword, removePassword, verifyPassword, setLockMinutes, onStoreChange, LockedError, LOCK_OPTIONS,
  getSettings, markCopies,
} from './lib/store.js';
import { copyStatus } from './lib/copies.js';
import { t, localize, uiLang, fmtDate } from './lib/i18n.js';
import { wireUnlockForm } from './lib/lockui.js';
import { createVault, openVault, MIN_PASSWORD, DEFAULT_ITERATIONS } from './lib/vault.js';
import { planMigrationExport } from './lib/migration.js';
import { findQrTextsInBlob } from './lib/qr.js';
import { interpretQrTexts } from './lib/scan.js';
import { buildOtpauthUri, backupEntryToAccount } from './lib/otpauth.js';
import { base32Decode, bytesToHex, isValidBase32, normalizeBase32 } from './lib/base32.js';
import {
  $, esc, formatCode, title, subtitle, badges, currentCode, secondsLeft, qrSvg, toast, copy, qrPngBlob, downloadBlob, askPassword,
} from './lib/ui.js';

let accounts = [];
let lockState = { protected: false, unlocked: true, lockMinutes: 15 };
let preview = []; // [{ label, source, accounts:[{...a, known, checked}], notes:[] }]

const SOURCE_KEYS = { page: 'srcPage', paste: 'srcPaste', image: 'srcImage', text: 'srcText', manual: 'srcManual', backup: 'srcBackup' };
let settings = {};

// ---------- Import images/links with preview ----------

async function previewGroup(label, source, r) {
  const marked = await markKnown(r.accounts);
  return {
    label,
    source,
    accounts: marked.map((a) => ({ ...a, checked: !a.known })),
    notes: [
      ...r.skipped.map((s) => t('skippedItem', s.name, s.reason)),
      ...r.errors,
      ...(r.otherQr.length ? [t('otherQr', r.otherQr.map((x) => x.slice(0, 50)).join(', '))] : []),
      ...(!r.accounts.length && !r.otherQr.length && !r.errors.length ? [t('noQrInImage')] : []),
    ],
  };
}

async function importFiles(files) {
  const groups = [];
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    try {
      groups.push(await previewGroup(f.name || t('clipboardImage'), 'image', interpretQrTexts(await findQrTextsInBlob(f))));
    } catch (e) {
      groups.push({ label: f.name, source: 'image', accounts: [], notes: [t('readFailed', e.message)] });
    }
  }
  preview = groups;
  renderPreview();
}

async function importTexts(text) {
  const lines = text.split(/\s+/).filter((l) => /^otpauth/i.test(l));
  if (!lines.length) return toast(t('noOtpLines'), 'error');
  preview = [await previewGroup(t('pastedLinks'), 'text', interpretQrTexts(lines))];
  renderPreview();
  $('#preview').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderPreview() {
  const box = $('#preview');
  box.hidden = !preview.length;
  const total = preview.reduce((n, g) => n + g.accounts.filter((a) => a.checked).length, 0);
  box.innerHTML = preview
    .map((g, gi) => `
      <div class="file">${esc(g.label)}</div>
      ${g.accounts.map((a, ai) => `
        <label class="item">
          <input type="checkbox" data-g="${gi}" data-a="${ai}" ${a.checked ? 'checked' : ''} ${a.known ? 'disabled' : ''}>
          <div class="names"><b>${esc(title(a))}</b>${badges(a).map((b) => `<span class="badge">${esc(b)}</span>`).join('')}
            <div class="muted">${esc(subtitle(a))}</div></div>
          ${a.known ? `<span class="ok">${esc(t('alreadySaved'))}</span>` : ''}
        </label>`).join('')}
      ${g.notes.map((n) => `<div class="err">${esc(n)}</div>`).join('')}`)
    .join('') +
    `<div class="actions"><button class="primary" id="addPicked" ${total ? '' : 'disabled'}>${esc(t('addPicked', total))}</button>
     <button id="clearPreview">${esc(t('clear'))}</button></div>`;
}

$('#preview').addEventListener('change', (e) => {
  const cb = e.target.closest('input[type=checkbox]');
  if (!cb) return;
  preview[cb.dataset.g].accounts[cb.dataset.a].checked = cb.checked;
  renderPreview();
});

$('#preview').addEventListener('click', async (e) => {
  if (e.target.id === 'clearPreview') {
    preview = [];
    renderPreview();
  } else if (e.target.id === 'addPicked') {
    let n = 0;
    for (const g of preview) {
      const picked = g.accounts.filter((a) => a.checked || (a.known && a.fromApp)) // already saved keys from a GA export, to mark them "in the app"
        .map(({ known, checked, ...a }) => a);
      n += (await addAccounts(picked, g.source)).added.length;
    }
    preview = [];
    renderPreview();
    toast(t('addedN', n));
  }
});

const drop = $('#drop');
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  importFiles([...e.dataTransfer.files]);
});
$('#files').addEventListener('change', (e) => {
  importFiles([...e.target.files]);
  e.target.value = '';
});
document.addEventListener('paste', (e) => {
  if (e.target.closest('input, textarea')) return; // pasting text into form fields: do not intercept
  const files = [...e.clipboardData.files];
  if (files.length) {
    e.preventDefault();
    importFiles(files);
  } else {
    const text = e.clipboardData.getData('text');
    if (/otpauth/i.test(text)) importTexts(text);
  }
});
$('#parseUris').addEventListener('click', () => importTexts($('#uris').value));

// ---------- Manual entry ----------

$('#manual').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const secret = normalizeBase32(f.get('secret'));
  if (!isValidBase32(secret)) return toast(t('secretNotBase32'), 'error');
  const a = {
    type: 'totp',
    issuer: f.get('issuer').trim(),
    account: f.get('account').trim(),
    secret,
    algorithm: f.get('algorithm'),
    digits: Number(f.get('digits')),
    period: Number(f.get('period')) || 30,
    counter: 0,
  };
  const { added } = await addAccounts([a], 'manual');
  if (added.length) {
    e.target.reset();
    toast(t('added'));
  } else toast(t('keyExists'), 'error');
});

// ---------- Registry ----------

function renderTable() {
  $('#count').textContent = accounts.length ? `(${accounts.length})` : '';
  $('#empty').hidden = accounts.length > 0;
  $('#table').hidden = !accounts.length;
  $('#table tbody').innerHTML = accounts
    .map((a, i) => `
      <tr data-id="${a.id}">
        <td><div class="t">${esc(title(a))}</div><div class="s">${esc(subtitle(a))}</div></td>
        <td>${esc(a.type.toUpperCase())} · ${esc(a.algorithm)} · ${a.digits}${a.type === 'totp' ? ` · ${esc(t('nSec', a.period))}` : ` · ${esc(t('counterN', a.counter))}`}</td>
        <td class="code"></td>
        <td class="muted">${esc(SOURCE_KEYS[a.source] ? t(SOURCE_KEYS[a.source]) : a.source || '')}</td>
        <td class="act">
          <button data-act="details">${esc(t('btnDetails'))}</button>
          <button data-act="up" ${i === 0 ? 'disabled' : ''} title="${esc(t('moveUp'))}">↑</button>
          <button data-act="down" ${i === accounts.length - 1 ? 'disabled' : ''} title="${esc(t('moveDown'))}">↓</button>
          <button data-act="del" class="danger" title="${esc(t('delete'))}">✕</button>
        </td>
      </tr>`)
    .join('');
  tick();
}

async function tick() {
  const now = Date.now();
  for (const tr of document.querySelectorAll('#table tbody tr')) {
    const a = accounts.find((x) => x.id === tr.dataset.id);
    const td = tr.querySelector('.code');
    if (!a) continue;
    if (a.type === 'hotp') {
      td.textContent = '—';
      continue;
    }
    td.textContent = `${formatCode(await currentCode(a, now))}`;
    td.title = t('clickToCopyLeft', secondsLeft(a.period, now));
  }
}

function showDetails(a) {
  const uri = buildOtpauthUri(a);
  const dlg = $('#details');
  dlg.innerHTML = `
    <h3>${esc(title(a))}</h3>
    <div class="qr">${qrSvg(uri)}</div>
    <p class="muted small qr-hint">${esc(t('detailsScanHint'))}</p>
    <form method="dialog" class="grid" id="editForm">
      <label>${esc(t('dlService'))}<input name="issuer" value="${esc(a.issuer)}"></label>
      <label>${esc(t('fAccount'))}<input name="account" value="${esc(a.account)}"></label>
    </form>
    <dl>
      <dt>${esc(t('dlSecret'))}</dt><dd>${esc(a.secret)}</dd>
      <dt>Seed (hex)</dt><dd>${bytesToHex(base32Decode(a.secret))}</dd>
      <dt>${esc(t('dlSeedLen'))}</dt><dd>${esc(t('nBytes', base32Decode(a.secret).length))}</dd>
      <dt>URI</dt><dd>${esc(uri)}</dd>
      <dt>${esc(t('dlAdded'))}</dt><dd>${esc(a.addedAt || '')}</dd>
    </dl>
    <div class="row">
      <button data-copy="secret">${esc(t('copyKey'))}</button>
      <button data-copy="uri">${esc(t('copyUri'))}</button>
      <div class="spacer"></div>
      <button data-close>${esc(t('close'))}</button>
      <button class="primary" data-save>${esc(t('saveName'))}</button>
    </div>`;
  dlg.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.copy === 'secret') await copy(a.secret).then(() => toast(t('keyCopied')));
    if (b.dataset.copy === 'uri') await copy(uri).then(() => toast(t('uriCopied')));
    if (b.hasAttribute('data-close')) dlg.close();
    if (b.hasAttribute('data-save')) {
      const f = new FormData($('#editForm', dlg));
      await updateAccount(a.id, { issuer: f.get('issuer').trim(), account: f.get('account').trim() });
      dlg.close();
      toast(t('saved'));
    }
  };
  dlg.showModal();
}

$('#table').addEventListener('click', async (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  const a = accounts.find((x) => x.id === tr.dataset.id);
  if (e.target.closest('td.code') && a.type === 'totp') {
    const code = await currentCode(a);
    await copy(code);
    return toast(t('copied', formatCode(code)));
  }
  const act = e.target.closest('button')?.dataset.act;
  if (act === 'details') showDetails(a);
  if (act === 'up') moveAccount(a.id, -1);
  if (act === 'down') moveAccount(a.id, 1);
  if (act === 'del' && confirm(t('confirmDelete', fullName(a)))) {
    removeAccount(a.id);
  }
});


// ---------- Export ----------

const picked = new Set();
let seenIds = new Set();
const stamp = () => new Date().toISOString().slice(0, 10);
const jsonBlob = (data) => new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
const pwError = (x) => new Error(x.name === 'WrongPasswordError' ? t('wrongPassword') : x.message);
const fullName = (a) => (a.issuer && a.account ? `${a.issuer} / ${a.account}` : title(a));

function renderExport() {
  for (const a of accounts) if (!seenIds.has(a.id)) picked.add(a.id); // new keys are checked right away
  seenIds = new Set(accounts.map((a) => a.id));
  for (const id of [...picked]) if (!seenIds.has(id)) picked.delete(id);
  $('#exportCard').hidden = !accounts.length;
  $('#exportList').innerHTML = accounts
    .map((a) => `<label title="${esc(fullName(a))}"><input type="checkbox" data-id="${a.id}" ${picked.has(a.id) ? 'checked' : ''}>
      <span>${esc(title(a))} <span class="muted">${esc(subtitle(a))}</span></span></label>`)
    .join('');
  $('#exportCount').textContent = t('exportCount', picked.size, accounts.length);
  $('#exportAll').textContent = t(picked.size === accounts.length ? 'deselectAll' : 'selectAll');
  renderCopyStatus();
  for (const b of document.querySelectorAll('[data-export]')) b.disabled = !picked.size;
}

/** "2+1" status in the export card: which copies are missing and for which keys. */
function renderCopyStatus() {
  const { appMissing, offsiteMissing, lastFileAt, complete } = copyStatus(accounts, settings);
  const el = $('#backupStatus');
  const names = (list) => list.map(title).join(', ');
  const parts = complete && accounts.length ? [t('copiesAllDone')] : [
    ...(appMissing.length ? [t('copiesStatusApp', appMissing.length, names(appMissing))] : []),
    ...(offsiteMissing.length ? [t('copiesStatusOffsite', offsiteMissing.length, names(offsiteMissing))] : []),
  ];
  parts.push(lastFileAt ? t('copiesLastFile', fmtDate(lastFileAt)) : t('copiesNoFile'));
  el.className = `small ${complete ? 'ok' : 'warn'}`;
  el.textContent = parts.join(' ');
}

const selected = () => accounts.filter((a) => picked.has(a.id));

$('#exportList').addEventListener('change', (e) => {
  const id = e.target.dataset.id;
  if (!id) return;
  e.target.checked ? picked.add(id) : picked.delete(id);
  renderExport();
});

$('#exportAll').addEventListener('click', () => {
  if (picked.size === accounts.length) picked.clear();
  else accounts.forEach((a) => picked.add(a.id));
  renderExport();
});

/** Secrets leave the app: with a password set, ask for it again. false = cancelled. */
async function confirmSecrets(okText) {
  if (!lockState.protected) return true;
  const pw = await askPassword({
    title: t('confirmPwTitle'),
    hint: t('confirmPwHint'),
    okText,
    check: (p) => verifyPassword(p).catch((x) => { throw pwError(x); }),
  });
  return pw !== null;
}

function showGoogleExport({ uris, groups, skipped }) {
  const dlg = $('#exportDialog');
  let i = 0;
  const render = () => {
    const nonSha1 = groups.flat().filter((a) => a.algorithm !== 'SHA1');
    dlg.innerHTML = `
      <h3>${esc(t('gaTitle'))}</h3>
      ${uris.length ? `
        <p class="muted">${esc(t(uris.length > 1 ? 'gaHowMany' : 'gaHowOne'))}</p>
        <div class="qr big">${qrSvg(uris[i])}</div>
        <div class="row center">
          ${uris.length > 1 ? `<button data-nav="-1" ${i === 0 ? 'disabled' : ''}>←</button>` : ''}
          <b id="gaPage">${esc(t('gaPage', i + 1, uris.length))}</b>
          ${uris.length > 1 ? `<button data-nav="1" ${i === uris.length - 1 ? 'disabled' : ''}>→</button>` : ''}
        </div>
        <p class="small">${groups[i].map((a) => esc(fullName(a))).join(', ')}</p>`
      : `<p>${esc(t('gaNone'))}</p>`}
      ${nonSha1.length ? `<p class="warn small">${esc(t('gaShaWarn', nonSha1.map((a) => title(a)).join(', ')))}</p>` : ''}
      ${skipped.length ? `<p class="err">${esc(t('gaSkipped', skipped.map((s) => t('itemReason', fullName(s.account), s.reason)).join('; ')))}</p>` : ''}
      <p class="muted small">${esc(t('gaSecretWarn'))}</p>
      <div class="row">
        <button data-png ${uris.length ? '' : 'disabled'}>${esc(t('downloadPng'))}</button>
        <div class="spacer"></div>
        <button class="primary" data-close>${esc(t('done'))}</button>
      </div>`;
  };
  dlg.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.nav) {
      i = Math.max(0, Math.min(uris.length - 1, i + Number(b.dataset.nav)));
      render();
    } else if (b.hasAttribute('data-png')) {
      const label = `AuthBackup → Google Authenticator · ${i + 1}/${uris.length}`;
      downloadBlob(await qrPngBlob(uris[i], label), `google-auth-export-${stamp()}-${i + 1}-of-${uris.length}.png`);
    } else if (b.hasAttribute('data-close')) {
      // "Done" = the user moved the keys into an app: they now have a copy outside the browser.
      if (uris.length) await markCopies(groups.flat().map((a) => a.id), 'app');
      dlg.close();
    }
  };
  dlg.addEventListener('close', () => (dlg.innerHTML = ''), { once: true }); // do not keep QR codes with secrets in the DOM
  render();
  dlg.showModal();
}

async function exportAs(kind) {
  const list = selected();
  if (!list.length) return;
  if (kind === 'encrypted') {
    const pw = lockState.protected
      ? await askPassword({
        title: t('encTitle'),
        hint: t('encHintProtected'),
        okText: t('encryptDownload'),
        check: (p) => verifyPassword(p).catch((x) => { throw pwError(x); }),
      })
      : await askPassword({
        title: t('encTitleNew'),
        hint: t('encHintNew'),
        confirm: true,
        minLength: MIN_PASSWORD,
        okText: t('encryptDownload'),
      });
    if (pw === null) return;
    const { vault } = await createVault(pw, { accounts: list });
    downloadBlob(jsonBlob({ app: 'authbackup', version: 2, exportedAt: new Date().toISOString(), count: list.length, encrypted: vault }),
      `authbackup-${stamp()}.encrypted.json`);
    await markCopies(list.map((a) => a.id), 'file');
    return toast(t('encryptedN', list.length));
  }
  if (!(await confirmSecrets(t(kind === 'google' ? 'showQr' : 'download')))) return;
  if (kind === 'google') return showGoogleExport(planMigrationExport(list));
  if (kind === 'json') {
    downloadBlob(jsonBlob({ app: 'authbackup', version: 1, exportedAt: new Date().toISOString(), accounts: list }), `authbackup-${stamp()}.json`);
  } else if (kind === 'otpauth') {
    const text = `${list.map(buildOtpauthUri).join('\n')}\n`;
    downloadBlob(new Blob([text], { type: 'text/plain' }), `authbackup-otpauth-${stamp()}.txt`);
  }
  await markCopies(list.map((a) => a.id), 'file');
  toast(t('exportedPlain', list.length));
}

$('#exportCard').addEventListener('click', (e) => {
  const kind = e.target.closest('[data-export]')?.dataset.export;
  if (kind) exportAs(kind);
});

// ---------- Restore ----------

$('#importJson').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const text = await file.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    if (/otpauth/i.test(text)) return importTexts(text); // a .txt with links goes through the preview
    return toast(t('notBackup'), 'error');
  }
  try {
    let list;
    if (data.encrypted) {
      let opened;
      const pw = await askPassword({
        title: t('backupPwTitle'),
        hint: file.name,
        okText: t('decrypt'),
        check: async (p) => {
          try {
            opened = (await openVault(p, data.encrypted)).data;
          } catch (x) {
            throw pwError(x);
          }
        },
      });
      if (pw === null) return;
      list = opened.accounts;
    } else {
      list = Array.isArray(data) ? data : data.accounts;
    }
    // Run every entry through build→parse: this also validates and normalizes the fields.
    const clean = list.map(backupEntryToAccount);
    const { added, duplicates } = await addAccounts(clean, 'backup');
    await markCopies([...added, ...duplicates].map((a) => a.id), 'file'); // all of them are in this backup file
    toast(t('restored', added.length, duplicates.length));
  } catch (err) {
    if (err instanceof LockedError) return refresh();
    toast(t('backupReadFailed', err.message), 'error');
  }
});

// ---------- Password ----------

let securityKey = '';

function lockLabel(m) {
  if (!m) return t('lockOnClose');
  return m < 60 ? t('lockAfterMin', m) : t('lockAfterHours', m / 60);
}

function renderSecurity() {
  const key = JSON.stringify([lockState.protected, lockState.lockMinutes]);
  if (key === securityKey) return; // do not wipe the form that is being filled in right now
  securityKey = key;
  const pwFields = (names) => names
    .map(([n, label, ac]) => `<label>${label}<input type="password" name="${n}" autocomplete="${ac}" required></label>`)
    .join('');
  $('#security').innerHTML = lockState.protected
    ? `
      <h2>${esc(t('secTitle'))} <span class="ok">${esc(t('secOn'))}</span></h2>
      <p class="muted">${esc(t('secOnText', DEFAULT_ITERATIONS.toLocaleString(uiLang())))}</p>
      <div class="row">
        <label>${esc(t('lockLabel'))}<select id="lockMinutes">${LOCK_OPTIONS.map((m) => `<option value="${m}" ${m === lockState.lockMinutes ? 'selected' : ''}>${lockLabel(m)}</option>`).join('')}</select></label>
        <div class="spacer"></div>
        <button id="lockNow">${esc(t('lockNow'))}</button>
        <button id="changePwBtn">${esc(t('changePw'))}</button>
        <button id="removePwBtn" class="danger">${esc(t('removePw'))}</button>
      </div>
      <form id="changePw" class="grid" hidden>
        ${pwFields([['current', t('curPw'), 'current-password'], ['pw', t('newPw'), 'new-password'], ['pw2', t('repeatNewPw'), 'new-password']])}
        <div class="wide row"><button class="primary" type="submit">${esc(t('change'))}</button><div class="err"></div></div>
      </form>`
    : `
      <h2>${esc(t('secTitle'))}</h2>
      <p class="muted">${esc(t('secOffText'))}</p>
      <form id="setPw" class="grid">
        ${pwFields([['pw', t('newPwMin', MIN_PASSWORD), 'new-password'], ['pw2', t('repeatPw'), 'new-password']])}
        <div class="row end"><button class="primary" type="submit">${esc(t('setPw'))}</button></div>
        <div class="wide err"></div>
      </form>
      <p class="warn small">${esc(t('pwWarn'))}</p>`;
}

async function submitPw(form, fn) {
  const err = form.querySelector('.err');
  const btn = form.querySelector('button[type=submit]');
  if (form.pw.value.length < MIN_PASSWORD) return (err.textContent = t('pwTooShort', MIN_PASSWORD));
  if (form.pw.value !== form.pw2.value) return (err.textContent = t('pwMismatch'));
  btn.disabled = true;
  err.textContent = t('encrypting');
  try {
    await fn();
    return true;
  } catch (x) {
    err.textContent = pwError(x).message;
  } finally {
    btn.disabled = false;
  }
}

$('#security').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'setPw' && (await submitPw(f, () => setPassword(f.pw.value)))) toast(t('pwSetDone'));
  if (f.id === 'changePw' && (await submitPw(f, () => setPassword(f.pw.value, f.current.value)))) {
    securityKey = '';
    renderSecurity();
    toast(t('pwChanged'));
  }
});

$('#security').addEventListener('click', async (e) => {
  const id = e.target.closest('button')?.id;
  if (id === 'lockNow') lock();
  if (id === 'changePwBtn') {
    $('#changePw').hidden = !$('#changePw').hidden;
    if (!$('#changePw').hidden) $('#changePw input').focus();
  }
  if (id === 'removePwBtn') {
    const pw = await askPassword({
      title: t('removePw'),
      hint: t('removePwHint'),
      okText: t('removePw'),
      check: (p) => removePassword(p).catch((x) => { throw pwError(x); }),
    });
    if (pw !== null) toast(t('pwRemoved'));
  }
});

$('#security').addEventListener('change', (e) => {
  if (e.target.id === 'lockMinutes') setLockMinutes(Number(e.target.value)).then(() => toast(t('saved')));
});

// ---------- Glue ----------

async function refresh() {
  lockState = await getLockState();
  $('#lockScreen').hidden = lockState.unlocked;
  $('#app').hidden = !lockState.unlocked;
  if (!lockState.unlocked) {
    accounts = [];
    preview = [];
    for (const d of document.querySelectorAll('dialog[open]')) d.close(); // do not leave secrets on screen
    $('#table tbody').innerHTML = '';
    securityKey = '';
    $('#unlockPw').focus();
    return;
  }
  try {
    accounts = await getAccounts();
  } catch (e) {
    if (e instanceof LockedError) return; // lock() was already called: the event will arrive and trigger a redraw
    throw e;
  }
  settings = await getSettings();
  renderTable();
  renderExport();
  renderSecurity();
  $('#storageNote').textContent = t(lockState.protected ? 'noteProtected' : 'noteOpen');
}

// Auto-lock may kick in in the middle of an action: show the password screen instead of an error.
window.addEventListener('unhandledrejection', (e) => {
  e.preventDefault();
  if (e.reason instanceof LockedError) refresh();
  else toast(e.reason?.message || String(e.reason), 'error');
});

localize();
wireUnlockForm($('#lockScreen'));
onStoreChange(() => refresh());
await refresh();
// From the popup via the "Make a backup" button: go straight to export.
if (location.hash === '#export' && !$('#exportCard').hidden) $('#exportCard').scrollIntoView({ block: 'start' });
setInterval(tick, 1000);
