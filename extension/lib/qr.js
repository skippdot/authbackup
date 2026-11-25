// QR recognition via jsQR on top of OffscreenCanvas: works in both the service worker and pages.
import jsQR from '../vendor/jsqr.mjs';

const PAD = 24; // white "quiet zone": without it jsQR often fails to find a QR cropped tight

/**
 * Draws the source area (bitmap/canvas) onto a new canvas with a white border, scaled
 * so the larger side falls into [minSide, maxSide], and runs jsQR.
 */
function decodeRegion(source, sx, sy, sw, sh, { minSide = 360, maxSide = 1200 } = {}) {
  const longest = Math.max(sw, sh);
  let scale = 1;
  if (longest < minSide) scale = minSide / longest;
  else if (longest > maxSide) scale = maxSide / longest;
  const w = Math.round(sw * scale) + PAD * 2;
  const h = Math.round(sh * scale) + PAD * 2;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  // Upscaling without smoothing keeps module edges sharp; downscaling uses smoothing.
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(source, sx, sy, sw, sh, PAD, PAD, w - PAD * 2, h - PAD * 2);
  const img = ctx.getImageData(0, 0, w, h);
  const res = jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
  return res?.data || null;
}

/**
 * Looks for a QR in an image.
 * rects are hints (areas of likely QRs in image pixels); checked first.
 * fullScan additionally searches the whole image (slower on large screenshots).
 * Returns an array of unique strings.
 */
export function findQrTexts(source, { rects = [], fullScan = true } = {}) {
  const found = new Set();
  const W = source.width, H = source.height;
  for (const r of rects) {
    const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
    const w = Math.min(W - x, Math.ceil(r.w)), h = Math.min(H - y, Math.ceil(r.h));
    if (w < 20 || h < 20) continue;
    const text = decodeRegion(source, x, y, w, h);
    if (text) found.add(text);
  }
  if (fullScan) {
    // First at "native" size (a small QR on a large screenshot), then downscaled (phone photos).
    for (const opts of [{ minSide: 1, maxSide: 4096 }, { minSide: 1, maxSide: 1000 }]) {
      const text = decodeRegion(source, 0, 0, W, H, opts);
      if (text) {
        found.add(text);
        break;
      }
    }
  }
  return [...found];
}

/** Blob (file, clipboard image, screenshot) → array of QR texts. */
export async function findQrTextsInBlob(blob, opts) {
  const bitmap = await createImageBitmap(blob);
  try {
    return findQrTexts(bitmap, opts);
  } finally {
    bitmap.close();
  }
}
