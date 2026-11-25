// Property-based tests (fast-check), a form of fuzzing: random and adversarial inputs for everything that parses
// untrusted data (QR codes, pasted text, imported files) and for the vault. Each property is an invariant that must
// hold for every input, not only for the examples in core.test.mjs. On failure fast-check prints the smallest
// failing input and the seed to replay it (fc.assert(..., { seed, path })).
//
// This file is .js, not .mjs, so the OpenSSF Scorecard fuzzing check can find it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { base32Decode, base32Encode, base64ToBytes, bytesToBase64, isValidBase32 } from '../../extension/lib/base32.js';
import { buildOtpauthUri, parseAnyOtpText, parseOtpauthUri } from '../../extension/lib/otpauth.js';
import { buildMigrationUri, decodeMigrationPayload, parseMigrationUri } from '../../extension/lib/migration.js';
import { hotp, totp } from '../../extension/lib/totp.js';
import { createVault, openVault, WrongPasswordError } from '../../extension/lib/vault.js';

// 100 runs per property by default (seconds in CI); FUZZ_RUNS=100000 npm test for a long local session.
fc.configureGlobal({ numRuns: Number(process.env.FUZZ_RUNS) || 100 });

const ALGOS = ['SHA1', 'SHA256', 'SHA512'];
const bytes = (minLength, maxLength) => fc.uint8Array({ minLength, maxLength });
const secret = bytes(1, 64).map(base32Encode);
/** Names as people type them: any script, emoji, spaces, punctuation (well-formed Unicode). */
const text = fc.string({ unit: 'grapheme', maxLength: 24 });
/** Any UTF-16, including lone surrogates: what a hostile page or clipboard can hand us. */
const anyText = fc.string({ unit: 'binary', maxLength: 200 });

/** Every account the parsers accept must be able to show a code. */
async function assertUsable(a, nowMs = Date.now()) {
  assert.ok(['totp', 'hotp'].includes(a.type), `type ${a.type}`);
  assert.ok(isValidBase32(a.secret) && base32Decode(a.secret).length > 0, `secret ${a.secret}`);
  assert.ok(ALGOS.includes(a.algorithm), `algorithm ${a.algorithm}`);
  assert.ok([6, 7, 8].includes(a.digits), `digits ${a.digits}`);
  assert.ok(Number.isInteger(a.period) && a.period > 0, `period ${a.period}`);
  assert.ok(Number.isSafeInteger(a.counter) && a.counter >= 0, `counter ${a.counter}`);
  const code = a.type === 'totp' ? await totp(a, nowMs) : await hotp(a);
  assert.match(code, new RegExp(`^\\d{${a.digits}}$`));
}

const rejectedWithError = (e) => assert.ok(e instanceof Error, `threw a non-Error: ${String(e)}`);

test('base32: decode(encode(x)) = x, and human formatting does not matter', () => {
  fc.assert(fc.property(bytes(0, 64), fc.boolean(), (b, messy) => {
    let s = base32Encode(b);
    assert.match(s, /^[A-Z2-7]*$/);
    if (messy) s = `${s.toLowerCase().replace(/(.{4})/g, '$1 ')}====`;
    assert.deepEqual(base32Decode(s), b);
  }));
});

