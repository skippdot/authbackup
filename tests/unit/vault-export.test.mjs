import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createVault, openVault, sealWithKey, unsealWithKey, exportKey, importKey, WrongPasswordError, isVault, DEFAULT_ITERATIONS, MAX_ITERATIONS,
} from '../../extension/lib/vault.js';
import { planMigrationExport, parseMigrationUri } from '../../extension/lib/migration.js';
import { base32Encode } from '../../extension/lib/base32.js';

const FAST = 1000; // PBKDF2 iterations in tests; the extension uses 600,000

const sample = [
  { type: 'totp', issuer: 'Bücher ✉️ メール', account: 'josé@ejemplo.es', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30, counter: 0 },
];

test('vault: password encryption round trip, wrong password fails', async () => {
  const { vault } = await createVault('correct horse', { accounts: sample }, FAST);
  assert.ok(isVault(vault));
  assert.ok(!vault.ct.includes('JBSW'), 'the secret must not be visible in the ciphertext');
  const { data } = await openVault('correct horse', vault);
  assert.deepEqual(data.accounts, sample);
  await assert.rejects(openVault('wrong horse', vault), WrongPasswordError);
});

test('vault: the iteration count must be a whole number from 1 to MAX_ITERATIONS, nothing else is guessed', async () => {
  const { vault } = await createVault('correct horse', { accounts: sample }, FAST);
  const noIterations = { ...vault.kdf };
  delete noIterations.iterations;
  // A missing count meant the default 600,000, `true` and "1000" were read by Web IDL as 1 and 1000.
  const bad = [{ ...vault, kdf: noIterations }];
  for (const iterations of [true, '1000', null, 0, -1, 1.5, MAX_ITERATIONS + 1, 1e21, [1000], {}]) bad.push({ ...vault, kdf: { ...vault.kdf, iterations } });
  for (const v of bad) await assert.rejects(openVault('correct horse', v), { message: 'errVaultFormat' }, JSON.stringify(v.kdf));
  // One iteration is weak but valid; the files the extension writes keep opening.
  const { vault: one } = await createVault('correct horse', { accounts: sample }, 1);
  assert.deepEqual((await openVault('correct horse', one)).data.accounts, sample);
  assert.ok(DEFAULT_ITERATIONS <= MAX_ITERATIONS);
});

test('vault: re-encryption with a stored key: same salt, new IV, same password opens it', async () => {
  const { vault, key } = await createVault('pw-12345678', { accounts: [] }, FAST);
  const restored = await importKey(await exportKey(key)); // goes through chrome.storage.session
  const v2 = await sealWithKey(restored, vault.kdf, { accounts: sample });
  assert.equal(v2.kdf.salt, vault.kdf.salt);
  assert.notEqual(v2.iv, vault.iv);
  assert.deepEqual((await unsealWithKey(restored, v2)).accounts, sample);
  assert.deepEqual((await openVault('pw-12345678', v2)).data.accounts, sample);
});

test('vault: tampered ciphertext is detected (GCM)', async () => {
  const { vault } = await createVault('pw-12345678', { accounts: sample }, FAST);
  const bad = { ...vault, ct: (vault.ct[0] === 'A' ? 'B' : 'A') + vault.ct.slice(1) };
  await assert.rejects(openVault('pw-12345678', bad), WrongPasswordError);
});

test('GA export: split into QRs with batch fields, incompatible keys are skipped', () => {
  const accs = Array.from({ length: 23 }, (_, i) => ({
    type: i === 5 ? 'hotp' : 'totp', issuer: `Svc${i}`, account: `user${i}@example.com`,
    secret: base32Encode(Uint8Array.from({ length: 20 }, (_, j) => (i * 7 + j) & 255)),
    algorithm: ['SHA1', 'SHA256', 'SHA512'][i % 3], digits: i % 4 === 0 ? 8 : 6, period: 30, counter: i,
  }));
  accs.push({ ...accs[0], issuer: 'Steam-like', period: 60 }, { ...accs[1], issuer: 'Seven', digits: 7 });
  const { uris, skipped } = planMigrationExport(accs, { batchId: 42 });
  assert.equal(uris.length, 3);
  assert.deepEqual(skipped.map((s) => s.account.issuer), ['Steam-like', 'Seven']);
  const back = [];
  uris.forEach((u, i) => {
    assert.ok(u.length <= 1200);
    const r = parseMigrationUri(u);
    assert.deepEqual(r.batch, { index: i, size: 3, id: 42 });
    back.push(...r.accounts);
  });
  assert.equal(back.length, 23);
  for (const [i, a] of back.entries()) {
    const src = accs[i];
    for (const k of ['type', 'issuer', 'account', 'secret', 'algorithm', 'digits']) assert.equal(a[k], src[k], `${src.issuer}.${k}`);
    if (src.type === 'hotp') assert.equal(a.counter, src.counter);
  }
});
