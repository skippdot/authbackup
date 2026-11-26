#!/bin/zsh
# Builds and tests AuthBackup for iOS. Usage: ./build.sh [core|sim|test|ui|device]
#   core   - the OTP core against tests/vectors/core.json (swift test, no simulator; run on every core change)
#   sim    - the app for the simulator
#   test   - the app's unit tests in the simulator
#   ui     - the UI walkthrough with screenshots and a video, from a reset Keychain (UI_LANG=ru for Russian);
#            results in build/ui-<lang>/ (UI_OUT overrides)
#   device - a signed build for a connected device: DEVELOPMENT_TEAM=<Apple team ID> in the environment or in
#            local.env next to this script (not committed)
# sim, test and ui run in the script's own "AuthBackup iPhone 17" simulator (created if missing), never in one someone
# else set up; SIM_ID=<udid> picks another one, for example an iPad.
set -e
cd "$(dirname "$0")"
if [ -f local.env ]; then source local.env; fi
case "${1:-sim}" in
  core) cd Core && swift test; exit ;;
esac
xcodegen generate --quiet
own_sim() {
  local id=$(xcrun simctl list devices available | grep -F "AuthBackup iPhone 17 (" | head -1 | grep -oE "[0-9A-F-]{36}")
  [ -n "$id" ] || id=$(xcrun simctl create "AuthBackup iPhone 17" "iPhone 17")
  echo "$id"
}
[ "${1:-sim}" = device ] || SIM_ID=${SIM_ID:-$(own_sim)}
case "${1:-sim}" in
  sim)    xcodebuild -project AuthBackup.xcodeproj -scheme AuthBackup -destination "id=$SIM_ID" -configuration Debug -derivedDataPath build/dd build ;;
  test)   xcodebuild -project AuthBackup.xcodeproj -scheme AuthBackup -destination "id=$SIM_ID" -derivedDataPath build/dd test ;;
  ui)
    LANG_CODE=${UI_LANG:-en}
    OUT=${UI_OUT:-build/ui-$LANG_CODE}
    rm -rf "$OUT" && mkdir -p "$OUT"
    xcrun simctl boot "$SIM_ID" 2>/dev/null || true
    xcrun simctl keychain "$SIM_ID" reset   # no keys left from an earlier run
    # The simulator counts as having a passcode, so the app starts locked: enroll Face ID and keep answering
    # "matching face" (what Simulator > Features > Face ID does), so the walkthrough also covers unlocking.
    xcrun simctl spawn "$SIM_ID" notifyutil -s com.apple.BiometricKit.enrollmentChanged 1
    xcrun simctl spawn "$SIM_ID" notifyutil -p com.apple.BiometricKit.enrollmentChanged
    ( while true; do xcrun simctl spawn "$SIM_ID" notifyutil -p com.apple.BiometricKit_Sim.pearl.match; sleep 1; done ) & FACE=$!
    xcrun simctl io "$SIM_ID" recordVideo --force "$OUT/walkthrough.mp4" & REC=$!
    set +e
    # TEST_RUNNER_ variables reach the test process without the prefix.
    TEST_RUNNER_UI_LANG=$LANG_CODE xcodebuild -project AuthBackup.xcodeproj -scheme AuthBackupUI -destination "id=$SIM_ID" -derivedDataPath build/dd -resultBundlePath "$OUT/result.xcresult" test
    STATUS=$?
    kill -INT $REC; wait $REC 2>/dev/null
    kill $FACE 2>/dev/null
    xcrun xcresulttool export attachments --path "$OUT/result.xcresult" --output-path "$OUT/screens" >/dev/null
    echo "screenshots and video: $OUT"
    exit $STATUS ;;
  device) xcodebuild -project AuthBackup.xcodeproj -scheme AuthBackup -destination "generic/platform=iOS" -configuration Debug -derivedDataPath build/dd -allowProvisioningUpdates \
            DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM:?set DEVELOPMENT_TEAM (your Apple team ID) in the environment or in ios/local.env}" build ;;
  *) echo "usage: $0 [core|sim|test|ui|device]" >&2; exit 2 ;;
esac
