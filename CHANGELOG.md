# CHANGELOG

## Unreleased

- OpenSSF Best Practices: passing badge ([project 17121](https://www.bestpractices.dev/projects/17121)), shown in the README.
- `CONTRIBUTING.md`: how to report bugs, the pull request process, requirements for contributions, and the test
  policy (new functionality comes with tests). The website footer (home and privacy pages) and `llms.txt` link to it.
- `docs/FORMATS.md`: reference for everything AuthBackup reads and writes: `otpauth://` and `otpauth-migration://`
  links, QR sources, the plain and encrypted backup files (with steps to decrypt one without AuthBackup), `otpauth.txt`,
  the Google Authenticator export QR, and storage. Linked from the README and `llms.txt`.
- Fixed: restoring a JSON backup entry without an `account` field saved the key under the name "undefined"; the name
  now stays empty. Found while checking `docs/FORMATS.md` against the code.
- `npm run lint` (and so CI) fails on any ESLint warning, not only on errors.
- Fixed CodeQL findings in development scripts (none in the extension): the release-notes script escapes every regular
  expression metacharacter in the version, and the crosscheck test draws its random values from `node:crypto`.

## 2026-11-25: 0.3.1 — fuzzing fixes, signed reproducible releases

- Property-based fuzzing (fast-check, `tests/unit/properties.test.js`, `npm run fuzz`) of every parser and the vault.
  It found, and this release fixes: an `otpauth://hotp` link with a non-numeric `counter` was saved and then could
  not show a code; a one-character secret (less than a byte) was accepted; a Google Authenticator export entry with
  an empty secret, or a HOTP counter beyond 2^53, was imported instead of skipped; an issuer containing ":" leaked into
  the account name; names in Google exports were trimmed only when they had an issuer. The protobuf reader now
  rejects varints longer than 10 bytes and fixed-width fields past the end of the data.
- Reproducible build: `npm run build` normalizes file order, timestamps, permissions and zip extra fields, so a tag
  gives the same sha256 on any machine (checked: macOS arm64 and Linux amd64). The 0.3.0 zip was not reproducible:
  it carried file modification times.
- Releases are built by GitHub Actions on a `v*` tag (`release.yml`): unit tests, the zip, signed build provenance
  (`gh attestation verify`), and a release published with all assets at once. Website and test-bench images are
  pushed to ghcr.io for linux/amd64 and arm64.
- Supply chain: CI installs Ruff and Bandit by hash (`bench/requirements-dev.txt`); Dependabot also covers pip and
  waits two weeks before proposing a new version; Node majors are moved by hand (LTS only).
- README: the self-hosting options are one table (platform, one-click button, what it deploys, config file).

## 2026-11-25: 0.3.0 — first public release

- Release zip on GitHub Releases with `SHA256SUMS`, built by `npm run build` (not yet reproducible, see 0.3.1).
- CI on every push and PR: ESLint, unit and release checks, JS-vs-Python crosscheck, Ruff, Bandit, e2e in real
  Chromium, Docker image smoke tests; CodeQL and OpenSSF Scorecard; Dependabot for actions, npm and Docker;
  all actions pinned to commit SHAs, base images pinned to digests; `SECURITY.md` with private reporting.
- Website: Open Graph and JSON-LD, sitemap with hreflang, `robots.txt`, `llms.txt` / `llms-full.txt` for agents,
  install steps in all 8 languages, a language suggestion banner that remembers the choice.
- Self-hosting: Dockerfiles for the website (nginx, security headers) and the test bench (`/healthz`, capped
  memory, path-safe static files), `docker compose`, and configs for Render, Railway, Fly.io, Heroku, Cloud Run,
  Vercel and Netlify (see `DEPLOY.md`).

## 2026-11-25: open repository and the authbackup.com site

- Source released under MIT: github.com/skippdot/authbackup.
- Site authbackup.com: landing page and the privacy policy rendered from `PRIVACY.md` (`/privacy`) by `npm run site`; published through
  GitHub Actions to GitHub Pages. The site loads nothing from third-party servers.
- PRIVACY.md: line about the 2+1 copy kinds; contact is GitHub Issues. Store screenshots are taken at the start of a
  TOTP period (otherwise the toast showed the next code).

## 2026-11-25: "2+1 copies" card

- The generic "no backup" notice is replaced by the 2+1 rule: a key should be in this browser, in a phone app, and in a
  file or cloud. Three copy kinds are tracked (`lib/copies.js`): `app` (Done in the Google Authenticator QR dialog,
  importing a Google Authenticator export, including for already saved keys, or the "Already there" button), `file`
  (any export or a restore from a backup) and `cloud` (reserved for QR sync with a future mobile AuthBackup).
- Popup: a card with three rows and the buttons "Move...", "Already there", "Save file...", plus an email hint; when
  everything is covered it shows "3 copies, file <date>"; an empty list shows the rule in one sentence. The registry
  page shows status per kind.
- Old 0.3.0 marks (`backedUp`) are not counted because their copy kind is unknown; the backup date moved to `lastFileAt`.
- Tests: unit tests for `copyStatus`/`withCopies`/`addAccounts` (mock `chrome.storage`); e2e en/ru covers every card step.
- The authbackup.com domain was registered.

## 2026-11-25: AuthBackup name and export files

- The manifest name is localized (`extName`): "AuthBackup — 2FA Authenticator"
  and a Russian equivalent; `short_name` is AuthBackup.
- Export files: `authbackup-<time>.json`, `.encrypted.json`, `authbackup-otpauth-<time>.txt`, field `app: "authbackup"`.
  Restore does not check the `app` field.
- Release archive `dist/authbackup-<version>.zip`; store assets re-shot.

## 2026-11-24: 0.3.0 (Chrome Web Store preparation)

- English UI: `_locales/en` (default) and `_locales/ru`, chosen by browser language; numbers and dates follow the
  translation language; the paste hint shows Cmd+V or Ctrl+V by platform.
- Extension page CSP `default-src 'none'; connect-src 'none'`: the network is closed by the browser. `fetch(dataUrl)` in
  the scanner replaced by base64 parsing, inline styles replaced by classes.
- Reminder for keys without a backup: popup banner, status and date of the last backup in the export card, a
  "keys exist only in this browser" line in the empty popup.
- "Not affiliated with Google" note on the registry page; jsQR/qrcode-generator licenses in `vendor/THIRD_PARTY_LICENSES.txt`.
- Test hooks removed from the release: no `self` debug hooks; `?tab=` is injected only into the e2e copy of the extension.
- Release: `scripts/release-check.mjs` (en/ru dictionaries, code keys, hooks, network, eval, inline styles, permissions),
  `npm run build` produces the zip, `npm run assets` produces 1280x800 en/ru screenshots and the promo tile.
- Documents: `PRIVACY.md`, store listing and publishing checklist.
- Tests: unit 12/12, e2e 37/37 in en and ru (new: backup reminder, no CSP violations).

## 2026-11-23: 0.2.0

- Registry password: AES-256-GCM, key from PBKDF2-SHA256 (600,000 iterations); session key in `chrome.storage.session`,
  auto-lock on inactivity (5 min to 4 h, or until the browser closes), lock button, unlock screen in popup and registry;
  change and remove password. New permission `alarms`.
- Export: "Google Authenticator" QR (otpauth-migration, up to 10 keys per QR, batch fields, PNG), encrypted backup, plain
  JSON, `.txt` with otpauth:// links; key selection; keys incompatible with Google's format (period other than 30 s,
  7 digits) are listed with the reason.
- Restore: encrypted backup (asks for the password) and `.txt` with links, in addition to the old JSON.
- Fixed: the `hidden` attribute lost to `display: grid/flex` classes.
- Tests: unit 11/11 (vault, tampered ciphertext, export splitting), e2e 31/31.

## 2026-11-23: 0.1.0

- MV3 Chrome extension: automatic QR scan of the page when the popup opens, "Save + code", copy a code with a click, search.
- Import: paste an image or link, drag-drop and multi-file pick, Google Authenticator export (`otpauth-migration://`, protobuf).
- Registry: base32 and hex seed, transfer QR, rename, order, JSON backup/restore, manual entry, HOTP.
- Bench `bench/` (Python stdlib): 2FA enrollment, 3-key Google Authenticator export, code verification with an independent
  reference, RFC 6238 self-check.
- Tests: unit (RFC 4648/4226/6238, protobuf, QR), JS vs Python cross-check, e2e in Chromium with video, 13/13.
