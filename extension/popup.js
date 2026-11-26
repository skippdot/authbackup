import {
  getAccounts, addAccounts, markKnown, updateAccount, getLockState, lock, onStoreChange, LockedError, getSettings, markCopies,
} from './lib/store.js';
import { t, localize, pasteKeys, fmtDate } from './lib/i18n.js';
import { copyStatus } from './lib/copies.js';
import { wireUnlockForm } from './lib/lockui.js';
import { findQrTextsInBlob } from './lib/qr.js';
import { interpretQrTexts } from './lib/scan.js';
import { $, esc, formatCode, title, subtitle, badges, currentCode, hotpCode, secondsLeft, toast, copy } from './lib/ui.js';

const RING_LEN = 2 * Math.PI * 8;
const state = { accounts: [], filter: '', found: null, kbd: 0, locked: false, scanned: false, copy: copyStatus([], {}) };

// ---------- Registry ----------

function visible() {
  const q = state.filter.trim().toLowerCase();
  if (!q) return state.accounts;
  return state.accounts.filter((a) => `${a.issuer} ${a.account}`.toLowerCase().includes(q));
}

function renderList() {
  const list = $('#list');
  const items = visible();
  $('#empty').hidden = state.accounts.length > 0;
  $('#searchWrap').hidden = state.accounts.length < 5;
  state.kbd = Math.min(state.kbd, Math.max(0, items.length - 1));
  list.innerHTML = items
    .map((a, i) => `
      <li data-id="${a.id}" class="${state.filter && i === state.kbd ? 'kbd' : ''}" title="${esc(t('copyHint'))}">
        <div class="names">
          <div class="t">${esc(title(a))}</div>
          <div class="s">${esc(subtitle(a))}${badges(a).map((b) => `<span class="badge">${esc(b)}</span>`).join('')}</div>
        </div>
        <span class="code ${a.type === 'hotp' ? 'hotp' : ''}">${a.type === 'hotp' ? esc(t('hotpNext')) : ''}</span>
        ${a.type === 'hotp' ? '' : `<svg class="ring" viewBox="0 0 22 22"><circle class="bg" cx="11" cy="11" r="8"/><circle class="fg" cx="11" cy="11" r="8" stroke-dasharray="${RING_LEN}"/></svg>`}
      </li>`)
    .join('');
  tick();
}

/** Once a second: codes and rings. HMAC is cheap and keys are cached, so recomputing the whole list is fine. */
async function tick() {
  const now = Date.now();
  for (const li of document.querySelectorAll('#list li')) {
    const a = state.accounts.find((x) => x.id === li.dataset.id);
    if (!a || a.type === 'hotp') continue;
    const left = secondsLeft(a.period, now);
    const expiring = left <= 5;
    const codeEl = li.querySelector('.code');
    const code = formatCode(await currentCode(a, now));
    if (codeEl.textContent !== code) codeEl.textContent = code;
    codeEl.classList.toggle('expiring', expiring);
    const ring = li.querySelector('.ring');
    ring.classList.toggle('expiring', expiring);
    ring.querySelector('.fg').style.strokeDashoffset = String(RING_LEN * (1 - left / a.period));
  }
}

async function copyAccount(id) {
  const a = state.accounts.find((x) => x.id === id);
  if (!a) return;
  let code;
  if (a.type === 'hotp') {
    // In HOTP every code is single-use: return the code for the current counter and advance the counter.
    code = await hotpCode(a);
    await updateAccount(a.id, { counter: (a.counter || 0) + 1 });
  } else {
    // If the code changes in under 3 s, return the next one, otherwise it expires before it is pasted.
    const now = Date.now();
    code = await currentCode(a, secondsLeft(a.period, now) < 3 ? now + 3000 : now);
  }
  await copy(code);
  const li = document.querySelector(`#list li[data-id="${id}"]`);
  if (li) {
    if (a.type === 'hotp') li.querySelector('.code').textContent = formatCode(code);
    li.classList.add('copied');
    setTimeout(() => li.classList.remove('copied'), 900);
  }
  toast(t('copied', formatCode(code)));
}

// ---------- Found (page scan / paste) ----------

