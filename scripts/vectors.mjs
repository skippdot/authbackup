// Conformance vectors for the mobile apps. The extension's JS core is the source of truth: every other implementation
// (ios/Core and android/core) must reproduce these results exactly, the same way tests/crosscheck.mjs pins the
// extension against the Python reference. `npm run vectors` rewrites tests/vectors/core.json, and
// tests/unit/vectors.test.mjs fails when the file no longer matches the JS core.
//
// Errors are recorded as the message key (`errNoSecret`, `wrongPassword`, ...): in Node, t() returns the key. Errors
// that do not come from AuthBackup itself (an unparsable URL, a broken %-escape, invalid Base64) are recorded as "other".
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { base32Encode, base32Decode, isValidBase32, bytesToHex, bytesToBase64, base64ToBytes } from '../extension/lib/base32.js';
import { hotp, totp } from '../extension/lib/totp.js';
import { parseOtpauthUri, buildOtpauthUri, parseAnyOtpText, accountKey, backupEntryToAccount } from '../extension/lib/otpauth.js';
import { parseMigrationUri, buildMigrationUri, planMigrationExport } from '../extension/lib/migration.js';
import { deriveKey, exportKey, openVault, DEFAULT_ITERATIONS, MAX_ITERATIONS } from '../extension/lib/vault.js';

export const VECTORS_PATH = fileURLToPath(new URL('../tests/vectors/core.json', import.meta.url));

/** mulberry32: a seeded generator, so the file is the same on every run (test data only, never key material). */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const KNOWN_ERROR = /^(err[A-Z]\w*|wrongPassword)$/;
const messageKey = (msg) => String(msg ?? '').split(':')[0];
const errorKey = (e) => (KNOWN_ERROR.test(messageKey(e?.message)) ? messageKey(e.message) : 'other');

function outcome(fn) {
  try {
    return { result: fn() };
  } catch (e) {
    return { error: errorKey(e) };
  }
}

const ascii = (s) => base32Encode(new TextEncoder().encode(s));
const hex = (bytes) => bytesToHex(bytes);

function base32Vectors(rnd) {
  const encode = [];
  for (const s of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) encode.push({ hex: hex(new TextEncoder().encode(s)), base32: ascii(s) });
  for (let i = 0; i < 40; i++) {
    const bytes = Uint8Array.from({ length: Math.floor(rnd() * 41) }, () => Math.floor(rnd() * 256));
    encode.push({ hex: hex(bytes), base32: base32Encode(bytes) });
  }
  const inputs = [
    'MZXW6YTBOI', 'mzxw 6ytb oi======', 'MZXW-6YTB-OI', 'JBSWY3DPEHPK3PXP', 'JBSWY3DPEHPK3PX', 'A', 'AB', '', '  ',
    'ABC1', 'AB C8', 'ABCDÉ', 'abc\tdef', 'ABC=DEF', 'ABCD====EFG', '22222222', '77777777', 'AAAAAAAAB',
  ];
  return {
    encode,
    decode: inputs.map((input) => ({ input, ...outcome(() => hex(base32Decode(input))) })),
    valid: inputs.map((input) => ({ input, valid: isValidBase32(input) })),
  };
}

