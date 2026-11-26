import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base32Encode, base32Decode, bytesToHex } from '../../extension/lib/base32.js';
import { hotp, totp } from '../../extension/lib/totp.js';
import { parseOtpauthUri, buildOtpauthUri, parseAnyOtpText, backupEntryToAccount } from '../../extension/lib/otpauth.js';
import { buildMigrationUri, parseMigrationUri } from '../../extension/lib/migration.js';
import jsQR from '../../extension/vendor/jsqr.mjs';
import qrcode from '../../extension/vendor/qrcode.mjs';

const ascii = (s) => base32Encode(new TextEncoder().encode(s));

test('base32: RFC 4648 vectors and round trip', () => {
  // RFC 4648 section 10 (no padding)
  const vectors = { '': '', f: 'MY', fo: 'MZXQ', foo: 'MZXW6', foob: 'MZXW6YQ', fooba: 'MZXW6YTB', foobar: 'MZXW6YTBOI' };
  for (const [plain, enc] of Object.entries(vectors)) {
    assert.equal(base32Encode(new TextEncoder().encode(plain)), enc);
    assert.equal(new TextDecoder().decode(base32Decode(enc)), plain);
  }
  // Human input: spaces, lower case, padding
  assert.equal(bytesToHex(base32Decode('mzxw 6ytb oi======')), bytesToHex(new TextEncoder().encode('foobar')));
  assert.throws(() => base32Decode('ABC1'), /errBase32Chars/);
});

test('HOTP: RFC 4226 Appendix D', async () => {
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  const secret = ascii('12345678901234567890');
  for (let c = 0; c < expected.length; c++) {
    assert.equal(await hotp({ secret, counter: c }), expected[c], `counter=${c}`);
  }
});

test('TOTP: RFC 6238 Appendix B (SHA1/SHA256/SHA512, 8 digits)', async () => {
  const seeds = {
    SHA1: ascii('12345678901234567890'),
    SHA256: ascii('12345678901234567890123456789012'),
    SHA512: ascii('1234567890123456789012345678901234567890123456789012345678901234'),
  };
  const table = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
  ];
  for (const [t, sha1, sha256, sha512] of table) {
    for (const [algorithm, want] of [['SHA1', sha1], ['SHA256', sha256], ['SHA512', sha512]]) {
      const got = await totp({ secret: seeds[algorithm], algorithm, digits: 8, period: 30 }, t * 1000);
      assert.equal(got, want, `${algorithm} t=${t}`);
    }
  }
});

test('otpauth: issuer from the parameter and from the label, encoding, defaults', () => {
  const a = parseOtpauthUri('otpauth://totp/ACME%20Co:john.doe@email.com?secret=hxdm vjec jjws rb3h wizr 4ifu gftm xboz&issuer=ACME%20Co&algorithm=SHA1&digits=6&period=30');
  assert.deepEqual(
    { issuer: a.issuer, account: a.account, secret: a.secret, digits: a.digits, period: a.period, algorithm: a.algorithm },
    { issuer: 'ACME Co', account: 'john.doe@email.com', secret: 'HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ', digits: 6, period: 30, algorithm: 'SHA1' },
  );
  const b = parseOtpauthUri('otpauth://totp/GitHub%3Aalex?secret=JBSWY3DPEHPK3PXP');
  assert.equal(b.issuer, 'GitHub');
  assert.equal(b.account, 'alex');
  const c = parseOtpauthUri('otpauth://totp/justname?secret=JBSWY3DPEHPK3PXP&algorithm=sha256&digits=8&period=60');
  assert.deepEqual([c.issuer, c.account, c.algorithm, c.digits, c.period], ['', 'justname', 'SHA256', 8, 60]);
  assert.throws(() => parseOtpauthUri('otpauth://totp/x?secret=not*base32'), /errNoSecret/);
  // build -> parse round trip
  assert.deepEqual(parseOtpauthUri(buildOtpauthUri(c)), c);
  // A restored backup entry may lack the name fields: they stay empty instead of becoming the text "undefined".
  for (const name of [{}, { issuer: 'X' }, { account: null }]) {
    const r = parseOtpauthUri(buildOtpauthUri({ type: 'totp', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30, ...name }));
    assert.equal(r.account, '');
  }
});

test('parseAnyOtpText: text that is not an otpauth link fails with errNotOtp', () => {
  for (const text of ['hello', 'https://example.com/?secret=JBSWY3DPEHPK3PXP', 'JBSWY3DPEHPK3PXP', '', '   ', null, undefined]) {
    assert.throws(() => parseAnyOtpText(text), { name: 'Error', message: 'errNotOtp' }, String(text));
  }
  assert.equal(parseAnyOtpText('  otpauth://totp/x?secret=JBSWY3DPEHPK3PXP  ').kind, 'otpauth');
});

