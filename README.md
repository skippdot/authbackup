# AuthBackup

[![CI](https://github.com/skippdot/authbackup/actions/workflows/ci.yml/badge.svg)](https://github.com/skippdot/authbackup/actions/workflows/ci.yml)
[![CodeQL](https://github.com/skippdot/authbackup/actions/workflows/codeql.yml/badge.svg)](https://github.com/skippdot/authbackup/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/skippdot/authbackup/badge)](https://scorecard.dev/viewer/?uri=github.com/skippdot/authbackup)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/17121/badge)](https://www.bestpractices.dev/projects/17121)
[![License: MIT](https://img.shields.io/github/license/skippdot/authbackup)](LICENSE)
[![Website](https://img.shields.io/website?url=https%3A%2F%2Fauthbackup.com&label=authbackup.com)](https://authbackup.com)

**A free, open-source 2FA authenticator for Chrome that works fully offline and never asks for an account.**

AuthBackup (Manifest V3) saves **TOTP keys straight from the QR code on a page**, copies one-time codes in one click, and
tracks where each key has copies (the **2+1 rule**). There are **no servers and no analytics**: the CSP of the extension
pages blocks all network requests, and the browser itself enforces it. **MIT licensed, free**, not affiliated with Google.
_Chrome Web Store listing coming soon._

Website: https://authbackup.com · Privacy policy: [PRIVACY.md](PRIVACY.md) · License: [MIT](LICENSE)

> [!IMPORTANT]
> Your keys exist **only in this browser** unless you back them up. Follow the **2+1 rule**: keep a key in this browser,
> in a phone app, and in a file or cloud copy. See [The 2+1 rule](#the-21-rule).

## Features

- **Grab from the page** — enable 2FA on a site, open the popup, and the extension finds the QR on screen (a screenshot of
  the visible tab via `activeTab`, plus hints from the DOM about where img/canvas/svg elements are). "Save + code" stores
  the key and copies the current code that the site asks for.
- **QR from an image** — paste with Cmd/Ctrl+V in the popup or on the Import page (which also supports drag-drop and
  picking several files).
- **Google Authenticator import** — `otpauth-migration://` (several keys in one QR): the protobuf is parsed and the keys
  are added to the registry.
- **One-click copy** — click a row to copy the code. If the code changes in under 3 seconds, the next one is copied. With
  5 or more keys there is a search box; Enter copies the first match.
- **Registry** — base32 key, hex seed, transfer QR for a phone, rename, order, manual entry.
- **Optional password** — AES-256-GCM, key derived with PBKDF2-SHA256 (600,000 iterations). Auto-lock on inactivity
  (5 min to 4 h, or until the browser closes), a lock button, and lock on browser close.
- **Export** — a "Google Authenticator" QR (`otpauth-migration://`, up to 10 keys per QR, several QRs with batch fields,
  PNG download), an encrypted backup file, plain JSON, and a `.txt` with `otpauth://` links (Aegis, 2FAS, Bitwarden and
  others). Restore accepts all three file formats. With a password set, export asks for it again.
- **Wide algorithm support** — SHA1/SHA256/SHA512, 6/7/8 digits, any period; HOTP with a counter.
- **Languages** — English and Russian, chosen by browser language.

> [!TIP]
> Open the popup with **`Alt+Shift+O`**, then click a row to copy its code in one click.

### The 2+1 rule

A key should exist in **this browser**, in **a phone app**, and in **a file or cloud**. The popup shows which copy is
missing and for how many keys (buttons "Move...", "Already there", "Save file..."), and a single "3 copies" line when
everything is covered. Copy kinds are `app` (Done in the Google Authenticator QR dialog, importing a Google Authenticator
export, or "Already there"), `file` (any export or a restore from a backup) and `cloud` (_reserved for a future sync_).
See `extension/lib/copies.js`.

## Install

> [!NOTE]
> The Chrome Web Store listing is **coming soon**. Until then, install the release zip as an unpacked extension:

1. Download `authbackup-<version>.zip` from [the latest release](https://github.com/skippdot/authbackup/releases/latest)
   and unzip it (or clone this repo and use the `extension/` folder).
2. Open `chrome://extensions` and enable Developer mode.
3. Click "Load unpacked" and select the unzipped folder.
4. Pin the icon to the toolbar.

> [!TIP]
> **Check what you downloaded.** Releases are built by GitHub Actions from the tag and carry signed build provenance:
> `gh attestation verify authbackup-<version>.zip --repo skippdot/authbackup`. The build is also _reproducible_:
> `git checkout v<version> && npm ci --ignore-scripts && npm run build` gives a byte-identical zip on any machine.

No build step is needed to use or develop the extension. `npm install` is needed for tests, vendor files and releases.

## npm scripts

| Script | What it does |
| --- | --- |
| `npm test` | Unit tests: base32 (RFC 4648), HOTP (RFC 4226), TOTP (RFC 6238), otpauth, Google Authenticator protobuf, QR, vault, export splitting, copy tracking, the site build (no third-party scripts without `GA_ID`), and release checks (en/ru dictionaries, test hooks, network use, inline styles); property-based fuzzing of every parser and the vault (`tests/unit/properties.test.js`) |
| `npm run fuzz` | The same properties with 100,000 random inputs each instead of 100 |
| `npm run vectors` | Rewrites `tests/vectors/core.json` from the extension core: the conformance cases the iOS core (`ios/Core`) must pass |
| `npm run crosscheck` | 2000 random keys: extension JS vs the independent Python reference, plus a Google Authenticator export round trip Python to JS |
| `npm run e2e` | Chromium with the extension plus the bench; video and screenshots go to `tests/artifacts/<time>/` (English UI) |
| `npm run e2e:ru` | The same with the Russian UI |
| `npm run bench` | Starts the bench at http://localhost:8793 |
| `npm run build` | Release checks, then a reproducible `dist/authbackup-<version>.zip` (for the Chrome Web Store) and `dist/SHA256SUMS` |
| `npm run assets` | 1280x800 screenshots (en, ru) and a 440x280 promo tile into `docs/store-assets/` |
| `npm run site` | Builds the authbackup.com site (`site/` plus the privacy policies) into `_site/`; deployed by `.github/workflows/pages.yml`, which sets `GA_ID` so only authbackup.com gets Google Analytics (see `DEPLOY.md`) |
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

**Secrets are never sent anywhere.** The extension has no host permissions, only `activeTab`; a screenshot of the tab is taken
only when the popup is opened or "Scan page" is clicked, and is kept in memory for the scan. The CSP of extension pages is
`default-src 'none'; connect-src 'none'`, so the browser itself blocks network requests; this is verifiable.

- **Without a password** the registry sits in `chrome.storage.local` of the profile in plain text.
- **With a password** `chrome.storage.local` holds only a vault `{ kdf: PBKDF2-SHA256/600,000/salt, iv, ct }`. GCM
  authenticates the ciphertext, so a wrong password or a tampered file gives an error, not garbage. After unlock the AES key
  lives in `chrome.storage.session` (browser memory, never written to disk, not exposed to content scripts) until
  auto-lock (`chrome.alarms` plus an expiry check on every read) or until Chrome closes. While the registry is unlocked the
  key can be read from process memory: the password protects against profile or disk theft and casual viewing, not against
  malware inside an already open session.

> [!WARNING]
> **The password cannot be recovered.** If you forget it, the keys are lost; keep an encrypted backup.

> [!WARNING]
> **Plain exports contain secrets.** Plain export files (JSON, otpauth.txt) and export QRs hold the keys as is; store and delete them carefully.

_Keeping 2FA keys in the same browser as passwords is a deliberate convenience trade-off._

## Self-hosting: website and test bench

**AuthBackup itself needs no server.** It runs entirely in the browser. Two optional pieces can be hosted:

- **Website**: a static copy of authbackup.com (8 languages, privacy policy, `llms.txt`).
- **Test bench**: a fake 2FA service that issues enrollment QR codes and checks codes. _Python standard library only;
  every secret is fake and lives in memory._

| Platform | Deploy | Website | Test bench | Config |
|---|---|:---:|:---:|---|
| [Docker](DEPLOY.md#docker--docker-compose) | `docker run -p 8080:8080 ghcr.io/skippdot/authbackup-site`<br>`docker run -p 8793:8080 ghcr.io/skippdot/authbackup-bench` | ✓ | ✓ | `Dockerfile`, `bench/Dockerfile`, `docker-compose.yml` |
| [Render](DEPLOY.md#render-website--bench) | <a href="https://render.com/deploy?repo=https://github.com/skippdot/authbackup"><img src="https://render.com/images/deploy-to-render-button.svg" alt="Deploy to Render" height="32"></a> | ✓ | ✓ | `render.yaml` |
| [Heroku](DEPLOY.md#heroku-bench) | <a href="https://heroku.com/deploy?template=https://github.com/skippdot/authbackup"><img src="https://www.herokucdn.com/deploy/button.svg" alt="Deploy to Heroku" height="32"></a> | | ✓ | `app.json`, `heroku.yml` |
| [Vercel](DEPLOY.md#vercel-website) | <a href="https://vercel.com/new/clone?repository-url=https://github.com/skippdot/authbackup"><img src="https://vercel.com/button" alt="Deploy with Vercel" height="32"></a> | ✓ | | `vercel.json` |
| [Netlify](DEPLOY.md#netlify-website) | <a href="https://app.netlify.com/start/deploy?repository=https://github.com/skippdot/authbackup"><img src="https://www.netlify.com/img/deploy/button.svg" alt="Deploy to Netlify" height="32"></a> | ✓ | | `netlify.toml` |
| [Google Cloud Run](DEPLOY.md#google-cloud-run) | <a href="https://deploy.cloud.run/?git_repo=https://github.com/skippdot/authbackup"><img src="https://deploy.cloud.run/button.svg" alt="Run on Google Cloud" height="32"></a> | ✓ | `gcloud run deploy` | `Dockerfile` |
| [Railway](DEPLOY.md#railway-bench) | `railway up` | | ✓ | `railway.json` |
| [Fly.io](DEPLOY.md#flyio-bench) | `fly launch --copy-config` | | ✓ | `fly.toml` |
| [AWS](DEPLOY.md#aws) | App Runner, Amplify, S3 + CloudFront | ✓ | ✓ | — |

> [!NOTE]
> _Only Docker and `docker compose` are tested (in CI, on every push)._ The images are built for linux/amd64 and arm64
> on every release, with signed provenance (`gh attestation verify oci://ghcr.io/skippdot/authbackup-bench:latest --repo skippdot/authbackup`). The platform configs follow each platform's
> documented format but have not been deployed there yet. Step-by-step instructions: [DEPLOY.md](DEPLOY.md).

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
tests/               unit, crosscheck, e2e, vectors/core.json (conformance cases for the mobile apps)
scripts/             vendor, build (zip), release-check, store-assets, test-extension (copy for e2e), site
docs/FORMATS.md      reference: accepted links and QR codes, backup file formats, storage
docs/store-assets/   Chrome Web Store screenshots and promo tile
site/                authbackup.com: landing page and privacy page template
ios/                 iPhone and iPad app (SwiftUI) and its core, checked against tests/vectors (ios/README.md)
```

## Quality & security

Every push and pull request to `main` runs in GitHub Actions (all actions are pinned to commit SHAs):

- **Lint:** ESLint for the extension, scripts and tests (`npm run lint`).
- **Unit tests and release check:** `npm test`. The release check fails the build on network calls in extension pages,
  inline styles that the CSP blocks, leftover test hooks, diverging en/ru dictionaries, and non-English text outside
  translation files.
- **Crosscheck:** `npm run crosscheck` compares the JS TOTP and Google Authenticator export code with an independent
  Python reference implementation.
- **E2E:** the real extension in real Chromium against the Python bench (`npm run e2e`), including CSP-violation checks.
- **iOS core:** `swift test` in `ios/Core` on macOS runs every case of `tests/vectors/core.json`, which the extension's
  JS core writes: links, exports and backup files must read the same on a phone as in the browser.
- **Fuzzing:** property-based tests ([fast-check](https://fast-check.dev/)) feed random and malformed QR text,
  `otpauth://` links, Google Authenticator protobuf and vaults to the parsers. _Invariant: anything the extension
  accepts can show a code, anything else is rejected with an error; flipping any bit of a vault makes it unreadable._
- **Python:** Ruff and Bandit on the bench (tools installed by hash, `bench/requirements-dev.txt`).
- **CodeQL** (JavaScript and Python), the **OpenSSF Scorecard**, and weekly **Dependabot** updates for npm, pip, Docker
  and Actions (a new version must be two weeks old before it is proposed).
- **Releases:** a `v*` tag builds the zip in CI (`.github/workflows/release.yml`), signs build provenance (Sigstore,
  `gh attestation verify`), and publishes the release with all assets at once. The website and test-bench images go to
  `ghcr.io/skippdot/authbackup-site` and `ghcr.io/skippdot/authbackup-bench` (linux/amd64 and arm64).

Report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## Contributing

Bug reports, ideas and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) for the process, the
requirements and the test policy. The links, QR codes and backup files that AuthBackup reads and writes are documented
in [docs/FORMATS.md](docs/FORMATS.md).