async function otpVectors(rnd) {
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const totpCases = [];
  // RFC 6238 Appendix B (the seeds are ASCII, of the hash's length) and edges of 32-bit time.
  const rfcSeeds = { SHA1: '12345678901234567890', SHA256: '12345678901234567890123456789012', SHA512: '1234567890123456789012345678901234567890123456789012345678901234' };
  for (const at of [59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000]) {
    for (const [algorithm, seed] of Object.entries(rfcSeeds)) totpCases.push({ secret: ascii(seed), algorithm, digits: 8, period: 30, at });
  }
  for (const at of [0, 29, 30, 2 ** 31 - 1, 2 ** 31, 2 ** 32, 4102444800]) totpCases.push({ secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30, at });
  for (let i = 0; i < 240; i++) {
    const bytes = Uint8Array.from({ length: pick([1, 5, 10, 16, 20, 32, 64]) }, () => Math.floor(rnd() * 256));
    let secret = base32Encode(bytes);
    if (rnd() < 0.2 && secret.length > 2) secret = secret.slice(0, -1); // a length that leaves spare bits
    totpCases.push({ secret, algorithm: pick(['SHA1', 'SHA256', 'SHA512']), digits: pick([6, 7, 8]), period: pick([15, 30, 60, 90]), at: Math.floor(rnd() * 4e9) });
  }
  for (const c of totpCases) c.code = await totp(c, c.at * 1000);

  const hotpCases = [];
  const rfc4226 = ascii('12345678901234567890');
  for (let counter = 0; counter < 10; counter++) hotpCases.push({ secret: rfc4226, algorithm: 'SHA1', digits: 6, counter });
  for (const counter of [2 ** 31, 2 ** 32, 2 ** 32 + 1, 2 ** 53 - 1]) hotpCases.push({ secret: rfc4226, algorithm: 'SHA1', digits: 6, counter });
  for (let i = 0; i < 40; i++) {
    const bytes = Uint8Array.from({ length: pick([10, 20, 32]) }, () => Math.floor(rnd() * 256));
    hotpCases.push({ secret: base32Encode(bytes), algorithm: pick(['SHA1', 'SHA256', 'SHA512']), digits: pick([6, 7, 8]), counter: Math.floor(rnd() * 2 ** 40) });
  }
  for (const c of hotpCases) c.code = await hotp(c);
  return { totp: totpCases, hotp: hotpCases };
}

