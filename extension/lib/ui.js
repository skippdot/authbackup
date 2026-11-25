// Shared UI helpers for the popup and the manage page.
import qrcode from '../vendor/qrcode.mjs';
import { totp, hotp, secondsLeft } from './totp.js';
import { t } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** 123456 → "123 456", 12345678 → "1234 5678": easier to retype by eye. */
export function formatCode(code) {
  if (!code) return '';
  const half = Math.floor(code.length / 2);
  return `${code.slice(0, half)} ${code.slice(half)}`;
}

export function title(a) {
  return a.issuer || a.account || t('noName');
}

export function subtitle(a) {
  return a.issuer ? a.account : '';
}

/** Non-standard parameters are shown as badges: they show that the QR was recognized correctly. */
export function badges(a) {
  const out = [];
  if (a.type === 'hotp') out.push('HOTP');
  if (a.algorithm !== 'SHA1') out.push(a.algorithm);
  if (a.digits !== 6) out.push(t('nDigits', a.digits));
  if (a.type === 'totp' && a.period !== 30) out.push(t('nSec', a.period));
  return out;
}

export async function currentCode(a, now = Date.now()) {
  return a.type === 'hotp' ? null : totp(a, now);
}

export async function hotpCode(a) {
  return hotp({ secret: a.secret, counter: a.counter || 0, digits: a.digits, algorithm: a.algorithm });
}

export { secondsLeft };

export function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
}

let toastTimer;
export function toast(msg, kind = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.append(el);
  }
  el.textContent = msg;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

export async function copy(text) {
  await navigator.clipboard.writeText(text);
}

/** QR as PNG (for download): black modules on white, caption below. */
export async function qrPngBlob(text, label = '') {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const cell = Math.max(4, Math.floor(720 / n));
  const margin = cell * 4;
  const labelH = label ? 44 : 0;
  const size = n * cell + margin * 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size + labelH;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(margin + c * cell, margin + r * cell, cell, cell);
  if (label) {
    g.font = '600 20px -apple-system, system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(label, size / 2, size + 16, size - 20);
  }
  return new Promise((res) => canvas.toBlob(res, 'image/png'));
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Modal password prompt. confirm adds a second "repeat" field; check(pw) is an async check
 * (the error is shown in the dialog without closing it). Returns the password, or null on cancel.
 */
export function askPassword({ title: heading, hint = '', confirm = false, okText = t('ok'), minLength = 0, check } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'pw-dialog';
    dlg.innerHTML = `
      <form method="dialog">
        <h3>${esc(heading)}</h3>
        ${hint ? `<p class="muted">${esc(hint)}</p>` : ''}
        <input type="password" name="pw" placeholder="${esc(t('password'))}" autocomplete="current-password" required>
        ${confirm ? `<input type="password" name="pw2" placeholder="${esc(t('pwRepeat'))}" autocomplete="new-password" required>` : ''}
        <div class="err"></div>
        <div class="row"><div class="spacer"></div>
          <button type="button" data-cancel>${esc(t('cancel'))}</button>
          <button class="primary" type="submit">${esc(okText)}</button></div>
      </form>`;
    document.body.append(dlg);
    const form = dlg.querySelector('form');
    const err = dlg.querySelector('.err');
    const done = (v) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    dlg.querySelector('[data-cancel]').onclick = () => done(null);
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      done(null);
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = form.pw.value;
      if (pw.length < minLength) return (err.textContent = t('minChars', minLength));
      if (confirm && pw !== form.pw2.value) return (err.textContent = t('pwMismatch'));
      if (check) {
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        err.textContent = t('checking');
        try {
          await check(pw);
        } catch (x) {
          err.textContent = x.message;
          form.pw.select();
          return;
        } finally {
          btn.disabled = false;
        }
      }
      done(pw);
    });
    dlg.showModal();
  });
}
