#!/usr/bin/env bash
set -euo pipefail

# Check if APKs exist, build if not.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GRADLE_DIR="$PACKAGE_DIR/gradle-project"

APP_APK="$GRADLE_DIR/app/build/outputs/apk/debug/app-debug.apk"
TEST_APK="$GRADLE_DIR/server/build/outputs/apk/androidTest/debug/server-debug-androidTest.apk"

if [[ -f "$APP_APK" && -f "$TEST_APK" ]]; then
  echo "APKs already built:"
  echo "  App:  $APP_APK"
  echo "  Test: $TEST_APK"
  exit 0
fi

echo "APKs not found, building..."
bash "$SCRIPT_DIR/build.sh"