const S = 'JBSWY3DPEHPK3PXP';
const OTPAUTH_URIS = [
  `otpauth://totp/Example:alice@example.com?secret=${S}&issuer=Example`,
  `otpauth://totp/alice@example.com?secret=${S}`,
  `otpauth://totp/Example%3Aalice?secret=${S}`,
  `otpauth://totp/Example:alice?secret=${S}&issuer=Other`,
  `otpauth://totp/A:B:alice?secret=${S}&issuer=A:B`,
  `otpauth://totp/A:B:alice?secret=${S}`,
  `otpauth://TOTP/x?secret=${S}`,
  `OTPAUTH://totp/x?secret=${S}`,
  `otpauth://hotp/x?secret=${S}&counter=42`,
  `otpauth://hotp/x?secret=${S}`,
  `otpauth://hotp/x?secret=${S}&counter=-1`,
  `otpauth://hotp/x?secret=${S}&counter=1.5`,
  `otpauth://hotp/x?secret=${S}&counter=9007199254740991`,
  `otpauth://hotp/x?secret=${S}&counter=9007199254740993`,
  `otpauth://hotp/x?secret=${S}&counter=abc`,
  `otpauth://totp/x?secret=${S}&digits=7`,
  `otpauth://totp/x?secret=${S}&digits=8`,
  `otpauth://totp/x?secret=${S}&digits=9`,
  `otpauth://totp/x?secret=${S}&digits=6abc`,
  `otpauth://totp/x?secret=${S}&digits=`,
  `otpauth://totp/x?secret=${S}&digits=%206`,
  `otpauth://totp/x?secret=${S}&digits=+8`,
  `otpauth://totp/x?secret=${S}&period=60`,
  `otpauth://totp/x?secret=${S}&period=0`,
  `otpauth://totp/x?secret=${S}&period=-30`,
  `otpauth://totp/x?secret=${S}&period=30s`,
  `otpauth://totp/x?secret=${S}&period=`,
  `otpauth://totp/x?secret=${S}&period=0x10`,
  `otpauth://totp/x?secret=${S}&period=2147483647`,
  `otpauth://totp/x?secret=${S}&period=2147483648`,
  `otpauth://totp/x?secret=${S}&period=99999999999999999999`,
  `otpauth://totp/x?secret=${S}&algorithm=sha256`,
  `otpauth://totp/x?secret=${S}&algorithm=SHA-512`,
  `otpauth://totp/x?secret=${S}&algorithm=MD5`,
  `otpauth://totp/x?secret=${S}&algorithm=`,
  `otpauth://totp/x?secret=jbsw%20y3dp-ehpk3pxp`,
  `otpauth://totp/x?secret=JBSWY3DPEHPK3PXP====`,
  `otpauth://totp/x?secret=JBSW+Y3DP`,
  `otpauth://totp/x?secret=`,
  'otpauth://totp/x?issuer=NoSecret',
  'otpauth://totp/x?secret=A',
  'otpauth://totp/x?secret=JBSW1Y3DP',
  `otpauth://totp/x?secret=${S}&secret=AAAAAAAA`,
  `http://totp/x?secret=${S}`,
  `otpauth-migration://offline?data=CgA%3D`,
  `otpauth://steam/x?secret=${S}`,
  `otpauth:totp/x?secret=${S}`,
  `otpauth:///x?secret=${S}`,
  `otpauth://totp/Big%20Corp:me?secret=${S}&issuer=Big+Corp`,
  `otpauth://totp/Big Corp:me?secret=${S}&issuer=Big%20Corp`,
  `otpauth://totp/x?secret=${S}&issuer=A%2BB`,
  `otpauth://totp/Caf%C3%A9:z%C3%BC?secret=${S}`,
  `otpauth://totp/Café:zü?secret=${S}&issuer=Café`,
  `otpauth://totp/%F0%9F%94%91:emoji?secret=${S}`,
  `otpauth://totp/bad%E0%A4%A:me?secret=${S}`,
  `otpauth://totp/100%:me?secret=${S}`,
  `otpauth://totp/x?secret=${S}&issuer=100%`,
  `otpauth://totp/x?secret=${S}&issuer=%E0%A4%A`,
  `otpauth://totp/Acme/Sub:me?secret=${S}`,
  `otpauth://totp/../Acme:me?secret=${S}`,
  `otpauth://totp/a/./b/../c:me?secret=${S}`,
  `otpauth://totp/a/%2e%2E/c:me?secret=${S}`,
  `otpauth://totp/Acme:me?secret=${S}#fragment`,
  `otpauth://totp/Acme:me#frag?secret=${S}`,
  `  otpauth://totp/Acme:me?secret=${S}  `,
  `otpauth://totp/Ac\tme:me?secret=${S}`,
  `otpauth://totp/Ac\nme:me?sec\nret=${S}`,
  `otpauth://totp:443/Acme:me?secret=${S}`,
  `otpauth://user:pass@totp/Acme:me?secret=${S}`,
  `otpauth://to tp/Acme:me?secret=${S}`,
  `otpauth://totp:99999/Acme:me?secret=${S}`,
  `otpauth://totp:x/Acme:me?secret=${S}`,
  `otpauth://totp?secret=${S}`,
  `otpauth://totp/?secret=${S}&issuer=OnlyIssuer`,
  `otpauth://totp/%20Acme%20:%20me%20?secret=${S}`,
  `otpauth://totp/Acme:me?secret=${S}&issuer=%20%20`,
  `otpauth://totp/x?secret=${S}&issuer=%C2%A0Spaced%EF%BB%BF`,
  `otpauth://totp/x?secret=${S}&&issuer=Empty&=v&k`,
  `otpauth://totp/x?SECRET=${S}`,
  `otpauth://totp/Acme:me?secret=${S}&image=https%3A%2F%2Fexample.com%2Fa.png`,
];

const ACCOUNTS = [
  { type: 'totp', issuer: 'Example', account: 'alice@example.com', secret: S, algorithm: 'SHA1', digits: 6, period: 30, counter: 0 },
  { type: 'totp', issuer: '', account: 'bob', secret: 'GEZDGNBVGY3TQOJQ', algorithm: 'SHA256', digits: 8, period: 60, counter: 0 },
  { type: 'hotp', issuer: 'Bank & Co', account: 'c.d+tag@mail', secret: 'MFRGGZDFMZTWQ2LK', algorithm: 'SHA512', digits: 6, period: 30, counter: 7 },
  { type: 'totp', issuer: 'Café: Ünïcødé', account: 'zoë / ü', secret: 'KRSXG5CTMVRXEZLU', algorithm: 'SHA1', digits: 7, period: 30, counter: 0 },
  { type: 'totp', issuer: "it's (ok) *~!", account: 'a b  c', secret: 'ONSWG4TFOQ', algorithm: 'SHA1', digits: 6, period: 15, counter: 0 },
  { type: 'totp', issuer: 'Emoji 🔑', account: '', secret: 'NB2HI4DTHIXS6', algorithm: 'SHA1', digits: 6, period: 30, counter: 0 },
];

