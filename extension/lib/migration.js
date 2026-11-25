// Google Authenticator export: otpauth-migration://offline?data=<base64(protobuf MigrationPayload)>.
// Schema (from the Google Authenticator sources):
//   MigrationPayload { repeated OtpParameters otp_parameters = 1; int32 version = 2;
//                      int32 batch_size = 3; int32 batch_index = 4; int32 batch_id = 5; }
//   OtpParameters    { bytes secret = 1; string name = 2; string issuer = 3;
//                      Algorithm algorithm = 4; DigitCount digits = 5; OtpType type = 6; int64 counter = 7; }
// No protobuf library needed: varint (wire type 0) and length-delimited (wire type 2) are enough.
import { base32Encode, base32Decode, base64ToBytes, bytesToBase64 } from './base32.js';
import { t } from './i18n.js';

const ALGORITHMS = { 0: 'SHA1', 1: 'SHA1', 2: 'SHA256', 3: 'SHA512', 4: 'MD5' };
const DIGITS = { 0: 6, 1: 6, 2: 8 };
const TYPES = { 0: 'totp', 1: 'hotp', 2: 'totp' };

class Reader {
  constructor(bytes) {
    this.b = bytes;
    this.pos = 0;
  }
  done() {
    return this.pos >= this.b.length;
  }
  varint() {
    let result = 0n, shift = 0n;
    for (;;) {
      // A protobuf varint is at most 10 bytes; a longer run is damage (and would cost quadratic BigInt work).
      if (this.pos >= this.b.length || shift > 63n) throw new Error(t('errTruncated'));
      const byte = this.b[this.pos++];
      result |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return result;
      shift += 7n;
    }
  }
  bytes() {
    const len = Number(this.varint());
    if (this.pos + len > this.b.length) throw new Error(t('errTruncated'));
    const out = this.b.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
  skip(wireType) {
    if (wireType === 0) this.varint();
    else if (wireType === 2) this.bytes();
    else if (wireType === 1) this.fixed(8);
    else if (wireType === 5) this.fixed(4);
    else throw new Error(t('errWireType', wireType));
  }
  fixed(len) {
    if (this.pos + len > this.b.length) throw new Error(t('errTruncated'));
    this.pos += len;
  }
  /** Iterator over message fields: [field number, wire type]. */
  *fields() {
    while (!this.done()) {
      const tag = Number(this.varint());
      yield [tag >>> 3, tag & 7];
    }
  }
}

const utf8 = new TextDecoder();

function decodeOtpParameters(bytes) {
  const r = new Reader(bytes);
  const p = { secret: new Uint8Array(), name: '', issuer: '', algorithm: 0, digits: 0, type: 0, counter: 0n };
  for (const [field, wt] of r.fields()) {
    if (field === 1 && wt === 2) p.secret = r.bytes().slice();
    else if (field === 2 && wt === 2) p.name = utf8.decode(r.bytes());
    else if (field === 3 && wt === 2) p.issuer = utf8.decode(r.bytes());
    else if (field === 4 && wt === 0) p.algorithm = Number(r.varint());
    else if (field === 5 && wt === 0) p.digits = Number(r.varint());
    else if (field === 6 && wt === 0) p.type = Number(r.varint());
    else if (field === 7 && wt === 0) p.counter = r.varint();
    else r.skip(wt);
  }
  return p;
}

export function decodeMigrationPayload(bytes) {
  const r = new Reader(bytes);
  const payload = { otpParameters: [], version: 0, batchSize: 0, batchIndex: 0, batchId: 0 };
  for (const [field, wt] of r.fields()) {
    if (field === 1 && wt === 2) payload.otpParameters.push(decodeOtpParameters(r.bytes()));
    else if (field === 2 && wt === 0) payload.version = Number(r.varint());
    else if (field === 3 && wt === 0) payload.batchSize = Number(r.varint());
    else if (field === 4 && wt === 0) payload.batchIndex = Number(r.varint());
    else if (field === 5 && wt === 0) payload.batchId = Number(r.varint());
    else r.skip(wt);
  }
  return payload;
}

/**
 * Parses an otpauth-migration:// URI into a list of accounts in our format.
 * Returns { accounts, batch: {index, size, id}, skipped: [{name, reason}] }.
 */
export function parseMigrationUri(uri) {
  const url = new URL(uri.trim());
  if (url.protocol !== 'otpauth-migration:') throw new Error(t('errNotMigration'));
  const data = url.searchParams.get('data');
  if (!data) throw new Error(t('errNoData'));
  const payload = decodeMigrationPayload(base64ToBytes(data));
  const accounts = [];
  const skipped = [];
  for (const p of payload.otpParameters) {
    const algorithm = ALGORITHMS[p.algorithm] ?? 'SHA1';
    const label = p.name || p.issuer || t('noName');
    if (algorithm === 'MD5') {
      skipped.push({ name: label, reason: t('errMd5') });
      continue;
    }
    if (!p.secret.length) {
      skipped.push({ name: label, reason: t('errNoSecret') });
      continue;
    }
    const type = TYPES[p.type] ?? 'totp';
    const counter = type === 'hotp' ? Number(p.counter) : 0;
    if (!Number.isSafeInteger(counter)) { // int64 on the wire; beyond 2^53 a Number would silently round it
      skipped.push({ name: label, reason: t('errCounter', p.counter) });
      continue;
    }
    // Google puts "Issuer:account" in name if issuer was in the original link.
    let account = p.name;
    if (p.issuer && account.startsWith(`${p.issuer}:`)) account = account.slice(p.issuer.length + 1);
    accounts.push({
      type,
      issuer: p.issuer.trim(),
      account: account.trim(),
      secret: base32Encode(p.secret),
      algorithm,
      digits: DIGITS[p.digits] ?? 6,
      period: 30, // the migration format does not store the period: Google always uses 30 s
      counter,
    });
  }
  return {
    accounts,
    skipped,
    batch: { index: payload.batchIndex, size: payload.batchSize, id: payload.batchId },
  };
}

// ---------- Encoding: needed by the test bench and tests to produce "as if exported from Google" ----------

function varintBytes(value) {
  let v = BigInt(value);
  const out = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) byte |= 0x80;
    out.push(byte);
  } while (v > 0n);
  return out;
}