test('base64: round trip, also the url-safe form without padding', () => {
  fc.assert(fc.property(bytes(0, 64), (b) => {
    const std = bytesToBase64(b);
    assert.deepEqual(base64ToBytes(std), b);
    assert.deepEqual(base64ToBytes(std.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')), b);
  }));
});

const account = fc.record({
  type: fc.constantFrom('totp', 'hotp'),
  issuer: text,
  account: text,
  secret,
  algorithm: fc.constantFrom(...ALGOS),
  digits: fc.constantFrom(6, 7, 8),
  period: fc.integer({ min: 1, max: 3600 }),
  counter: fc.maxSafeNat(),
});

test('otpauth: parse(build(a)) gives the account back', () => {
  fc.assert(fc.property(account, (a) => {
    // Without an issuer the label is the bare account name, and two cases cannot survive it:
    // "Issuer:account" is how the format writes an issuer, so a colon in the name is ambiguous (the Key Uri
    // Format forbids it); and a path segment of only dots is removed by any WHATWG URL parser.
    fc.pre(a.issuer !== '' || (!a.account.includes(':') && !['.', '..'].includes(a.account)));
    assert.deepEqual(parseOtpauthUri(buildOtpauthUri(a)), {
      type: a.type,
      issuer: a.issuer.trim(),
      account: a.account.trim(),
      secret: a.secret,
      algorithm: a.algorithm,
      digits: a.digits,
      period: a.type === 'totp' ? a.period : 30,
      counter: a.type === 'hotp' ? a.counter : 0,
    });
  }));
});

/** Plausible and broken parameter values, the way hand-made or hostile QR codes carry them. */
const param = fc.oneof(
  fc.string({ maxLength: 12 }),
  fc.constantFrom('', '0', '-1', '1', '6', '7', '8', '30', ' 30', '1.5', '1e3', 'NaN', 'Infinity', '9007199254740993',
    'SHA1', 'sha256', 'SHA-512', 'MD5'),
);
const otpauthUri = fc.tuple(
  fc.constantFrom('totp', 'hotp', 'TOTP', 'Hotp', 'motp', ''),
  text,
  fc.record(
    { secret: fc.oneof(secret, fc.string({ maxLength: 6 })), issuer: text, algorithm: param, digits: param, period: param, counter: param },
    { requiredKeys: [] },
  ),
).map(([type, label, params]) => `otpauth://${type}/${encodeURIComponent(label)}?${new URLSearchParams(params)}`);

test('otpauth: whatever the parser accepts can show a code', async () => {
  await fc.assert(fc.asyncProperty(otpauthUri, fc.integer({ min: 0, max: 4e12 }), async (uri, now) => {
    let a;
    try {
      a = parseOtpauthUri(uri);
    } catch (e) {
      return rejectedWithError(e);
    }
    await assertUsable(a, now);
  }));
});

test('parseAnyOtpText: arbitrary text is either parsed or rejected with an Error', () => {
  const prefixed = fc.tuple(
    fc.constantFrom('', 'otpauth:', 'otpauth://totp/', 'OTPAUTH://hotp/x?secret=', 'otpauth-migration://offline?data=', ' otpauth-migration:'),
    anyText,
  ).map(([p, s]) => p + s);
  fc.assert(fc.property(fc.oneof(anyText, prefixed, otpauthUri), (s) => {
    try {
      const r = parseAnyOtpText(s);
      assert.ok(Array.isArray(r.accounts) && Array.isArray(r.skipped));
    } catch (e) {
      rejectedWithError(e);
    }
  }));
});

// ---------- otpauth-migration:// (Google Authenticator export, hand-written protobuf) ----------

const varint = (n) => {
  const out = [];
  let v = BigInt(n);
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v) byte |= 0x80;
    out.push(byte);
  } while (v);
  return out;
};
const lenField = (field, body) => [...varint((field << 3) | 2), ...varint(body.length), ...body];
/** One protobuf field with a random number and wire type: varint, length-delimited, fixed64/32, or a bad type. */
const pbField = fc.oneof(
  fc.tuple(fc.integer({ min: 1, max: 8 }), fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }))
    .map(([f, v]) => [...varint(f << 3), ...varint(v)]),
  fc.tuple(fc.integer({ min: 1, max: 8 }), bytes(0, 40)).map(([f, b]) => lenField(f, [...b])),
  fc.tuple(fc.integer({ min: 1, max: 8 }), fc.constantFrom(1, 5, 3, 4, 6, 7), bytes(0, 9))
    .map(([f, wt, b]) => [...varint((f << 3) | wt), ...b]),
);
const pbOtpParameters = fc.array(pbField, { maxLength: 8 }).map((fs) => lenField(1, fs.flat()));
/** Structurally plausible payloads: random OtpParameters messages mixed with random top-level fields. */
const pbPayload = fc.array(fc.oneof(pbOtpParameters, pbField), { maxLength: 6 }).map((fs) => Uint8Array.from(fs.flat()));
const migrationUri = (b) => `otpauth-migration://offline?data=${encodeURIComponent(bytesToBase64(b))}`;

