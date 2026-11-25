// Tab scan: screenshot of the visible area + hints from the page (where img/canvas/svg that look like a QR are).
// A screenshot rather than the DOM, because a QR may be in a canvas, svg, cross-origin image or iframe:
// pixels on screen are always there, access to the source is not.
import { findQrTexts } from './qr.js';
import { parseAnyOtpText } from './otpauth.js';
import { base64ToBytes } from './base32.js';

/** Runs INSIDE the page via chrome.scripting, hence no closures. */
function collectQrCandidates() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const rects = [];
  const els = document.querySelectorAll('img, canvas, svg, video, object, picture, [style*="background-image"]');
  for (const el of els) {
    if (el.tagName.toLowerCase() === 'svg' && el.ownerSVGElement) continue; // nested svg
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) continue;
    const ratio = r.width / r.height;
    if (ratio < 0.6 || ratio > 1.7) continue; // a QR is square, with some slack for captions/frames
    if (r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) continue;
    rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
    if (rects.length >= 40) break;
  }
  return { vw, vh, rects };
}

/**
 * Scans the visible part of the tab.
 * fullScan=false: candidate areas only (fast, for the auto-scan when the popup opens);
 * fullScan=true: plus a search over the whole screenshot.
 * Returns { accounts, skipped, otherQr, errors }.
 */
export async function scanTab({ tabId, windowId, fullScan = true }) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  // parse the data: URL ourselves, without a network API: the extension CSP forbids any requests (connect-src 'none').
  const png = base64ToBytes(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }));

  let hints = { vw: bitmap.width, vh: bitmap.height, rects: [] };
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: collectQrCandidates });
    if (res?.result) hints = res.result;
  } catch {
    // chrome://, Web Store, PDF viewer: the script cannot be injected; only the full screenshot scan remains
    fullScan = true;
  }

  // Scale from CSS pixels to screenshot pixels (accounts for both devicePixelRatio and page zoom).
  const scale = bitmap.width / hints.vw;
  const margin = 8;
  const rects = hints.rects.map((r) => ({
    x: (r.x - margin) * scale, y: (r.y - margin) * scale,
    w: (r.w + margin * 2) * scale, h: (r.h + margin * 2) * scale,
  }));

  let texts;
  try {
    texts = findQrTexts(bitmap, { rects, fullScan });
  } finally {
    bitmap.close();
  }
  return interpretQrTexts(texts);
}

/** Texts of QRs → accounts; foreign QRs (links, Wi-Fi, etc.) are kept separate to show "there is a QR, but not TOTP". */
export function interpretQrTexts(texts) {
  const out = { accounts: [], skipped: [], otherQr: [], errors: [] };
  for (const text of texts) {
    if (!/^otpauth(-migration)?:/i.test(text)) {
      out.otherQr.push(text);
      continue;
    }
    try {
      const r = parseAnyOtpText(text);
      // Google Authenticator export: the keys came from the app, so a copy is already there (store.addAccounts).
      out.accounts.push(...(r.kind === 'migration' ? r.accounts.map((a) => ({ ...a, fromApp: true })) : r.accounts));
      out.skipped.push(...r.skipped);
    } catch (e) {
      out.errors.push(`${e.message}: ${text.slice(0, 60)}…`);
    }
  }
  return out;
}
