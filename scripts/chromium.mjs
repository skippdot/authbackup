// Path to Chromium for Playwright. Branded Google Chrome no longer honours --load-extension,
// so we take Chrome for Testing from the Playwright cache (any build) or CHROMIUM_PATH.
// On Linux (CI) we use Playwright's own bundled full Chromium (`npx playwright install chromium`);
// extension tests there must run headed (HEADED=1 under xvfb), because the headless shell cannot load extensions.
import { readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (process.platform === 'darwin') {
    const cache = join(homedir(), 'Library/Caches/ms-playwright');
    const dirs = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
    for (const d of dirs) {
      const p = join(cache, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
      if (existsSync(p)) return p;
    }
  }
  const bundled = chromium.executablePath();
  return existsSync(bundled) ? bundled : undefined; // undefined: let Playwright report that the browser is missing
}