test('otpauth: the period must fit a 32-bit integer, as in the mobile apps', () => {
  const uri = (period) => `otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=${period}`;
  assert.equal(parseOtpauthUri(uri(2147483647)).period, 2147483647);
  for (const period of ['2147483648', '4294967296', '99999999999999999999']) {
    assert.throws(() => parseOtpauthUri(uri(period)), { message: `errPeriod: ${period}` });
  }
  // A backup entry goes through the same check.
  assert.throws(() => backupEntryToAccount({ secret: 'JBSWY3DPEHPK3PXP', period: 2 ** 31 }), { message: 'errPeriod: 2147483648' });
});

test('backupEntryToAccount: missing fields get the defaults of a link, an entry without a secret is refused', () => {
  assert.deepEqual(backupEntryToAccount({ secret: 'jbsw y3dp ehpk 3pxp', issuer: 'X', account: 'me' }), {
    type: 'totp', issuer: 'X', account: 'me', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30, counter: 0,
  });
  // Without the check the secret became the text "undefined" / "null", which is valid Base32 ("UNDEFINED", "NULL").
  for (const entry of [{}, { issuer: 'X', account: 'me' }, { secret: null, issuer: 'X' }, { secret: undefined }, null, '', { secret: '' }]) {
    assert.throws(() => backupEntryToAccount(entry), { message: 'errNoSecret' }, JSON.stringify(entry));
  }
});

test('Google Authenticator migration: encode -> decode preserves everything', () => {
  const accounts = [
    { type: 'totp', issuer: 'GitHub', account: 'alex', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30, counter: 0 },
    { type: 'totp', issuer: 'Ejemplo', account: 'josé@ejemplo.es', secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', algorithm: 'SHA256', digits: 8, period: 30, counter: 0 },
    { type: 'hotp', issuer: '', account: 'counter-based', secret: 'MFRGGZDFMZTWQ2LK', algorithm: 'SHA512', digits: 6, period: 30, counter: 42 },
  ];
  const uri = buildMigrationUri(accounts, { batchIndex: 0, batchSize: 1, batchId: 777 });
  const parsed = parseMigrationUri(uri);
  assert.deepEqual(parsed.accounts, accounts);
  assert.deepEqual(parsed.batch, { index: 0, size: 1, id: 777 });
  assert.equal(parseAnyOtpText(uri).kind, 'migration');
});

test('Real Google format: name without issuer prefix, unknown fields are skipped', () => {
  // Hand-built payload: OtpParameters{secret="Hello!\xde\xad\xbe\xef", name="alice", issuer="Example", algo=1, digits=1, type=2}
  // + unknown field 15 (varint) at the root; the decoder must ignore it.
  const params = [0x0a, 10, ...new TextEncoder().encode('Hello!'), 0xde, 0xad, 0xbe, 0xef,
    0x12, 5, ...new TextEncoder().encode('alice'),
    0x1a, 7, ...new TextEncoder().encode('Example'),
    0x20, 1, 0x28, 1, 0x30, 2];
  const payload = Uint8Array.from([0x0a, params.length, ...params, 0x10, 1, 0x78, 5]);
  const uri = `otpauth-migration://offline?data=${encodeURIComponent(btoa(String.fromCharCode(...payload)))}`;
  const [acc] = parseMigrationUri(uri).accounts;
  assert.equal(acc.secret, 'JBSWY3DPEHPK3PXP'); // "Hello!\xde\xad\xbe\xef" - classic example key
  assert.equal(acc.issuer, 'Example');
  assert.equal(acc.account, 'alice');
  assert.equal(acc.type, 'totp');
});

test('QR: generated 3-key migration QR is readable by jsQR', () => {
  const uri = buildMigrationUri([
    { type: 'totp', issuer: 'A', account: 'a@x', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6 },
    { type: 'totp', issuer: 'B', account: 'b@x', secret: 'GEZDGNBVGY3TQOJQ', algorithm: 'SHA1', digits: 6 },
    { type: 'totp', issuer: 'C', account: 'c@x', secret: 'MFRGGZDFMZTWQ2LK', algorithm: 'SHA1', digits: 6 },
  ]);
  const qr = qrcode(0, 'M');
  qr.addData(uri);
  qr.make();
  const n = qr.getModuleCount(), cell = 4, quiet = 4, size = (n + quiet * 2) * cell;
  const rgba = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!qr.isDark(r, c)) continue;
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const i = (((r + quiet) * cell + y) * size + (c + quiet) * cell + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
    }
  }
  const res = jsQR(rgba, size, size);
  assert.equal(res?.data, uri);
  assert.equal(parseMigrationUri(res.data).accounts.length, 3);
});
