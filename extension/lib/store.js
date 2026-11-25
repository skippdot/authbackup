// Account registry in chrome.storage.local (this machine only, not synced).
//
// Without a password:  local.accounts = [...] in plain text.
// With a password:     local.vault = vault (lib/vault.js), no plain list.
//                     After the password is entered, the AES key lives in chrome.storage.session: browser memory
//                     (never written to disk, not accessible to content scripts, wiped when Chrome closes).
//                     Auto-lock: unlockUntil is pushed forward on every access; once it expires the key is wiped
//                     (a chrome.alarms alarm in the service worker + a check on read).
import { accountKey } from './otpauth.js';
import {
  createVault, openVault, sealWithKey, unsealWithKey, exportKey, importKey, MIN_PASSWORD,
} from './vault.js';
import { t } from './i18n.js';
import { withCopies } from './copies.js';

const KEY = 'accounts';
const VAULT = 'vault';
const SETTINGS = 'settings';
const S_KEY = 'vaultKey';
const S_UNTIL = 'unlockUntil';
const ALARM = 'autolock';
export const LOCK_OPTIONS = [5, 15, 60, 240, 0]; // minutes; 0 = until the browser closes
const DEFAULT_LOCK_MIN = 15;

export class LockedError extends Error {
  constructor() {
    super(t('lockedTitle'));
    this.name = 'LockedError';
  }
}

// ---------- Settings and session ----------

export async function getSettings() {
  const { [SETTINGS]: s = {} } = await chrome.storage.local.get(SETTINGS);
  return { lockMinutes: DEFAULT_LOCK_MIN, ...s };
}

export async function setLockMinutes(lockMinutes) {
  await chrome.storage.local.set({ [SETTINGS]: { ...(await getSettings()), lockMinutes } });
  const { [S_KEY]: k } = await chrome.storage.session.get(S_KEY);
  if (k) await touch(null, true);
}

async function touch(until, force = false) {
  const { lockMinutes } = await getSettings();
  if (!lockMinutes) {
    if (until) await chrome.storage.session.remove(S_UNTIL);
    await chrome.alarms?.clear(ALARM);
    return;
  }
  const next = Date.now() + lockMinutes * 60_000;
  if (!force && until && next - until < 30_000) return; // do not write to storage on every click
  await chrome.storage.session.set({ [S_UNTIL]: next });
  await chrome.alarms?.create(ALARM, { when: next });
}

let cached = null; // { b64, key }: do not re-import the key from base64 on every read

async function sessionKey() {
  const s = await chrome.storage.session.get([S_KEY, S_UNTIL]);
  if (!s[S_KEY]) return null;
  if (s[S_UNTIL] && Date.now() > s[S_UNTIL]) {
    await lock();
    return null;
  }
  if (cached?.b64 !== s[S_KEY]) cached = { b64: s[S_KEY], key: await importKey(s[S_KEY]) };
  await touch(s[S_UNTIL]);
  return cached.key;
}

async function rememberKey(key) {
  const b64 = await exportKey(key);
  cached = { b64, key };
  await chrome.storage.session.set({ [S_KEY]: b64 });
  await touch(null, true);
}

export async function lock() {
  cached = null;
  await chrome.storage.session.remove([S_KEY, S_UNTIL]);
  await chrome.alarms?.clear(ALARM);
}

/** { protected: whether a password is set, unlocked: whether codes can be read, lockMinutes } */
export async function getLockState() {
  const { [VAULT]: vault } = await chrome.storage.local.get(VAULT);
  const { lockMinutes } = await getSettings();
  if (!vault) return { protected: false, unlocked: true, lockMinutes };
  return { protected: true, unlocked: !!(await sessionKey()), lockMinutes };
}

// ---------- Read/write with transparent encryption ----------

async function load() {
  const { [KEY]: list = [], [VAULT]: vault } = await chrome.storage.local.get([KEY, VAULT]);
  if (!vault) return { list, vault: null, key: null };
  const key = await sessionKey();
  if (!key) throw new LockedError();
  try {
    return { list: (await unsealWithKey(key, vault)).accounts, vault, key };
  } catch {
    // the session key is stale (the password was changed in another tab): ask for the password again
    await lock();
    throw new LockedError();
  }
}

async function save(list, ctx) {
  if (ctx.vault) {
    const vault = await sealWithKey(ctx.key, ctx.vault.kdf, { accounts: list });
    await chrome.storage.local.set({ [VAULT]: vault });
  } else {
    await chrome.storage.local.set({ [KEY]: list });
  }
}

