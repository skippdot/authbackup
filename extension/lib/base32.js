// RFC 4648 base32 (alphabet A-Z2-7). TOTP keys are almost always in this form.
import { t } from './i18n.js';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Normalizes human input: upper case, no spaces/hyphens/padding. */
export function normalizeBase32(input) {
  return String(input).toUpperCase().replace(/[\s\-=]/g, '');
}

/** At least two characters: one base32 character is 5 bits, less than a byte, and HMAC needs a non-empty key. */
export function isValidBase32(input) {
  const s = normalizeBase32(input);
  return s.length >= 2 && /^[A-Z2-7]+$/.test(s);
}

export function base32Decode(input) {
  const s = normalizeBase32(input);
  if (!/^[A-Z2-7]*$/.test(s)) throw new Error(t('errBase32Chars'));
  const out = new Uint8Array(Math.floor((s.length * 5) / 8));
  let bits = 0, value = 0, idx = 0;
  for (const ch of s) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out[idx++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return out;
}

/** Without "=" padding, as keys are written in otpauth:// URIs. */
export function base32Encode(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function base64ToBytes(b64) {
  // URIs may carry a url-safe variant and lost padding: normalize.
  let s = b64.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function bytesToBase64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
