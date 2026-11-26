# Contributing to AuthBackup

Bug reports, ideas and pull requests are welcome. AuthBackup is a small project run by volunteers, so please keep
each change focused on one topic.

## Report a bug or ask for a feature

Open an [issue](https://github.com/skippdot/authbackup/issues). For a bug, include:

- the AuthBackup version (shown on `chrome://extensions`), your Chrome version and OS;
- what you did, what you expected, and what happened instead;
- for a QR or file that fails to import, the error text.

> [!CAUTION]
> **Never post real 2FA secrets**, QR codes, screenshots of the registry, or backup files in an issue. Reproduce
> the problem with the keys from the test bench (`npm run bench`) or with a throwaway key.

We try to answer every issue and pull request within 7 days. The answer may be "no", with a reason.

## Report a vulnerability

Report vulnerabilities privately, never in a public issue. See [SECURITY.md](SECURITY.md).

## Send a pull request

1. Fork the repository and create a branch from `main`.
2. Make the change, with tests (see [Test policy](#test-policy)).
3. Run the checks locally:

   ```bash
   npm ci
   npm run lint        # ESLint, must report zero warnings
   npm test            # unit tests, property-based fuzzing, release checks
   npm run crosscheck  # JS vs the independent Python reference
   npm run e2e         # needed when the change touches the UI; also run e2e:ru if you changed UI text
   npm run vectors     # after a change to extension/lib parsing or backups: rewrites tests/vectors/core.json
   ```

   The e2e run needs a browser and a free port; see [Run the e2e tests locally](#run-the-e2e-tests-locally).

   A change to `tests/vectors/core.json` must still pass the iOS core: `ios/build.sh core` on a Mac, or the
   "iOS core" CI job. For the iOS app itself see `ios/README.md`.

4. Open a pull request against `main`. Say what the change does and why; add a screenshot for UI changes.
5. CI must pass. `main` is protected: every change goes through a pull request, and the lint, unit, Python, e2e,
   Docker and CodeQL checks are required. A maintainer reviews the pull request and squash-merges it.

## Run the e2e tests locally

`npm run e2e` loads the real extension into Chromium and runs it against the test bench, so it needs more than
`npm ci`:

- **Python 3** for the bench (`bench/server.py`, standard library only).
- **Chrome for Testing and ffmpeg** from Playwright. Install them once, and again after every Playwright update,
  because each Playwright version records video with its own ffmpeg build:

  ```bash
  npx playwright install chromium
  ```

  On Linux add `--with-deps` to get the system libraries, as CI does. Branded Google Chrome does not work: it no
  longer loads extensions with `--load-extension`. To use another Chromium build, set `CHROMIUM_PATH`.
- **Port 8794 free.** The test starts its own bench on it; stop any other local server on that port first, or the
  run stops with `Cannot listen on 127.0.0.1:8794`.

The run is headless; `HEADED=1 npm run e2e` shows the browser. On Linux the extension loads only in a headed
browser, so run it under a virtual display, as CI does: `HEADED=1 xvfb-run -a npm run e2e`. Video and screenshots
of every run go to `tests/artifacts/<time>/`.

## Requirements for acceptable contributions

- **Style.** Follow the ESLint configuration in `eslint.config.js` (`npm run lint` with no warnings). Python code in
  `bench/` must pass Ruff and Bandit.
- **No network.** Extension pages must not make network requests, send analytics, or load remote code. The CSP
  (`connect-src 'none'`) and the release check in `npm test` enforce this.
- **Permissions.** Do not add manifest permissions or host permissions without discussing it in an issue first.
- **Cryptography.** Use Web Crypto (`crypto.subtle`, `crypto.getRandomValues`). Do not implement cryptographic
  primitives yourself, and do not weaken the vault parameters (PBKDF2-SHA256, 600,000 iterations, AES-256-GCM).
- **Untrusted input.** Everything that comes from a QR code, the clipboard or a file is untrusted. Parsers must reject
  bad input with an error, never save a key that cannot produce a code.
- **UI text.** Every new string is a key in both `extension/_locales/en/messages.json` and
  `extension/_locales/ru/messages.json` (the release check fails otherwise). If you do not write Russian, put the
  English text in both files and say so in the pull request.
- **CSP.** No inline scripts or `style="..."` attributes in extension pages.
- **English.** Code, comments, docs and commit messages are in English. Other languages live only in the translation
  files (`extension/_locales/`, `scripts/locales/`, `site/i18n/`, `ios/App/Resources/*.xcstrings`).
- **Dependencies.** The extension has no runtime dependencies besides the vendored jsQR and qrcode-generator; avoid
  adding new ones. New dev dependency versions must be at least two weeks old.

## Test policy

Every pull request that adds major functionality or changes behavior adds automated tests for it, in the same pull
request:

- logic in `extension/lib/` gets unit tests in `tests/unit/` (`node:test`);
- a parser of untrusted input also gets a property in `tests/unit/properties.test.js` (fast-check);
- a user-visible flow gets a check in `tests/e2e.mjs`;
- a bug fix gets a regression test that fails without the fix;
- a change to how `extension/lib/` reads links, exports or backup files regenerates `tests/vectors/core.json`, and
  `ios/Core` is changed to match in the same pull request.

Pull requests that add functionality without tests are not merged.

## Releases (maintainers)

1. Bump the version in `extension/manifest.json`, `package.json` and `package-lock.json`.
2. Add a `## <YYYY-MM-DD>: <version> — <summary>` section to `CHANGELOG.md`. It becomes the release notes, so write it
   for users: what changed and whether they need to do anything. List every fixed vulnerability with its GHSA or CVE id.
3. Merge to `main`, then push the tag `v<version>`. `.github/workflows/release.yml` builds, signs and publishes the
   release.

## License

AuthBackup is MIT licensed. By contributing, you agree that your contribution is licensed under the
[MIT License](LICENSE) too.