export async function getAccounts() {
  return (await load()).list;
}

// ---------- Password ----------

function checkNewPassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) throw new Error(t('pwTooShort', MIN_PASSWORD));
}

export async function unlock(password) {
  const { [VAULT]: vault } = await chrome.storage.local.get(VAULT);
  if (!vault) return;
  const { key } = await openVault(password, vault); // wrong password -> WrongPasswordError
  await rememberKey(key);
}

/** Check the password without changing state, before exporting secrets. */
export async function verifyPassword(password) {
  const { [VAULT]: vault } = await chrome.storage.local.get(VAULT);
  if (vault) await openVault(password, vault);
}

/** Set a password (current not needed) or change it (current required). */
export async function setPassword(next, current) {
  checkNewPassword(next);
  const { [KEY]: plain = [], [VAULT]: old } = await chrome.storage.local.get([KEY, VAULT]);
  const accounts = old ? (await openVault(current ?? '', old)).data.accounts : plain;
  const { vault, key } = await createVault(next, { accounts });
  await chrome.storage.local.set({ [VAULT]: vault });
  await chrome.storage.local.remove(KEY); // no longer keep a plain copy
  await rememberKey(key);
}

export async function removePassword(current) {
  const { [VAULT]: vault } = await chrome.storage.local.get(VAULT);
  if (!vault) return;
  const { data } = await openVault(current, vault);
  await chrome.storage.local.set({ [KEY]: data.accounts });
  await chrome.storage.local.remove(VAULT);
  await lock();
}

/** UI subscription to changes of the registry, password and lock state (from any tab/popup). */
// ---------- "2+1" copies ----------
// The main complaint about TOTP extensions in reviews: codes vanish on reinstall and there is no copy.
// Which copies each key has: lib/copies.js; only the recording happens here.

/** Mark that the keys ids now have a copy of kind kind ('app' | 'file' | 'cloud'). */
export async function markCopies(ids, kind) {
  if (!ids.length) return;
  await chrome.storage.local.set({ [SETTINGS]: withCopies(await getSettings(), ids, kind) });
}

export function onStoreChange(cb) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes[KEY] || changes[VAULT] || changes[SETTINGS])) cb();
    if (area === 'session' && changes[S_KEY]) cb();
  });
}

// ---------- Operations on the list ----------

/**
 * Adds accounts, skipping existing ones (same type+secret+issuer+account).
 * Returns { added: [...], duplicates: [...] }; duplicates are accounts already in the registry (with id).
 * Candidates with fromApp (from a Google Authenticator export) give an 'app' copy, to both new and already existing keys.
 */
export async function addAccounts(candidates, source) {
  const ctx = await load();
  const byKey = new Map(ctx.list.map((a) => [accountKey(a), a]));
  const added = [], duplicates = [], inApp = [];
  for (const { fromApp, ...c } of candidates) {
    const k = accountKey(c);
    let acc = byKey.get(k);
    if (acc) {
      duplicates.push(acc);
    } else {
      acc = { ...c, id: crypto.randomUUID(), source, addedAt: new Date().toISOString() };
      byKey.set(k, acc);
      ctx.list.push(acc);
      added.push(acc);
    }
    if (fromApp) inApp.push(acc.id);
  }
  if (added.length) await save(ctx.list, ctx);
  await markCopies(inApp, 'app');
  return { added, duplicates };
}

/** Which candidates are already in the registry, for the "already saved" hint in the popup. */
export async function markKnown(candidates) {
  let list = [];
  try {
    list = await getAccounts();
  } catch (e) {
    if (!(e instanceof LockedError)) throw e;
  }
  const known = new Set(list.map(accountKey));
  return candidates.map((c) => ({ ...c, known: known.has(accountKey(c)) }));
}

export async function updateAccount(id, patch) {
  const ctx = await load();
  const i = ctx.list.findIndex((a) => a.id === id);
  if (i < 0) throw new Error(t('errNoAccount'));
  ctx.list[i] = { ...ctx.list[i], ...patch, id };
  await save(ctx.list, ctx);
  return ctx.list[i];
}

export async function removeAccount(id) {
  const ctx = await load();
  await save(ctx.list.filter((a) => a.id !== id), ctx);
}

export async function moveAccount(id, delta) {
  const ctx = await load();
  const i = ctx.list.findIndex((a) => a.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ctx.list.length) return;
  [ctx.list[i], ctx.list[j]] = [ctx.list[j], ctx.list[i]];
  await save(ctx.list, ctx);
}
