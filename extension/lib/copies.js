// The "2+1" rule: a key should live in at least three places: this browser, another app, and a file or the cloud.
// The browser copy always exists, so only the others are tracked:
//  app   - the key is in another authenticator (AuthBackup on the phone, Google Authenticator, a password manager);
//  file  - an encrypted backup file (or JSON / otpauth.txt);
//  cloud - an encrypted cloud copy made by mobile AuthBackup (set during QR sync).
// settings.copies = { [id]: { app?, file?, cloud? } } (ISO dates), settings.lastFileAt is the date of the last file.
// ids are random and not secret, so they are stored openly in settings even with a password.
// Old 0.3.0 marks (backedUp) are not counted: their copy kind is unknown, and a false checkmark is worse than a question.

export const COPY_KINDS = ['app', 'file', 'cloud'];

/** Which keys lack which copies. settings is from getSettings(); computed over the current list. */
export function copyStatus(accounts, settings) {
  const copies = settings.copies || {};
  const has = (a, kind) => Boolean(copies[a.id]?.[kind]);
  const appMissing = accounts.filter((a) => !has(a, 'app'));
  const offsiteMissing = accounts.filter((a) => !has(a, 'file') && !has(a, 'cloud'));
  return {
    appMissing,
    offsiteMissing,
    lastFileAt: settings.lastFileAt || settings.lastBackupAt || null,
    complete: !appMissing.length && !offsiteMissing.length,
  };
}

/** New settings with kind marked for ids; the original object is not changed. */
export function withCopies(settings, ids, kind, at = new Date().toISOString()) {
  if (!COPY_KINDS.includes(kind)) throw new Error(`unknown copy kind: ${kind}`);
  const copies = { ...settings.copies };
  for (const id of ids) copies[id] = { ...copies[id], [kind]: at };
  return { ...settings, copies, ...(kind === 'file' ? { lastFileAt: at } : {}) };
}