function fieldVarint(field, value) {
  return [...varintBytes((field << 3) | 0), ...varintBytes(value)];
}

function fieldBytes(field, bytes) {
  return [...varintBytes((field << 3) | 2), ...varintBytes(bytes.length), ...bytes];
}

const utf8enc = new TextEncoder();
const ALGO_CODE = { SHA1: 1, SHA256: 2, SHA512: 3 };

export function buildMigrationUri(accounts, { batchIndex = 0, batchSize = 1, batchId = 1 } = {}) {
  const body = [];
  for (const a of accounts) {
    const name = a.issuer ? `${a.issuer}:${a.account}` : a.account;
    const params = [
      ...fieldBytes(1, base32Decode(a.secret)),
      ...fieldBytes(2, utf8enc.encode(name)),
      ...fieldBytes(3, utf8enc.encode(a.issuer || '')),
      ...fieldVarint(4, ALGO_CODE[a.algorithm] ?? 1),
      ...fieldVarint(5, a.digits === 8 ? 2 : 1),
      ...fieldVarint(6, a.type === 'hotp' ? 1 : 2),
      ...(a.type === 'hotp' ? fieldVarint(7, a.counter || 0) : []),
    ];
    body.push(...fieldBytes(1, params));
  }
  body.push(...fieldVarint(2, 1), ...fieldVarint(3, batchSize), ...fieldVarint(4, batchIndex), ...fieldVarint(5, batchId));
  return `otpauth-migration://offline?data=${encodeURIComponent(bytesToBase64(Uint8Array.from(body)))}`;
}

// ---------- Export "like Google Authenticator": several QRs by batch_index/batch_size ----------

/** Why an account cannot be passed in the migration format losslessly (or null if it can). */
export function migrationIncompatibility(a) {
  if (a.type === 'totp' && a.period !== 30) return t('gaIncompatPeriod', a.period);
  if (a.digits !== 6 && a.digits !== 8) return t('gaIncompatDigits', a.digits);
  if (!(a.algorithm in ALGO_CODE)) return t('errAlgorithm', a.algorithm);
  return null;
}

/**
 * Splits accounts into QRs. One QR holds up to maxPerQr keys and no more than maxUriLength characters,
 * otherwise the QR gets too dense and phones read it poorly (Google cuts at roughly the same point, ~10).
 * Returns { uris: [...], skipped: [{ account, reason }] }.
 */
export function planMigrationExport(accounts, { maxPerQr = 10, maxUriLength = 1200, batchId } = {}) {
  const skipped = [];
  const ok = [];
  for (const a of accounts) {
    const reason = migrationIncompatibility(a);
    if (reason) skipped.push({ account: a, reason });
    else ok.push(a);
  }
  const groups = [];
  let cur = [];
  for (const a of ok) {
    const next = [...cur, a];
    if (cur.length && (next.length > maxPerQr || buildMigrationUri(next).length > maxUriLength)) {
      groups.push(cur);
      cur = [a];
    } else cur = next;
  }
  if (cur.length) groups.push(cur);
  const id = batchId ?? (crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff);
  const uris = groups.map((g, i) => buildMigrationUri(g, { batchIndex: i, batchSize: groups.length, batchId: id }));
  return { uris, groups, skipped };
}
