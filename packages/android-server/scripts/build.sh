#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GRADLE_DIR="$PACKAGE_DIR/gradle-project"

echo "=== @device-stream/android-server build ==="

if [[ -z "${ANDROID_HOME:-}" ]]; then
  if [[ -d "$HOME/Library/Android/sdk" ]]; then
    export ANDROID_HOME="$HOME/Library/Android/sdk"
  else
    echo "ERROR: ANDROID_HOME is not set"
    exit 1
  fi
fi

cd "$GRADLE_DIR"
chmod +x gradlew

echo "Building app APK..."
./gradlew :app:assembleDebug --quiet

echo "Building test APK (instrumentation server)..."
./gradlew :server:assembleDebugAndroidTest --quiet

APP_APK="$GRADLE_DIR/app/build/outputs/apk/debug/app-debug.apk"
TEST_APK="$GRADLE_DIR/server/build/outputs/apk/androidTest/debug/server-debug-androidTest.apk"

if [[ -f "$APP_APK" && -f "$TEST_APK" ]]; then
  echo ""
  echo "Build successful!"
  echo "  App APK:  $APP_APK"
  echo "  Test APK: $TEST_APK"
else
  echo "ERROR: Build failed - APKs not found"
  exit 1
fi
