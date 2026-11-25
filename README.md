# AuthBackup

Offline 2FA authenticator for Chrome (Manifest V3). It saves TOTP keys straight from the QR code on a page, copies
one-time codes in one click, and tracks where each key has copies (the 2+1 rule). No servers, no analytics: the CSP of
the extension pages blocks all network requests.

Website: https://authbackup.com · Privacy policy: [PRIVACY.md](PRIVACY.md) · License: MIT. Not affiliated with Google.

Previously named TOTP Grab (renamed 2026-11-25; old `totp-grab-backup-*` files still restore).

## Features

- **QR on the page.** Enable 2FA on a site, open the popup, and the extension finds the QR on screen (a screenshot of the
  visible tab via `activeTab`, plus hints from the DOM about where img/canvas/svg elements are). "Save + code" stores the
  key and copies the current code that the site asks for.
- **QR from an image.** Paste with Cmd/Ctrl+V in the popup or on the Import page (which also supports drag-drop and
  picking several files).
- **Google Authenticator export** (`otpauth-migration://`, several keys in one QR): the protobuf is parsed and the keys
  are added to the registry.
- **Click a row to copy the code.** If the code changes in under 3 seconds, the next one is copied. With 5 or more keys
  there is a search box; Enter copies the first match.
- **Registry:** base32 key, hex seed, transfer QR for a phone, rename, order, manual entry.
- **Optional password** for the registry: AES-256-GCM, key derived with PBKDF2-SHA256 (600,000 iterations). Auto-lock on
  inactivity (5 min to 4 h, or until the browser closes), a lock button, and lock on browser close.
- **Export:** a "Google Authenticator" QR (`otpauth-migration://`, up to 10 keys per QR, several QRs with batch fields,
  PNG download), an encrypted backup file, plain JSON, and a `.txt` with `otpauth://` links (Aegis, 2FAS, Bitwarden and
  others). Restore accepts all three file formats. With a password set, export asks for it again.
- SHA1/SHA256/SHA512, 6/7/8 digits, any period; HOTP with a counter.
- **The 2+1 rule.** A key should exist in this browser, in a phone app, and in a file or cloud. The popup shows which copy
  is missing and for how many keys (buttons "Move...", "Already there", "Save file..."), and a single "3 copies" line when
  everything is covered. Copy kinds are `app` (Done in the Google Authenticator QR dialog, importing a Google
  Authenticator export, or "Already there"), `file` (any export or a restore from a backup) and `cloud` (reserved for a
  future sync). See `extension/lib/copies.js`.
- Shortcut: `Alt+Shift+O`.
- UI in English and Russian, chosen by browser language.

## Install

1. Open `chrome://extensions` and enable Developer mode.
2. Click "Load unpacked" and select the `extension/` folder.
3. Pin the icon to the toolbar.

No build step is needed to use or develop the extension. `npm install` is needed for tests, vendor files and releases.

## npm scripts

| Script | What it does |
| --- | --- |
| `npm test` | Unit tests: base32 (RFC 4648), HOTP (RFC 4226), TOTP (RFC 6238), otpauth, Google Authenticator protobuf, QR, vault, export splitting, copy tracking, and release checks (en/ru dictionaries, test hooks, network use, inline styles) |
| `npm run crosscheck` | 2000 random keys: extension JS vs the independent Python reference, plus a Google Authenticator export round trip Python to JS |
| `npm run e2e` | Chromium with the extension plus the bench; video and screenshots go to `tests/artifacts/<time>/` (English UI) |
| `npm run e2e:ru` | The same with the Russian UI |
| `npm run bench` | Starts the bench at http://localhost:8793 |
| `npm run build` | Release checks, then `dist/authbackup-<version>.zip` for the Chrome Web Store |
| `npm run assets` | 1280x800 screenshots (en, ru) and a 440x280 promo tile into `docs/store-assets/` |
| `npm run site` | Builds the authbackup.com site (`site/` plus the privacy policies) into `_site/`; deployed by `.github/workflows/pages.yml` |
| `npm run vendor` | Copies jsQR and qrcode-generator into `extension/vendor/` as ES modules |

