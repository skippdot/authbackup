# AuthBackup — Privacy Policy

_Last updated: 26 November 2026 · applies to version 0.3.0 and later_

AuthBackup is a browser extension that stores two-factor authentication (2FA) keys and shows one-time codes.
It works entirely on your device. **It has no servers, sends nothing over the network and contains no analytics,
telemetry or advertising.** The extension's Content Security Policy (`connect-src 'none'`) blocks network requests
from all its pages, so it could not send your data anywhere even by mistake.

## What data the extension handles

| Data | Why | Where it stays |
| --- | --- | --- |
| 2FA secrets (TOTP/HOTP keys) and their settings: algorithm, number of digits, period, counter | To generate one-time codes | In your browser profile (`chrome.storage.local`), encrypted with your password if you set one |
| Service and account names from the QR code (for example `Acme Cloud` and `me@example.com`) | To label your keys | Same as above |
| A picture of the visible part of the current tab | To find a QR code on the page when you open the popup or click **Scan page** | Only in memory for the duration of the scan. It is never saved or sent |
| Settings: auto-lock time and which kinds of copies each key has: phone app, file, cloud (random IDs and dates only) | To lock the key list and remind you to keep 2+1 copies | `chrome.storage.local` |
| The encryption key, after you unlock with your password | To show codes without asking for the password every time | `chrome.storage.session`: browser memory only, cleared on lock and when Chrome closes |

The extension reads a tab only after you act: it captures the page when you click the toolbar icon or **Scan page**,
using the `activeTab` permission. It has no access to your other tabs, your browsing history or the websites you visit.
The clipboard is used only when you click a code (the code is copied) or paste a QR image or link into the extension.

## What the extension does not do

- It does not collect, transmit, sell or share any data. The developer never receives your keys or any other information.
- It does not use your data for advertising, profiling, creditworthiness or any purpose other than showing your codes.
- It does not load or run remote code.
- It does not sync your keys through your Google account.

## Your control over the data

- **Export.** You can export your keys to a file (plain or password-encrypted) or to Google Authenticator transfer QR codes.
  Exported files are stored where you save them and are your responsibility. Plain-text exports contain the secrets as is.
- **Delete.** You can delete any key in the extension. Removing the extension deletes all of its data from your browser.
- **Password.** With a password, keys are encrypted with AES-256-GCM using a key derived via PBKDF2-SHA256
  (600,000 iterations). A forgotten password cannot be recovered by anyone, including the developer.

## The authbackup.com website

This policy is about the extension. The website authbackup.com is separate from it: the extension never contacts the
site, and the site cannot see your keys. The site counts visits with Google Analytics 4 (pages viewed, the referring
page, approximate location, browser and device type). Google Analytics sets cookies on authbackup.com (`_ga`,
`_ga_<ID>`), and Google processes this data under its [privacy policy](https://policies.google.com/privacy). The site
has no forms or accounts and collects nothing else. A content blocker or the
[Google Analytics opt-out add-on](https://tools.google.com/dlpage/gaoptout) stops the measurement. Copies of the site
that other people host from the source code have no analytics unless their operator turns it on.

## Children

The extension is not directed at children and does not knowingly handle children's data.

## Changes

If this policy changes, the new version will be published at the same address with a new date. Because the extension
does not collect data, a change cannot apply to data collected earlier.

## Contact

Questions about this policy: open an issue at https://github.com/skippdot/authbackup/issues or use the support contact
on the extension's Chrome Web Store page. The source code is public: https://github.com/skippdot/authbackup