/** Text from a QR or the clipboard: only the kind is recorded, the parsed content is covered by parse and migration. */
const ANY_TEXTS = [
  `otpauth://totp/x?secret=${S}`,
  `  OTPAUTH://totp/x?secret=${S}  `,
  'otpauth-migration://offline?data=CgA%3D',
  'otpauth://totp/x',
  'hello',
  `https://example.com/?secret=${S}`,
  S,
  '',
  '   ',
];

function otpauthVectors() {
  return {
    parse: OTPAUTH_URIS.map((uri) => ({ uri, ...outcome(() => parseOtpauthUri(uri)) })),
    build: ACCOUNTS.map((account) => ({ account, uri: buildOtpauthUri(account) })),
    any: ANY_TEXTS.map((text) => ({ text, ...outcome(() => parseAnyOtpText(text).kind) })),
  };
}

/** Hand-made protobuf payloads that the encoder never produces: damage, unknown fields, unsupported algorithms. */
function rawMigrationPayloads() {
  const varint = (v) => {
    let x = BigInt(v);
    const out = [];
    do {
      let b = Number(x & 0x7fn);
      x >>= 7n;
      if (x > 0n) b |= 0x80;
      out.push(b);
    } while (x > 0n);
    return out;
  };
  const fv = (f, v) => [...varint((f << 3) | 0), ...varint(v)];
  const fb = (f, bytes) => [...varint((f << 3) | 2), ...varint(bytes.length), ...bytes];
  const str = (s) => [...new TextEncoder().encode(s)];
  const secret = [...base32Decode(S)];
  const params = (...fields) => fb(1, fields.flat());
  const uri = (bytes) => `otpauth-migration://offline?data=${encodeURIComponent(bytesToBase64(Uint8Array.from(bytes)))}`;
  return [
    uri([...params(fb(1, secret), fb(2, str('Acme:me')), fb(3, str('Acme')), fv(4, 4), fv(5, 1), fv(6, 2)), ...fv(2, 1)]), // MD5
    uri([...params(fb(2, str('no secret')), fv(6, 2)), ...fv(2, 1)]),
    uri([...params(fb(1, secret), fb(2, str('big')), fv(6, 1), fv(7, 2n ** 60n)), ...fv(2, 1)]), // counter beyond 2^53
    uri([...params(fb(1, secret), fb(2, str('hotp')), fv(6, 1), fv(7, 99)), ...fv(2, 1)]),
    uri([...params(fb(1, secret), fb(2, str('types')), fv(4, 0), fv(5, 0), fv(6, 0)), ...fv(2, 1)]), // unspecified enums
    uri([...params(fb(1, secret), fb(2, str('weird')), fv(4, 9), fv(5, 7), fv(6, 5)), ...fv(2, 1)]), // unknown enum values
    uri([...params(fb(1, secret), fb(2, str('Other:me')), fb(3, str('Acme')), fv(5, 2)), ...fv(2, 1)]),
    uri([...params(fb(1, secret), fb(3, str('OnlyIssuer'))), ...fv(2, 1)]),
    uri([...params(fb(1, secret)), ...fv(2, 1)]),
    uri([...params(fb(1, secret), fb(2, str('x')), fb(15, str('unknown')), fv(14, 5), [0x69, 1, 2, 3, 4], [0x61, 1, 2, 3, 4, 5, 6, 7, 8]), ...fb(9, str('also unknown')), ...fv(2, 1), ...fv(3, 4), ...fv(4, 2), ...fv(5, 123456789)]),
    uri([...params(fb(1, secret), fb(2, str('wire3'))), 0x0b]), // wire type 3 (start group)
    uri([...params(fb(1, secret), fb(2, str('cut')))].slice(0, -2)), // truncated
    uri([0x08, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]), // varint longer than 10 bytes
    uri([0x0a, 0x7f, 0x01]), // length past the end
    uri([...params(fb(1, secret), fb(2, [0xff, 0xfe, 0x41]))]), // invalid UTF-8 in the name
    uri([]),
  ];
}

