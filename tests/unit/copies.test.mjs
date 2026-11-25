import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyStatus, withCopies, COPY_KINDS } from '../../extension/lib/copies.js';
import { interpretQrTexts } from '../../extension/lib/scan.js';
import { buildMigrationUri } from '../../extension/lib/migration.js';
import { buildOtpauthUri } from '../../extension/lib/otpauth.js';

const acc = (id) => ({ id, type: 'totp', issuer: id, account: 'a', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 });
const ids = (list) => list.map((a) => a.id);

test('copies: kinds and empty registry', () => {
  assert.deepEqual(COPY_KINDS, ['app', 'file', 'cloud']);
  assert.deepEqual(copyStatus([], {}), { appMissing: [], offsiteMissing: [], lastFileAt: null, complete: true });
});

test('copies: 2+1 rule: app AND (file OR cloud)', () => {
  const list = [acc('a'), acc('b'), acc('c'), acc('d')];
  const settings = { copies: { a: { app: 't' }, b: { app: 't', cloud: 't' }, c: { file: 't' }, d: { app: 't', file: 't' } } };
  const s = copyStatus(list, settings);
  assert.deepEqual(ids(s.appMissing), ['c']);
  assert.deepEqual(ids(s.offsiteMissing), ['a']);
  assert.equal(s.complete, false);
  assert.equal(copyStatus([acc('b'), acc('d')], settings).complete, true);
});

test('copies: old 0.3.0 marks do not count, the backup date migrates', () => {
  const s = copyStatus([acc('a')], { backedUp: { a: '2026-11-24T10:00:00Z' }, lastBackupAt: '2026-11-24T10:00:00Z' });
  assert.deepEqual(ids(s.appMissing), ['a']);
  assert.deepEqual(ids(s.offsiteMissing), ['a']);
  assert.equal(s.lastFileAt, '2026-11-24T10:00:00Z');
  assert.equal(copyStatus([], { lastBackupAt: 'old', lastFileAt: 'new' }).lastFileAt, 'new');
});

test('copies: withCopies extends, sets the file date and leaves foreign data alone', () => {
  const base = { lockMinutes: 15, copies: { a: { app: 't0' } } };
  const s1 = withCopies(base, ['a', 'b'], 'file', 't1');
  assert.deepEqual(s1.copies, { a: { app: 't0', file: 't1' }, b: { file: 't1' } });
  assert.equal(s1.lastFileAt, 't1');
  assert.equal(s1.lockMinutes, 15);
  assert.deepEqual(base.copies, { a: { app: 't0' } }, 'source object is unchanged');
  const s2 = withCopies(s1, ['b'], 'app', 't2');
  assert.deepEqual(s2.copies.b, { file: 't1', app: 't2' });
  assert.equal(s2.lastFileAt, 't1', 'an in-app copy does not move the file date');
  assert.throws(() => withCopies(base, ['a'], 'bogus'));
});

/** In-memory chrome.storage.local: only what store.js touches without a password. */
function mockChrome() {
  const data = {};
  const pick = (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
  globalThis.chrome = { storage: { local: {
    get: async (keys) => pick(keys),
    set: async (obj) => { Object.assign(data, structuredClone(obj)); },
    remove: async (keys) => { for (const k of [].concat(keys)) delete data[k]; },
  } } };
  return data;
}

test('copies: addAccounts — fromApp gives an app copy to both new and already saved keys, but is not persisted', async () => {
  const data = mockChrome();
  const { addAccounts, markCopies } = await import('../../extension/lib/store.js');
  const [x, y] = [acc('x'), acc('y')].map(({ id, ...a }) => ({ ...a, secret: id === 'x' ? 'JBSWY3DPEHPK3PXP' : 'GEZDGNBVGY3TQOJQ' }));
  const first = await addAccounts([x], 'page'); // from a page: no in-app copy
  assert.equal(data.settings?.copies?.[first.added[0].id]?.app, undefined);
  const second = await addAccounts([{ ...x, fromApp: true }, { ...y, fromApp: true }], 'page'); // GA export
  assert.equal(second.added.length, 1);
  assert.deepEqual(second.duplicates.map((a) => a.id), [first.added[0].id], 'duplicates are existing keys with an id');
  for (const a of data.accounts) {
    assert.ok(data.settings.copies[a.id].app, `${a.issuer}: app copy`);
    assert.equal('fromApp' in a, false, 'the flag does not reach the registry');
  }
  await markCopies([], 'file');
  assert.equal(data.settings.lastFileAt, undefined, 'an empty list writes nothing');
  delete globalThis.chrome;
});

test('copies: keys from a Google Authenticator export are flagged fromApp', () => {
  const list = [acc('x'), acc('y')].map(({ id, ...a }) => a);
  const fromGa = interpretQrTexts([buildMigrationUri(list)]);
  assert.equal(fromGa.accounts.length, 2);
  assert.ok(fromGa.accounts.every((a) => a.fromApp === true));
  const fromSite = interpretQrTexts([buildOtpauthUri(list[0])]);
  assert.equal(fromSite.accounts.length, 1);
  assert.equal('fromApp' in fromSite.accounts[0], false);
});
