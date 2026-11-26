# AuthBackup for iPhone and iPad

A native SwiftUI app with the same job as the browser extension: keep two-factor keys, show their codes, and make sure
every key has a copy somewhere else. Work in progress: not in the App Store yet.

What it does today:

- Shows every key with its current code; a tap copies it. A TOTP code that changes in under 3 seconds copies the next
  one, an HOTP code advances the counter (as in the extension). The clipboard item stays on this device (no Universal
  Clipboard) and expires after 90 seconds.
- Adds keys from the camera, a screenshot or photo (several QR codes per image), the clipboard (links or an image),
  or typed in. Google Authenticator exports work across several QR codes: the scanner counts them ("2 of 3").
  Keys found in QR codes or links go through a preview first; keys already saved are shown and left out.
- Restores the extension's backup files (encrypted or plain JSON) at once, as the extension does, skipping keys already
  saved; text files with `otpauth://` links go through the preview. Writes the same encrypted backup file, which the
  extension restores. Shows keys as Google Authenticator export QR codes.
- Locks with Face ID, Touch ID or the passcode (on by default when the device has a passcode); codes lock again after a
  minute in the background, and a cover hides them in the app switcher.
- English and Russian.

Not yet: two-way QR sync with the extension, an encrypted copy in iCloud, the AutoFill verification code provider,
widgets.

## Where keys live

One Keychain item, `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`: not in iCloud Keychain, not carried to another
device by a device backup, readable only while the device is unlocked. Copies elsewhere are made on purpose, as
encrypted backup files (`docs/FORMATS.md`, "Encrypted backup"). The app makes no network requests: no servers, no
accounts, no analytics.

## Layout

```
Core/                     Swift package AuthBackupCore: a port of extension/lib (Base32, HOTP/TOTP, otpauth://,
                          otpauth-migration:// with the export splitting, backup files, PBKDF2 + AES-GCM). No UIKit.
Core/Tests/               every case of tests/vectors/core.json
App/Sources/Model/        KeyStore (the list in the Keychain), AppLock, ImportBatch (the import preview), QR reading
App/Sources/Views/        codes list, add keys, scanner, preview, manual entry, key details, settings and backups
App/Resources/            asset catalog, Localizable.xcstrings and InfoPlist.xcstrings (the only Russian text), privacy manifest
AppTests/                 KeyStore and ImportBatch on a memory store
UITests/                  a walkthrough of the main screens (unlock, add, preview, codes, backup) with screenshots
project.yml               XcodeGen: generates AuthBackup.xcodeproj and App/Info.plist (both not committed)
tools/check-strings.py    fails when a string in the code has no Russian translation, or the catalog keeps an unused one
```

## One core, checked against the extension

The extension's JS core (`extension/lib`) is the reference. `npm run vectors` writes `tests/vectors/core.json` from it:
Base32, ~320 TOTP/HOTP codes, ~80 `otpauth://` links (including the awkward ones: `+` read as a space, `%3A`,
`../` in the label, `digits=6abc`), Google Authenticator exports (damaged, truncated, unknown fields, MD5, counters
past 2^53), the export splitting, deduplication keys, backup entries, and backup files with PBKDF2 and AES-GCM.
`ios/Core` must give the same result or the same error on every case; `npm test` fails when the file no longer
matches the JS core, so a change to the extension's parsing shows up as a failing iOS test until both agree.
The Android app will be checked against the same file.

## Build and test

Requires Xcode 27 and [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).

```bash
./build.sh core     # the core against the vectors (swift test, no simulator)
./build.sh test     # the app's unit tests in a simulator
./build.sh ui       # UI walkthrough: screenshots and a video in build/ui-en/ (UI_LANG=ru for Russian)
./build.sh sim      # a simulator build
./build.sh device   # a signed build for a connected device (needs DEVELOPMENT_TEAM, see below)
python3 tools/check-strings.py   # after a build: every string translated
```

`sim`, `test` and `ui` use the script's own "AuthBackup iPhone 17" simulator (created if missing; `SIM_ID=<udid>`
picks another, for example an iPad). `ui` resets its Keychain, enrolls Face ID and answers the Face ID prompt, so the
walkthrough starts with no keys and covers unlocking. The test keys are public test values (RFC 6238, the Google
Authenticator wiki) or plain words in Base32.

The Apple team is not in the repository. For `./build.sh device`, set `DEVELOPMENT_TEAM` to your team ID in the
environment or put `DEVELOPMENT_TEAM=<team ID>` in `ios/local.env` (ignored by git); in Xcode, pick the team under
Signing & Capabilities.