function migrationVectors() {
  const built = [
    buildMigrationUri(ACCOUNTS.filter((a) => a.digits !== 7)),
    buildMigrationUri([ACCOUNTS[0]], { batchIndex: 1, batchSize: 3, batchId: 2 ** 31 - 1 }),
  ];
  const base = buildMigrationUri([ACCOUNTS[0], ACCOUNTS[2]]);
  const data = new URL(base).searchParams.get('data');
  const urlSafe = data.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const uris = [
    ...built,
    ...rawMigrationPayloads(),
    `otpauth-migration://offline?data=${urlSafe}`,
    `otpauth-migration://offline?data=${data}`, // "+" not escaped: URLSearchParams reads it as a space
    `otpauth-migration://offline?data=${encodeURIComponent(data)}&data=AAAA`,
    'otpauth-migration://offline?data=',
    'otpauth-migration://offline',
    'otpauth-migration://offline?data=%%%',
    'otpauth-migration://offline?data=A',
    'otpauth-migration://offline?data=QQ%3D%3D%3D',
    'otpauth-migration://offline?data=QR%3D%3D',
    `otpauth://offline?data=${encodeURIComponent(data)}`,
    `OTPAUTH-MIGRATION://OFFLINE?data=${encodeURIComponent(data)}`,
    ` otpauth-migration://offline?data=${encodeURIComponent(data)} `,
  ];
  const parse = uris.map((uri) => ({
    uri,
    ...outcome(() => {
      const r = parseMigrationUri(uri);
      return { accounts: r.accounts, skipped: r.skipped.map((s) => ({ name: s.name, reason: messageKey(s.reason) })), batch: r.batch };
    }),
  }));
  const buildCases = [
    { accounts: ACCOUNTS.filter((a) => a.digits !== 7), options: {} },
    { accounts: [ACCOUNTS[1]], options: { batchIndex: 2, batchSize: 5, batchId: 77 } },
    { accounts: [], options: { batchId: 1 } },
  ].map((c) => ({ ...c, uri: buildMigrationUri(c.accounts, c.options) }));

  const many = [];
  for (let i = 0; i < 27; i++) {
    many.push({
      type: i % 9 === 4 ? 'hotp' : 'totp', issuer: `Service ${i}`, account: `user${i}@example.com`,
      secret: base32Encode(Uint8Array.from({ length: i % 5 === 0 ? 64 : 20 }, (_, j) => (i * 31 + j * 7) & 0xff)),
      algorithm: ['SHA1', 'SHA256', 'SHA512'][i % 3], digits: i === 6 ? 7 : i % 4 === 0 ? 8 : 6, period: i === 11 ? 60 : 30, counter: i,
    });
  }
  const plan = [
    { accounts: many, options: { batchId: 424242 } },
    { accounts: many.slice(0, 5), options: { batchId: 1, maxPerQr: 2 } },
    { accounts: many, options: { batchId: 9, maxUriLength: 300 } },
  ].map((c) => {
    const r = planMigrationExport(c.accounts, c.options);
    return { ...c, uris: r.uris, skipped: r.skipped.map((s) => ({ index: c.accounts.indexOf(s.account), reason: messageKey(s.reason) })) };
  });
  return { parse, build: buildCases, plan };
}

function accountKeyVectors() {
  const cases = [
    ...ACCOUNTS,
    { type: 'totp', issuer: 'EXAMPLE', account: 'Alice@Example.com', secret: 'jbsw y3dp-ehpk3pxp', algorithm: 'SHA1', digits: 6, period: 30 },
    { type: 'totp', issuer: 'ΣΑΣ', account: 'İstanbul ẞ', secret: S },
    { type: 'totp', secret: S },
  ];
  return cases.map((account) => ({ account, key: accountKey(account) }));
}