function renderFound() {
  const box = $('#found');
  const f = state.found;
  if (!f) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  if (f.status) {
    box.innerHTML = `<div class="status">${esc(f.status)}</div>`;
    return;
  }
  const fresh = f.accounts.filter((a) => !a.known);
  const head = f.accounts.length
    ? `<div class="head"><b>${esc(t(f.source === 'paste' ? 'foundInClipboard' : 'foundOnPage', f.accounts.length))}</b>
        ${fresh.length > 1 ? `<button class="primary" data-save-all>${esc(t('saveAll', fresh.length))}</button>` : ''}
        <button data-close title="${esc(t('hide'))}">✕</button></div>`
    : `<div class="head"><b>${esc(t('noTotpQr'))}</b><button data-close title="${esc(t('hide'))}">✕</button></div>`;
  const rows = f.accounts
    .map((a, i) => `
      <div class="item">
        <div class="names">
          <div><b>${esc(title(a))}</b>${badges(a).map((b) => `<span class="badge">${esc(b)}</span>`).join('')}</div>
          <div class="muted">${esc(subtitle(a))}</div>
        </div>
        ${a.known ? `<span class="known">${esc(t('alreadySaved'))}</span>`
          : `<button class="primary" data-save="${i}" title="${esc(t('saveAndCopyTitle'))}">${esc(t('saveAndCopy'))}</button>`}
      </div>`)
    .join('');
  const notes = [
    ...f.skipped.map((s) => t('skippedItem', s.name, s.reason)),
    ...f.errors,
    ...(f.otherQr.length ? [t('otherQr', f.otherQr.map((x) => x.slice(0, 40)).join(', '))] : []),
    ...(!f.accounts.length && !f.otherQr.length && !f.errors.length
      ? [t('scrollHint', pasteKeys())] : []),
  ];
  box.innerHTML = head + rows + notes.map((n) => `<div class="err">${esc(n)}</div>`).join('');
}

async function saveFound(indexes) {
  const f = state.found;
  const picked = indexes.map((i) => f.accounts[i]).filter((a) => a && !a.known);
  // Keys already saved from a Google Authenticator export are returned too: addAccounts marks that they exist in the app.
  const seenInApp = f.accounts.filter((a) => a.known && a.fromApp);
  const { added } = await addAccounts([...picked, ...seenInApp].map(({ known, ...a }) => a), f.source);
  for (const i of indexes) if (f.accounts[i]) f.accounts[i].known = true;
  renderFound();
  if (added.length === 1) {
    // 2FA was just set up and the site will ask for a code right away: put it on the clipboard.
    const code = await currentCode(added[0]);
    if (code) {
      await copy(code);
      toast(t('savedCodeCopied', formatCode(code)));
      return;
    }
  }
  toast(t('savedN', added.length));
}

async function targetTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function scanPage({ manual }) {
  if (manual) {
    state.found = { status: t('scanning') };
    renderFound();
  }
  const tab = await targetTab();
  const resp = await chrome.runtime.sendMessage({ type: 'scan', tabId: tab.id, windowId: tab.windowId, fullScan: manual });
  if (!resp?.ok) {
    if (manual) {
      state.found = { status: t('captureFailed', resp?.error || t('noResponse')) };
      renderFound();
    }
    return;
  }
  const r = resp.result;
  // The auto-scan on open stays silent if it finds nothing, so it does not get in the way of copying codes.
  if (!manual && !r.accounts.length) return;
  state.found = { ...r, source: 'page' };
  renderFound();
}

async function handlePaste(e) {
  const items = [...(e.clipboardData?.items || [])];
  const image = items.find((it) => it.type.startsWith('image/'));
  let r;
  if (image) {
    r = interpretQrTexts(await findQrTextsInBlob(image.getAsFile()));
  } else {
    const text = e.clipboardData.getData('text');
    if (!/^\s*otpauth/i.test(text)) return; // plain paste into the search field
    r = interpretQrTexts([text.trim()]);
  }
  e.preventDefault();
  r.accounts = await markKnown(r.accounts);
  state.found = { ...r, source: 'paste' };
  renderFound();
}

// ---------- Backup reminder ----------

