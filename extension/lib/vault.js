// Registry encryption with a password: PBKDF2-SHA256 → AES-256-GCM (Web Crypto only, no chrome.*, testable in Node).
// "Vault" format (also stored in the encrypted backup file):
//  { v: 1, kdf: { name: 'PBKDF2-SHA256', iterations, salt }, iv, ct }   (salt/iv/ct in base64)
// GCM authenticates the ciphertext: a wrong password gives a decryption error, not garbage.
import { base64ToBytes, bytesToBase64 } from './base32.js';
import { t } from './i18n.js';

export const DEFAULT_ITERATIONS = 600_000; // OWASP recommendation for PBKDF2-SHA256
// A file asking for more makes a phone hang for minutes, and the mobile apps refuse it; AuthBackup writes the default.
export const MAX_ITERATIONS = 10_000_000;
export const MIN_PASSWORD = 8;

export class WrongPasswordError extends Error {
  constructor() {
    super(t('wrongPassword'));
    this.name = 'WrongPasswordError';
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function deriveKey(password, salt, iterations = DEFAULT_ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  // extractable: the key is put into chrome.storage.session so the popup does not ask for the password on every open
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function exportKey(key) {
  return bytesToBase64(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}

export async function importKey(b64) {
  return crypto.subtle.importKey('raw', base64ToBytes(b64), 'AES-GCM', true, ['encrypt', 'decrypt']);
}

/** Encrypts data with an already prepared key, keeping the vault's kdf parameters (same salt, always a new IV). */
export async function sealWithKey(key, kdf, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)));
  return { v: 1, kdf, iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
}

export async function unsealWithKey(key, vault) {
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(vault.iv) }, key, base64ToBytes(vault.ct));
  } catch {
    throw new WrongPasswordError();
  }
  return JSON.parse(dec.decode(plain));
}

/** New vault: fresh salt → key → ciphertext. Also returns the key so it need not be derived a second time. */
export async function createVault(password, data, iterations = DEFAULT_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt, iterations);
  const kdf = { name: 'PBKDF2-SHA256', iterations, salt: bytesToBase64(salt) };
  return { vault: await sealWithKey(key, kdf, data), key };
}

export async function openVault(password, vault) {
  if (vault?.v !== 1 || vault.kdf?.name !== 'PBKDF2-SHA256') throw new Error(t('errVaultFormat'));
  // The count is read as AuthBackup writes it, a whole number. Otherwise deriveKey() took a missing one as its default,
  // and Web IDL read `true` as 1 iteration and "1000" as 1000.
  const { iterations } = vault.kdf;
  if (!(Number.isInteger(iterations) && iterations >= 1 && iterations <= MAX_ITERATIONS)) throw new Error(t('errVaultFormat'));
  const key = await deriveKey(password, base64ToBytes(vault.kdf.salt), iterations);
  return { data: await unsealWithKey(key, vault), key };
}

export function isVault(x) {
  return x && typeof x === 'object' && x.v === 1 && typeof x.ct === 'string' && x.kdf;
}