function restoreVectors() {
  const entries = [
    { secret: S },
    { secret: 'jbsw y3dp', issuer: ' Spaced ', account: ' me ' },
    { type: 'hotp', secret: S, counter: 5, issuer: 'H', account: 'h' },
    { type: 'totp', secret: S, digits: 8, period: 60, algorithm: 'SHA512', id: 'x', source: 'qr', addedAt: '2026-01-01T00:00:00.000Z' },
    { secret: S, issuer: 'A:B', account: 'c:d' },
    { secret: S, digits: 9 },
    { secret: S, algorithm: 'MD5' },
    { secret: 'not base32!' },
    { secret: S, type: 'steam' },
    { secret: S, period: 0 },
    { secret: S, digits: '8' },
    { secret: S, issuer: '100%', account: 'a&b=c' },
    {},
    { issuer: 'NoSecret', account: 'me' },
    { secret: null, issuer: 'NullSecret' },
    { secret: '' },
    null,
    { secret: S, period: 2147483647 },
    { secret: S, period: 2147483648 },
    // The type is not written into the link unless it is totp or hotp, in any letter case.
    { secret: S, type: 'totp?secret=AAAAAAAA&' },
    { secret: S, type: 'hotp/x?secret=AAAAAAAA&counter=9#' },
    { secret: S, type: ' totp' },
    { secret: S, type: '' },
    { secret: S, type: null },
    { secret: S, type: 1 },
    { secret: S, type: ['totp'] },
    { secret: S, type: 'TOTP', period: 60 },
    { secret: S, type: 'HOTP', counter: 5 },
    { secret: S, type: 'Hotp' },
    // Numbers are whole JSON numbers and the secret a string: nothing goes through String() and parseInt.
    { secret: S, period: 1e21 },
    { secret: S, period: 30.5 },
    { secret: S, period: '60' },
    { secret: S, period: null },
    { secret: S, period: true },
    { secret: S, period: -30 },
    { secret: S, type: 'hotp', counter: 1e21 },
    { secret: S, type: 'hotp', counter: 2 ** 53 },
    { secret: S, type: 'hotp', counter: 2 ** 53 - 1 },
    { secret: S, type: 'hotp', counter: 1.5 },
    { secret: S, type: 'hotp', counter: '5' },
    { secret: S, type: 'hotp', counter: null },
    { secret: S, type: 'hotp', counter: -1 },
    { secret: S, type: 'hotp', counter: 0 },
    { secret: S, digits: 6.9 },
    { secret: S, digits: 1e21 },
    { secret: S, digits: null },
    { secret: S, digits: true },
    { secret: S, digits: 8 },
    { secret: true },
    { secret: 22222222 },
    { secret: [S] },
    { secret: { value: S } },
    { secret: S, algorithm: ['SHA1'] },
    { secret: S, algorithm: null },
    { secret: S, algorithm: 'sha-256' },
    // A field that the key does not use is not read, as in a link.
    { secret: S, type: 'hotp', period: 'x' },
    { secret: S, counter: 'x' },
    // Labels are still read as text.
    { secret: S, issuer: 12345, account: 0.5 },
  ];
  return entries.map((entry) => ({ entry, ...outcome(() => backupEntryToAccount(entry)) }));
}