/** "2+1" card: expanded while some copies are missing; a single line once everything is present. */
function renderCopies() {
  const s = state.copy;
  const any = state.accounts.length > 0;
  $('#copies').hidden = !any || s.complete;
  $('#copiesDone').hidden = !any || !s.complete;
  if (!any) return;
  if (s.complete) {
    $('#copiesDone').textContent = s.lastFileAt ? t('copiesDone', fmtDate(s.lastFileAt)) : t('copiesDoneNoFile');
    return;
  }
  const row = (sel, missing, text) => {
    const el = $(sel);
    el.classList.toggle('ok', !missing);
    el.querySelector('.mark').textContent = missing ? '○' : '✓';
    el.querySelector('.txt').textContent = text;
  };
  const app = s.appMissing.length, file = s.offsiteMissing.length;
  row('#rowApp', app, app ? t('copyAppMissing', app) : t('copyAppOk'));
  row('#rowFile', file, file ? t('copyFileMissing', file) : t('copyFileOk'));
}

const openExport = () => chrome.tabs.create({ url: chrome.runtime.getURL('manage.html#export') });
$('#copyApp').addEventListener('click', openExport);
$('#copyFile').addEventListener('click', openExport);
$('#copiesDone').addEventListener('click', openExport);
$('#copyAppHave').addEventListener('click', () => guarded(() => markCopies(state.copy.appMissing.map((a) => a.id), 'app')));

// ---------- Glue ----------

function showLocked(locked) {
  state.locked = locked;
  $('#lock').hidden = !locked;
  $('#main').hidden = locked;
  $('#scan').disabled = locked;
  if (locked) {
    state.accounts = [];
    state.found = null;
    $('#list').innerHTML = '';
    $('#unlockPw').focus();
  }
}

/** Re-read the state: whether the registry is locked and, if not, the list. Called on any storage change. */
async function refresh() {
  const ls = await getLockState();
  $('#lockBtn').hidden = !(ls.protected && ls.unlocked);
  if (!ls.unlocked) return showLocked(true);
  const wasLocked = state.locked;
  try {
    state.accounts = await getAccounts();
  } catch (e) {
    if (e instanceof LockedError) return showLocked(true);
    throw e;
  }
  state.copy = copyStatus(state.accounts, await getSettings());
  showLocked(false);
  renderList();
  renderCopies();
  if (wasLocked) $('#search').focus();
  if (!state.scanned) {
    // auto-scan the page only when the registry is unlocked, otherwise there is nothing to mark "already saved" with
    state.scanned = true;
    scanPage({ manual: false }).catch(() => {});
  }
}

/** An action on the registry that may fail because of auto-lock in the middle of the work. */
async function guarded(fn) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof LockedError) return refresh();
    toast(e.message, 'error');
  }
}

$('#list').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (li) guarded(() => copyAccount(li.dataset.id));
});

$('#found').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.hasAttribute('data-close')) {
    state.found = null;
    renderFound();
  } else if (btn.hasAttribute('data-save-all')) {
    guarded(() => saveFound(state.found.accounts.map((_, i) => i)));
  } else if (btn.dataset.save !== undefined) {
    guarded(() => saveFound([Number(btn.dataset.save)]));
  }
});

$('#search').addEventListener('input', (e) => {
  state.filter = e.target.value;
  state.kbd = 0;
  renderList();
});

$('#search').addEventListener('keydown', (e) => {
  const items = visible();
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    state.kbd = Math.max(0, Math.min(items.length - 1, state.kbd + (e.key === 'ArrowDown' ? 1 : -1)));
    e.preventDefault();
    renderList();
  } else if (e.key === 'Enter' && items[state.kbd]) {
    guarded(() => copyAccount(items[state.kbd].id));
  }
});

$('#scan').addEventListener('click', () => scanPage({ manual: true }));
$('#manage').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('#lockBtn').addEventListener('click', () => lock());
document.addEventListener('paste', (e) => {
  if (!state.locked) guarded(() => handlePaste(e));
});
localize();
wireUnlockForm($('#lock'));
onStoreChange(() => refresh());

await refresh();
setInterval(tick, 1000);
if (!state.locked) $('#search').focus(); // the field is shown from 5 accounts: you can type a name right away and press Enter
