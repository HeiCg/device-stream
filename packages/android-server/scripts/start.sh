#!/usr/bin/env bash
set -euo pipefail

# Start the Android Device Server on a connected device.
#
# Usage:
#   npm run start                    # uses first connected device
#   npm run start -- emulator-5554   # specific device

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GRADLE_DIR="$PACKAGE_DIR/gradle-project"
PORT="${DEVICE_SERVER_PORT:-9008}"

APP_APK="$GRADLE_DIR/app/build/outputs/apk/debug/app-debug.apk"
TEST_APK="$GRADLE_DIR/server/build/outputs/apk/androidTest/debug/server-debug-androidTest.apk"

# Check APKs exist
if [[ ! -f "$APP_APK" || ! -f "$TEST_APK" ]]; then
  echo "APKs not found. Building first..."
  bash "$SCRIPT_DIR/build.sh"
fi

# Determine device serial
if [ -n "${1:-}" ]; then
  SERIAL="$1"
else
  SERIAL=$(adb devices | grep -w 'device' | head -1 | awk '{print $1}')
  if [ -z "$SERIAL" ]; then
    echo "Error: No Android device connected"
    exit 1
  fi
fi

echo "=== @device-stream/android-server ==="
echo "Device: $SERIAL"
echo "Port:   $PORT"
echo ""

# Install
echo "Installing APKs..."
adb -s "$SERIAL" install -r -t "$APP_APK" 2>/dev/null || true
adb -s "$SERIAL" install -r -t "$TEST_APK" 2>/dev/null || true

# Port forward
echo "Setting up port forward (tcp:$PORT -> tcp:$PORT)..."
adb -s "$SERIAL" forward "tcp:$PORT" "tcp:$PORT"

# Start
echo ""
echo "Server: http://localhost:$PORT"
echo "Test:   curl http://localhost:$PORT/ping"
echo ""
echo "Press Ctrl+C to stop"
echo "---"

adb -s "$SERIAL" shell am instrument -w \
  -e class com.fromapptoviral.deviceserver.DeviceServerInstrumentation \
  -e port "$PORT" \
  com.fromapptoviral.deviceserver.test/androidx.test.runner.AndroidJUnitRunner