The e2e run needs Chrome for Testing (taken from the Playwright cache or `CHROMIUM_PATH`), because branded Chrome no
longer loads extensions through `--load-extension`. The test copy of the extension (`scripts/test-extension.mjs`) differs
from the release: it has host permissions (the test cannot click the toolbar icon), a single language in `_locales`
(Chrome's UI language cannot be switched with `--lang` on macOS), and a `?tab=` parameter in the popup.

The e2e test covers the full path: the bench shows an enrollment QR, the popup auto-scans it, "Save + code" stores the key,
and the bench accepts the code. It then imports a Google Authenticator export from the page and from a PNG file through the
import page, with the server verifying every code. After that it exercises the password (no secrets in storage, lock by
button and alarm, wrong and right password), a Google Authenticator export to PNG and back, an encrypted backup and
`otpauth.txt`, restore, changing and removing the password, the backup reminder, and the absence of CSP violations.
Assertion texts come from the same `messages.json`.

## Bench

```bash
npm run bench        # http://localhost:8793
```

A fake "service with 2FA" in Python (stdlib only). It generates enrollment QRs with chosen parameters and a Google
Authenticator export QR with 3 keys (SHA1/6, SHA256/8, SHA512/6), shows the codes the server expects, and verifies entered
codes (a window of +-1 step, like real services). The reference in `bench/otp_ref.py` is written independently of the
extension's JavaScript.

## Security model

Secrets are never sent anywhere. The extension has no host permissions, only `activeTab`; a screenshot of the tab is taken
only when the popup is opened or "Scan page" is clicked, and is kept in memory for the scan. The CSP of extension pages is
`default-src 'none'; connect-src 'none'`, so the browser itself blocks network requests; this is verifiable.

- **Without a password** the registry sits in `chrome.storage.local` of the profile in plain text.
- **With a password** `chrome.storage.local` holds only a vault `{ kdf: PBKDF2-SHA256/600,000/salt, iv, ct }`. GCM
  authenticates the ciphertext, so a wrong password or a tampered file gives an error, not garbage. After unlock the AES key
  lives in `chrome.storage.session` (browser memory, never written to disk, not exposed to content scripts) until
  auto-lock (`chrome.alarms` plus an expiry check on every read) or until Chrome closes. While the registry is unlocked the
  key can be read from process memory: the password protects against profile or disk theft and casual viewing, not against
  malware inside an already open session.
- The password cannot be recovered. If you forget it, the keys are lost; keep an encrypted backup.
- Plain export files (JSON, otpauth.txt) and export QRs contain the secrets as is.

Keeping 2FA keys in the same browser as passwords is a deliberate convenience trade-off.

## Project layout

```
extension/
  manifest.json      MV3; permissions: storage, activeTab, scripting, clipboardWrite, alarms
  background.js      service worker: tab scan, auto-lock alarm
  popup.*            code list, page findings, paste, lock screen
  manage.*           import of files/links, manual entry, registry, export, password
  lib/base32.js      RFC 4648
  lib/totp.js        HOTP/TOTP on Web Crypto
  lib/otpauth.js     otpauth:// parser and builder
  lib/migration.js   otpauth-migration:// (hand-written protobuf) and export splitting into QRs
  lib/vault.js       PBKDF2 to AES-GCM: registry vault and encrypted backup
  lib/store.js       registry with transparent encryption, lock, auto-lock
  lib/lockui.js      unlock form
  lib/qr.js          jsQR + OffscreenCanvas, white border and scaling of regions
  lib/scan.js        captureVisibleTab + candidates from the DOM
  lib/copies.js      2+1 rule: which copies (app / file / cloud) each key has
  lib/i18n.js        t() over chrome.i18n, data-i18n in markup
  _locales/en|ru     UI strings (en is the default)
  vendor/            jsQR (Apache-2.0), qrcode-generator (MIT) as ES modules + THIRD_PARTY_LICENSES.txt
bench/               server.py + otp_ref.py + bench page
tests/               unit, crosscheck, e2e
scripts/             vendor, build (zip), release-check, store-assets, test-extension (copy for e2e), site
docs/store-assets/   Chrome Web Store screenshots and promo tile
site/                authbackup.com: landing page and privacy page template
```