/** sealWithKey with a fixed IV (vault.js draws the IV at random), checked below by the real openVault. */
async function sealFixed(key, kdf, data, iv) {
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  return { v: 1, kdf, iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
}

async function backupVectors(rnd) {
  const bytes = (n) => Uint8Array.from({ length: n }, () => Math.floor(rnd() * 256));
  const accounts = ACCOUNTS.map((a, i) => ({ ...a, id: `id-${i}`, source: 'qr', addedAt: '2026-11-25T12:00:00.000Z' }));
  const files = [];
  for (const [password, iterations] of [['correct horse battery staple', DEFAULT_ITERATIONS], ['pässwörd-🔑 ok', 1000]]) {
    const salt = bytes(16);
    const kdf = { name: 'PBKDF2-SHA256', iterations, salt: bytesToBase64(salt) };
    const key = await deriveKey(password, salt, iterations);
    const encrypted = await sealFixed(key, kdf, { accounts }, bytes(12));
    if (JSON.stringify((await openVault(password, encrypted)).data.accounts) !== JSON.stringify(accounts)) throw new Error('vault vector does not open');
    const file = { app: 'authbackup', version: 2, exportedAt: '2026-11-25T12:00:00.000Z', count: accounts.length, encrypted };
    files.push({ file, password, accounts: accounts.map(backupEntryToAccount) });
    files.push({ file, password: `${password}x`, error: 'wrongPassword' });
  }
  const tampered = structuredClone(files[2].file);
  const ct = base64ToBytes(tampered.encrypted.ct);
  ct[0] ^= 1;
  tampered.encrypted.ct = bytesToBase64(ct);
  files.push({ file: tampered, password: files[2].password, error: 'wrongPassword' });
  const v2 = structuredClone(files[2].file);
  v2.encrypted.v = 2;
  files.push({ file: v2, password: files[2].password, error: 'errVaultFormat' });
  files.push({ file: { app: 'authbackup', version: 1, exportedAt: '2026-11-25T12:00:00.000Z', accounts }, accounts: accounts.map(backupEntryToAccount) });
  files.push({ file: accounts.slice(0, 2), accounts: accounts.slice(0, 2).map(backupEntryToAccount) });
  // kdf.iterations is a whole JSON number from 1 to MAX_ITERATIONS. A missing one used to mean the default, `true` 1.
  for (const iterations of [undefined, true, '1000', null, 0, -1, 1.5, MAX_ITERATIONS + 1, 1e21, [1000]]) {
    const bad = structuredClone(files[2].file);
    if (iterations === undefined) delete bad.encrypted.kdf.iterations;
    else bad.encrypted.kdf.iterations = iterations;
    const opened = await openVault(files[2].password, bad.encrypted).then(
      ({ data }) => ({ accounts: data.accounts.map(backupEntryToAccount) }),
      (e) => ({ error: errorKey(e) }),
    );
    files.push({ file: bad, password: files[2].password, ...opened });
  }
  // One iteration is the lowest valid count. Drawn from its own generator, so the cases above and below stay as they were.
  {
    const own = seeded(20261127);
    const salt = Uint8Array.from({ length: 16 }, () => Math.floor(own() * 256));
    const iv = Uint8Array.from({ length: 12 }, () => Math.floor(own() * 256));
    const password = 'one iteration';
    const kdf = { name: 'PBKDF2-SHA256', iterations: 1, salt: bytesToBase64(salt) };
    const encrypted = await sealFixed(await deriveKey(password, salt, 1), kdf, { accounts: accounts.slice(0, 1) }, iv);
    const file = { app: 'authbackup', version: 2, exportedAt: '2026-11-25T12:00:00.000Z', count: 1, encrypted };
    files.push({ file, password, accounts: (await openVault(password, encrypted)).data.accounts.map(backupEntryToAccount) });
  }

  const pbkdf2 = [];
  for (const [password, iterations] of [['password', 1], ['password', 1000], ['', 1000], ['pässwörd-🔑', 1000], ['correct horse battery staple', DEFAULT_ITERATIONS]]) {
    const salt = bytes(16);
    const raw = await exportKey(await deriveKey(password, salt, iterations));
    pbkdf2.push({ password, salt: bytesToBase64(salt), iterations, keyHex: hex(base64ToBytes(raw)) });
  }
  const aesGcm = [];
  for (const len of [0, 1, 15, 16, 17, 100]) {
    const keyBytes = bytes(32), iv = bytes(12), plain = bytes(len);
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
    aesGcm.push({ keyHex: hex(keyBytes), ivHex: hex(iv), plainHex: hex(plain), ctHex: hex(ct) });
  }
  return { files, pbkdf2, aesGcm };
}

export async function buildVectors() {
  const rnd = seeded(20261126);
  return {
    about: 'Generated by scripts/vectors.mjs from the extension core (extension/lib). Do not edit by hand: run `npm run vectors`.',
    base32: base32Vectors(rnd),
    otp: await otpVectors(rnd),
    otpauth: otpauthVectors(),
    migration: migrationVectors(),
    accountKey: accountKeyVectors(),
    restore: restoreVectors(),
    backup: await backupVectors(rnd),
  };
}

export const serialize = (v) => `${JSON.stringify(v, null, 1)}\n`;

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(VECTORS_PATH, serialize(await buildVectors()));
  console.log(`wrote ${VECTORS_PATH}`);
}
