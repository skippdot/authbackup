# AuthBackup for Android

A native app for Android phones and tablets (Jetpack Compose, Android 11 and later) with the same job as the browser
extension and the iOS app: keep two-factor keys, show their codes, and make sure every key has a copy somewhere else.
Work in progress: not in Google Play yet.

What it does today, the same as the iOS app:

- Shows every key with its current code; a tap copies it. A TOTP code that changes in under 3 seconds copies the next
  one, an HOTP code advances the counter (as in the extension). The copied code is marked sensitive, so the system
  does not show it in its clipboard preview, and it is cleared after 90 seconds if it is still on the clipboard and
  AuthBackup is open (Android lets an app look at the clipboard only while it is in front).
- Adds keys from the camera, a screenshot or photo (several QR codes per image), the clipboard (links or an image),
  or typed in. Google Authenticator exports work across several QR codes: the scanner counts them ("2 of 3").
  Keys found in QR codes or links go through a preview first; keys already saved are shown and left out.
- Restores the extension's backup files (encrypted or plain JSON) at once, as the extension does, skipping keys already
  saved; text files with `otpauth://` links go through the preview. Writes the same encrypted backup file, which the
  extension and the iOS app restore. Shows keys as Google Authenticator export QR codes.
- Locks with biometrics or the screen lock (on by default when the device has a screen lock); codes lock again after a
  minute in the background, and the recent apps screen does not show them.
- English and Russian; the language can also be picked per app in the system settings (Android 13 and later).

Not yet: two-way QR sync with the extension, an encrypted copy in the cloud, Autofill, widgets.

## Where keys live

One file in the app's no-backup folder, encrypted with AES-256-GCM under a key in the Android Keystore that never
leaves the device and works only while it is unlocked. The app turns off Google backups and device-to-device transfer
for all its data, so keys are copied elsewhere only on purpose, as encrypted backup files (`docs/FORMATS.md`,
"Encrypted backup"). The app has no `INTERNET` permission, so it cannot reach the network: no servers, no accounts, no
analytics. QR codes are read with ZXing, on the device, without Google Play services.

## Layout

```
core/                     Kotlin module AuthBackupCore: a port of extension/lib (Base32, HOTP/TOTP, otpauth://,
                          otpauth-migration:// with the export splitting, backup files, PBKDF2 + AES-GCM). Plain JVM,
                          no Android APIs, so its tests run anywhere with a JDK.
core/src/test/            every case of tests/vectors/core.json
app/src/main/.../model/   KeyStore (the key list), SecretStore (the Keystore-encrypted file), AppLock, ImportBatch
                          (the import preview), QR reading and the clipboard
app/src/main/.../ui/      codes list, add keys, scanner, preview, manual entry, key details, settings and backups
app/src/main/res/         strings (values/ and values-ru/, the only Russian text), adaptive icon, backup rules
app/src/test/             KeyStore, ImportBatch and AppLock on memory stores
app/src/androidTest/      the backup cases of the vectors on the device's own crypto (DeviceCryptoTest) and a
                          walkthrough of the main screens (unlock, add, preview, codes, backup) with screenshots
gradle/libs.versions.toml dependency versions (each at least two weeks old when added)
```

## One core, checked against the extension

The extension's JS core (`extension/lib`) is the reference; `npm run vectors` writes `tests/vectors/core.json` from
it (see `ios/README.md` for what it covers). `android/core` must give the same result or the same error on every
case, like `ios/Core`, so a link, an export or a backup file reads the same in the browser, on an iPhone and on an
Android phone. The JVM tests use the JDK's PBKDF2 and AES-GCM, and Android has its own provider, so `./build.sh ui`
first runs the vectors' backup cases on the emulator (`DeviceCryptoTest`: PBKDF2 with a non-ASCII password, AES-GCM,
every backup file). It found one difference: Android refuses to derive a key from an empty password, which Web Crypto
accepts, so the core derives that one itself, as it already did for an empty salt.

## Build and test

Requires JDK 17 and the Android SDK (platform 37; `ANDROID_HOME`, or the default `~/Library/Android/sdk`). Gradle
comes with the wrapper.

```bash
./build.sh core     # the core against the vectors (JVM only, no Android SDK needed)
./build.sh test     # the app's unit tests (JVM)
./build.sh lint     # Android lint, every warning fails
./build.sh apk      # a debug build: app/build/outputs/apk/debug/app-debug.apk
./build.sh ui       # crypto on the device, then the UI walkthrough: screenshots and a video in build/ui-en-Phone/
./build.sh device   # installs a debug build on the one connected device
```

`UI_LANG=ru` runs the walkthrough in Russian. `ui` uses the script's own emulators, "AuthBackup_Phone" (Pixel 7) and "AuthBackup_Tablet" (`AVD=AuthBackup_Tablet`),
created from the Android 14 Google APIs image if missing, and stops the emulator at the end (`KEEP=1` leaves it
running). It clears the app's data, so every run starts with no keys, and sets a test screen lock PIN on that
emulator, so the walkthrough covers unlocking. The test keys are public test values (RFC 6238, the Google
Authenticator wiki) or plain words in Base32.
