# AuthBackup

> AuthBackup is a free, open-source (MIT), offline 2FA/TOTP authenticator extension for Google Chrome (Manifest V3, version {{version}}). It saves two-factor keys straight from the QR code on a page, copies one-time codes in one click, and tracks that every key has backups in three places (the "2+1 rule"). It has no servers, no accounts and no analytics.

AuthBackup is an independent project, not affiliated with Google. The Chrome Web Store listing is not published yet; until then it is installed from a release zip (see Install). The website is available in English, Spanish, Brazilian Portuguese, French, German, Japanese, Simplified Chinese and Indonesian. The extension UI is English and Russian, chosen by browser language.

## What it is

- [Website (English)](https://authbackup.com/): landing page with the feature overview. Translations: [es](https://authbackup.com/es/), [pt-BR](https://authbackup.com/pt-br/), [fr](https://authbackup.com/fr/), [de](https://authbackup.com/de/), [ja](https://authbackup.com/ja/), [zh-CN](https://authbackup.com/zh-cn/), [id](https://authbackup.com/id/).
- [Full reference for agents](https://authbackup.com/llms-full.txt): the complete README and privacy policy as one markdown file.

## Install

Chrome Web Store: coming soon. Until then (Chrome 116 or newer, desktop):

1. Download the latest release zip (`authbackup-<version>.zip`) from [GitHub Releases](https://github.com/skippdot/authbackup/releases/latest).
2. Unzip it into a folder you will keep (Chrome loads the extension from that folder).
3. Open `chrome://extensions` and turn on Developer mode.
4. Click "Load unpacked" and pick the unzipped folder, then pin the icon to the toolbar. Shortcut to open the popup: Alt+Shift+O.

- [Latest release](https://github.com/skippdot/authbackup/releases/latest): the zip to install.
- [Install from source](https://github.com/skippdot/authbackup#install): load the `extension/` folder of the repository the same way; no build step is needed.

## Verify the offline claim

Do not take "offline" on trust; each point can be checked in a few minutes.

- The Content Security Policy of every extension page is `default-src 'none'; ... connect-src 'none'`, so the browser itself blocks all network requests. Read it in `extension/manifest.json` (`content_security_policy`) or on `chrome://extensions` after installing.
- The extension requests no host permissions. Its permissions are only `storage`, `activeTab`, `scripting`, `clipboardWrite` and `alarms`; a screenshot of the current tab is taken only when you open the popup or click "Scan page", and it stays in memory.
- It loads no remote code and has no analytics or telemetry. This website also loads nothing from third parties (no CDNs, fonts, analytics).
- The whole source is public and MIT-licensed, so everything above can be audited.

- [manifest.json](https://github.com/skippdot/authbackup/blob/HEAD/extension/manifest.json): permissions and CSP.
- [Security model](https://github.com/skippdot/authbackup#security-model): what is and is not protected.
- [Source code](https://github.com/skippdot/authbackup/tree/HEAD/extension): the extension itself.

## Privacy

No data leaves the device. Keys live in `chrome.storage.local` of the browser profile, optionally encrypted with a password (AES-256-GCM, key from PBKDF2-SHA256).

- [Privacy policy](https://authbackup.com/privacy): every piece of data the extension touches and where it stays.

## Source & license

- [GitHub repository](https://github.com/skippdot/authbackup): source, issues (also the support channel), releases.
- [License (MIT)](https://github.com/skippdot/authbackup/blob/HEAD/LICENSE)
- [Changelog](https://github.com/skippdot/authbackup/blob/HEAD/CHANGELOG.md)

## Security

- A password is optional. Without it the key list is stored in plain text in the browser profile; with it, the profile holds only an encrypted vault. A forgotten password cannot be recovered.
- Plain export files (JSON, otpauth.txt) and export QR codes contain the secrets as is. Keep them private.
- [Security model](https://github.com/skippdot/authbackup#security-model)
- [Report a problem](https://github.com/skippdot/authbackup/issues)

## Data formats

Import and export use open formats, so keys are never locked in.

- Export JSON: plain list of keys (secrets in clear text).
- Encrypted JSON backup: password-protected file; restore asks for the password.
- `otpauth.txt`: one `otpauth://` link per line (works with Aegis, 2FAS, Bitwarden and others).
- Google Authenticator migration QR (`otpauth-migration://`): up to 10 keys per QR, several QRs for more; import and export, as an image or from the page.
- Algorithms SHA1/SHA256/SHA512, 6/7/8 digits, any period; HOTP with a counter.

## FAQ

- Does it work without internet? Yes, it never uses the network.
- Is it free? Yes, MIT-licensed, no accounts, no paid tier.
- Does it sync through my Google account? No. Keep copies yourself: this browser, an app on your phone, and an encrypted file or cloud drive.
- Can I move my keys from Google Authenticator? Yes, import the "Export accounts" QR; several keys at once are supported.
- What happens if I lose the browser profile? Restore from the encrypted backup file or a phone app; this is what the "2+1 rule" reminders are for.
- Was it called TOTP Grab before? Yes; old `totp-grab-backup-*` files still restore.

## Optional

- [Full reference](https://authbackup.com/llms-full.txt): README and privacy policy, complete.
