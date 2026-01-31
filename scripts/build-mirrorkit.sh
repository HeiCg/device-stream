#!/bin/bash
# Build MirrorKit iOS app for simulator

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MIRRORKIT_DIR="${PROJECT_DIR}/mirrorkit"

echo "Building MirrorKit..."

if [ ! -d "${MIRRORKIT_DIR}" ]; then
    echo "Error: MirrorKit source not found at ${MIRRORKIT_DIR}"
    echo "Make sure the mirrorkit/ directory contains the Xcode project."
    exit 1
fi

cd "${MIRRORKIT_DIR}"

# Check for Xcode
if ! command -v xcodebuild &> /dev/null; then
    echo "Error: Xcode not found. Please install Xcode from the App Store."
    exit 1
fi

# Build for simulator (arm64 + x86_64)
echo "Building for iOS Simulator..."
xcodebuild \
    -project MirrorKit.xcodeproj \
    -scheme MirrorKit \
    -sdk iphonesimulator \
    -configuration Release \
    -derivedDataPath ./build \
    ONLY_ACTIVE_ARCH=NO \
    clean build

BUILD_PATH="${MIRRORKIT_DIR}/build/Build/Products/Release-iphonesimulator/MirrorKit.app"

if [ -d "${BUILD_PATH}" ]; then
    echo ""
    echo "✓ MirrorKit built successfully!"
    echo "  Location: ${BUILD_PATH}"
    echo ""
    echo "To install on a simulator:"
    echo "  xcrun simctl install <device-id> ${BUILD_PATH}"
else
    echo "Error: Build output not found at ${BUILD_PATH}"
    exit 1
fi