test('migration decoder: random bytes never hang or throw anything but an Error', () => {
  fc.assert(fc.property(fc.oneof(bytes(0, 512), pbPayload), (b) => {
    try {
      decodeMigrationPayload(b);
    } catch (e) {
      rejectedWithError(e);
    }
  }));
});

test('migration decoder: an over-long varint is rejected at once', () => {
  // A valid varint is at most 10 bytes; without a limit a long run of continuation bytes costs quadratic BigInt work.
  fc.assert(fc.property(fc.integer({ min: 11, max: 20000 }), (n) => {
    const b = new Uint8Array(n + 1).fill(0x80);
    b[n] = 0x01;
    assert.throws(() => decodeMigrationPayload(b), /errTruncated/);
  }), { numRuns: 20 });
});

test('migration: whatever the parser accepts can show a code', async () => {
  await fc.assert(fc.asyncProperty(fc.oneof(pbPayload, bytes(0, 300)), async (b) => {
    let r;
    try {
      r = parseMigrationUri(migrationUri(b));
    } catch (e) {
      return rejectedWithError(e);
    }
    for (const a of r.accounts) await assertUsable(a);
  }));
});

const gaAccount = fc.record({
  type: fc.constantFrom('totp', 'hotp'),
  issuer: text,
  account: text,
  secret,
  algorithm: fc.constantFrom(...ALGOS),
  digits: fc.constantFrom(6, 8), // the migration format has no 7
  period: fc.constant(30), // nor any period other than 30
  counter: fc.maxSafeNat(),
});

test('migration: parse(build(accounts)) gives the accounts back', () => {
  fc.assert(fc.property(fc.array(gaAccount, { minLength: 1, maxLength: 5 }), (list) => {
    const { accounts, skipped } = parseMigrationUri(buildMigrationUri(list));
    assert.deepEqual(skipped, []);
    assert.deepEqual(accounts, list.map((a) => ({
      type: a.type,
      issuer: a.issuer.trim(),
      account: a.account.trim(),
      secret: a.secret,
      algorithm: a.algorithm,
      digits: a.digits,
      period: 30,
      counter: a.type === 'hotp' ? a.counter : 0,
    })));
  }));
});

// ---------- vault: PBKDF2-SHA256 → AES-256-GCM ----------

const ITERATIONS = 1000; // the real vault uses 600 000; the format and the AES-GCM checks do not depend on the count
const password = fc.string({ unit: 'grapheme', minLength: 8, maxLength: 20 });

test('vault: open(create(data)) = data; a wrong password and any flipped bit are rejected', async () => {
  await fc.assert(fc.asyncProperty(
    password, password, fc.jsonValue({ maxDepth: 3, stringUnit: 'grapheme' }), fc.nat(), fc.constantFrom('ct', 'iv', 'salt'),
    async (pw, other, data, pos, part) => {
      const { vault } = await createVault(pw, data, ITERATIONS);
      assert.deepEqual((await openVault(pw, vault)).data, JSON.parse(JSON.stringify(data)));
      if (other !== pw) await assert.rejects(openVault(other, vault), WrongPasswordError);

      // Tampering: one bit of the ciphertext (with its GCM tag), of the IV or of the KDF salt.
      const get = (v) => (part === 'salt' ? v.kdf.salt : v[part]);
      const raw = base64ToBytes(get(vault));
      raw[pos % raw.length] ^= 1 << (pos % 8);
      const bad = part === 'salt'
        ? { ...vault, kdf: { ...vault.kdf, salt: bytesToBase64(raw) } }
        : { ...vault, [part]: bytesToBase64(raw) };
      await assert.rejects(openVault(pw, bad), WrongPasswordError);
    },
  ), { numRuns: 40 });
});
