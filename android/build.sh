#!/bin/zsh
# Builds and tests AuthBackup for Android. Usage: ./build.sh [core|test|lint|apk|ui|device]
#   core   - the OTP core against tests/vectors/core.json (JVM only, no Android SDK needed; run on every core change)
#   test   - the app's unit tests (JVM)
#   lint   - Android lint; every warning fails
#   apk    - a debug build: app/build/outputs/apk/debug/app-debug.apk
#   ui     - the backup crypto on the device, then the UI walkthrough with screenshots and a video in
#            build/ui-<lang>-<Phone|Tablet>/ (UI_LANG=ru for Russian, AVD=AuthBackup_Tablet for the tablet;
#            UI_OUT overrides the folder)
#   device - installs a debug build on the one connected device (adb -d)
# ui runs in the script's own emulators "AuthBackup_Phone" and "AuthBackup_Tablet" (created if missing), never in one
# someone else set up. It sets a test screen lock PIN on that emulator, so the walkthrough also covers unlocking.
set -e
cd "$(dirname "$0")"
export ANDROID_HOME=${ANDROID_HOME:-$HOME/Library/Android/sdk}
SDK=$ANDROID_HOME
ADB=$SDK/platform-tools/adb
case "${1:-apk}" in
  core) exec ./gradlew :core:test ;;
  test) exec ./gradlew :app:testDebugUnitTest ;;
  lint) exec ./gradlew :app:lintDebug ;;
  apk) exec ./gradlew :app:assembleDebug ;;
  device) ./gradlew :app:assembleDebug && exec $ADB -d install -r app/build/outputs/apk/debug/app-debug.apk ;;
  ui) ;;
  *) echo "usage: $0 [core|test|lint|apk|ui|device]" >&2; exit 2 ;;
esac

AVD=${AVD:-AuthBackup_Phone}
case $AVD in
  AuthBackup_Tablet) PROFILE=pixel_tablet; PORT=5582 ;; # console ports in the range adb looks at (5555-5585)
  *) PROFILE=pixel_7; PORT=5580 ;;
esac
IMAGE="system-images;android-34;google_apis;arm64-v8a"
PIN=1234 # a test value for the script's own emulator only
SERIAL=emulator-$PORT
LANG_CODE=${UI_LANG:-en}
OUT=${UI_OUT:-build/ui-$LANG_CODE-${AVD#AuthBackup_}}
APP=com.authbackup.app
export ANDROID_SERIAL=$SERIAL

if ! $SDK/emulator/emulator -list-avds | grep -qx "$AVD"; then
  echo no | $SDK/cmdline-tools/latest/bin/avdmanager create avd -n "$AVD" -k "$IMAGE" -d "$PROFILE" >/dev/null
fi
mkdir -p build
EMU_LOG=build/emulator-$AVD.log
if ! $ADB devices | grep -q "^$SERIAL"; then
  $SDK/emulator/emulator -avd "$AVD" -port $PORT -no-window -no-audio -no-boot-anim -no-snapshot-save >"$EMU_LOG" 2>&1 &
fi
# Up to 5 minutes for the boot; a cold boot takes about 20 seconds on an Apple silicon Mac.
for i in {1..150}; do
  [ "$($ADB shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break
  if [ $i = 150 ]; then echo "$AVD did not boot; the last lines of $EMU_LOG:" >&2; tail -20 "$EMU_LOG" >&2; exit 1; fi
  sleep 2
done
# The test PIN, once per emulator; then wake the screen and get past the lock screen.
$ADB shell locksettings set-pin $PIN >/dev/null 2>&1 || true
$ADB shell input keyevent KEYCODE_WAKEUP
$ADB shell wm dismiss-keyguard
sleep 1
if $ADB shell dumpsys window | grep -q "mDreamingLockscreen=true\|isKeyguardShowing=true\|mShowingLockscreen=true"; then
  $ADB shell input text $PIN && $ADB shell input keyevent KEYCODE_ENTER
fi

./gradlew -q :app:assembleDebug :app:assembleDebugAndroidTest
$ADB install -r -t app/build/outputs/apk/debug/app-debug.apk >/dev/null
$ADB install -r -t app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk >/dev/null
rm -rf "$OUT" && mkdir -p "$OUT/screens"
RUNNER=$APP.test/androidx.test.runner.AndroidJUnitRunner

# The backup crypto on this device's own provider: the vectors' PBKDF2 (a non-ASCII password too), AES-GCM and backup files.
$ADB shell am instrument -w -e class $APP.DeviceCryptoTest $RUNNER | tee "$OUT/device-crypto.txt"
grep -q "^OK (3 tests)" "$OUT/device-crypto.txt" || { echo "DeviceCryptoTest failed: $OUT/device-crypto.txt" >&2; exit 1; }

$ADB shell pm clear $APP >/dev/null # no keys left from an earlier run
$ADB shell cmd locale set-app-locales $APP --locales $([ $LANG_CODE = ru ] && echo ru-RU || echo en-US)
$ADB shell settings put system accelerometer_rotation 0

$ADB shell rm -f /sdcard/walkthrough.mp4
$ADB shell screenrecord --bit-rate 6000000 /sdcard/walkthrough.mp4 & REC=$!
sleep 1
set +e
$ADB shell am instrument -w -e pin $PIN -e class $APP.WalkthroughTest $RUNNER | tee "$OUT/instrument.txt"
grep -q "^OK (1 test)" "$OUT/instrument.txt"; STATUS=$?
$ADB shell pkill -INT screenrecord; wait $REC 2>/dev/null; sleep 2
$ADB pull /sdcard/walkthrough.mp4 "$OUT/walkthrough.mp4" >/dev/null
$ADB pull /sdcard/Android/data/$APP/files/walkthrough/. "$OUT/screens" >/dev/null
[ -n "$KEEP" ] || $ADB emu kill >/dev/null
echo "screenshots and video: $OUT"
exit $STATUS
