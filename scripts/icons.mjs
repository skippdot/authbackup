// Renders the extension icons and the iOS app icon from SVG via Playwright (no graphics editors needed).
import { chromium } from 'playwright';
import { chromiumPath } from './chromium.mjs';

const svg = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 64 64">
  <rect x="2" y="2" width="60" height="60" rx="14" fill="#2f5bea"/>
  <g fill="#fff">
    <rect x="11" y="11" width="16" height="16" rx="3"/><rect x="37" y="11" width="16" height="16" rx="3"/>
    <rect x="11" y="37" width="16" height="16" rx="3"/>
  </g>
  <g fill="#2f5bea"><rect x="15" y="15" width="8" height="8" rx="1"/><rect x="41" y="15" width="8" height="8" rx="1"/><rect x="15" y="41" width="8" height="8" rx="1"/></g>
  <circle cx="45" cy="45" r="10" fill="none" stroke="#fff" stroke-width="4"/>
  <path d="M45 39v6l4 3" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>
</svg>`;

// iOS draws its own rounded corners and wants an opaque, full-bleed square: the same mark on a plain field.
const appIconSvg = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="-1 -1 66 66">
  <rect x="-8" y="-8" width="80" height="80" fill="#2f5bea"/>
  <g fill="#fff">
    <rect x="11" y="11" width="16" height="16" rx="3"/><rect x="37" y="11" width="16" height="16" rx="3"/>
    <rect x="11" y="37" width="16" height="16" rx="3"/>
  </g>
  <g fill="#2f5bea"><rect x="15" y="15" width="8" height="8" rx="1"/><rect x="41" y="15" width="8" height="8" rx="1"/><rect x="15" y="41" width="8" height="8" rx="1"/></g>
  <circle cx="45" cy="45" r="10" fill="none" stroke="#fff" stroke-width="4"/>
  <path d="M45 39v6l4 3" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>
</svg>`;

const browser = await chromium.launch({ executablePath: chromiumPath() });
const page = await browser.newPage();
for (const s of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: s, height: s });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(s)}</body></html>`);
  await page.locator('svg').screenshot({ path: `extension/icons/${s}.png`, omitBackground: true });
}
await page.setViewportSize({ width: 1024, height: 1024 });
await page.setContent(`<html><body style="margin:0">${appIconSvg(1024)}</body></html>`);
await page.locator('svg').screenshot({ path: 'ios/App/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png' });
await browser.close();
console.log('icons ok');
