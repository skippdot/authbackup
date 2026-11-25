// Parsing what may come from a QR or the clipboard: otpauth://, otpauth-migration:// or bare base32.
// The otpauth:// format is the Google Authenticator "Key Uri Format":
//   otpauth://totp/Issuer:account?secret=BASE32&issuer=Issuer&algorithm=SHA1&digits=6&period=30
import { normalizeBase32, isValidBase32 } from './base32.js';
import { parseMigrationUri } from './migration.js';
import { t } from './i18n.js';

const ALGOS = new Set(['SHA1', 'SHA256', 'SHA512']);

export function parseOtpauthUri(uri) {
  const url = new URL(uri.trim());
  if (url.protocol !== 'otpauth:') throw new Error(t('errNotOtpauth'));
  const type = url.hostname.toLowerCase();
  if (type !== 'totp' && type !== 'hotp') throw new Error(t('errUnknownType', type));

  const p = url.searchParams;
  const secret = normalizeBase32(p.get('secret') || '');
  if (!isValidBase32(secret)) throw new Error(t('errNoSecret'));

  // Label = "Issuer:account" or just "account"; the colon may be encoded as %3A. The issuer parameter, when present,
  // is matched as the prefix first, so an issuer that itself contains ":" does not leak into the account name.
  const label = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const issuerParam = p.get('issuer') || '';
  let labelIssuer = '';
  let account = label;
  if (issuerParam && label.startsWith(`${issuerParam}:`)) {
    labelIssuer = issuerParam;
    account = label.slice(issuerParam.length + 1);
  } else if (label.includes(':')) {
    const colon = label.indexOf(':');
    labelIssuer = label.slice(0, colon);
    account = label.slice(colon + 1);
  }

  const algorithm = (p.get('algorithm') || 'SHA1').toUpperCase().replace('-', '');
  if (!ALGOS.has(algorithm)) throw new Error(t('errAlgorithm', algorithm));
  const digits = parseInt(p.get('digits') || '6', 10);
  if (![6, 7, 8].includes(digits)) throw new Error(t('errDigits', digits));
  const period = parseInt(p.get('period') || '30', 10);
  if (!(period > 0)) throw new Error(t('errPeriod', p.get('period')));
  const counter = type === 'hotp' ? parseInt(p.get('counter') || '0', 10) : 0;
  if (!(Number.isSafeInteger(counter) && counter >= 0)) throw new Error(t('errCounter', p.get('counter')));

  return {
    type,
    issuer: issuerParam.trim() || labelIssuer.trim(), // the issuer parameter takes priority over the prefix
    account: account.trim(),
    secret,
    algorithm,
    digits,
    period,
    counter,
  };
}

export function buildOtpauthUri(a) {
  const label = encodeURIComponent(a.issuer ? `${a.issuer}:${a.account}` : a.account);
  const q = new URLSearchParams({ secret: a.secret });
  if (a.issuer) q.set('issuer', a.issuer);
  q.set('algorithm', a.algorithm);
  q.set('digits', String(a.digits));
  if (a.type === 'hotp') q.set('counter', String(a.counter || 0));
  else q.set('period', String(a.period));
  return `otpauth://${a.type}/${label}?${q}`;
}

/**
 * Universal entry point: text from a QR / clipboard.
 * Returns { accounts: [...], skipped: [...], kind: 'otpauth'|'migration' }.
 */
export function parseAnyOtpText(text) {
  const t = String(text || '').trim();
  if (/^otpauth-migration:/i.test(t)) return { kind: 'migration', ...parseMigrationUri(t) };
  if (/^otpauth:/i.test(t)) return { kind: 'otpauth', accounts: [parseOtpauthUri(t)], skipped: [] };
  throw new Error(t('errNotOtp'));
}

/** Deduplication key: the same secret with the same label is one account. */
export function accountKey(a) {
  return `${a.type}|${normalizeBase32(a.secret)}|${(a.issuer || '').toLowerCase()}|${(a.account || '').toLowerCase()}`;
}
