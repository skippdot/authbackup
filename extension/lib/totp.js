// HOTP (RFC 4226) / TOTP (RFC 6238) on Web Crypto: works both in the extension and in Node >= 20.
import { base32Decode } from './base32.js';
import { t } from './i18n.js';

const HASH = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };
const keyCache = new Map();

async function importKey(secretB32, algorithm) {
  const cacheKey = `${algorithm}:${secretB32}`;
  let key = keyCache.get(cacheKey);
  if (!key) {
    const hash = HASH[algorithm];
    if (!hash) throw new Error(t('errAlgorithm', algorithm));
    key = await crypto.subtle.importKey('raw', base32Decode(secretB32), { name: 'HMAC', hash }, false, ['sign']);
    keyCache.set(cacheKey, key);
  }
  return key;
}

/** 8-byte big-endian counter. BigInt, so precision is not lost beyond 2^32. */
function counterBytes(counter) {
  const buf = new Uint8Array(8);
  let c = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    buf[i] = Number(c & 0xffn);
    c >>= 8n;
  }
  return buf;
}

export async function hotp({ secret, counter, digits = 6, algorithm = 'SHA1' }) {
  const key = await importKey(secret, algorithm);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes(counter)));
  // Dynamic truncation (RFC 4226 §5.3): the low 4 bits of the last byte are the offset.
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function timeStep(period = 30, nowMs = Date.now()) {
  return Math.floor(nowMs / 1000 / period);
}

export function secondsLeft(period = 30, nowMs = Date.now()) {
  return period - (Math.floor(nowMs / 1000) % period);
}

export async function totp({ secret, digits = 6, algorithm = 'SHA1', period = 30 }, nowMs = Date.now()) {
  return hotp({ secret, digits, algorithm, counter: timeStep(period, nowMs) });
}
