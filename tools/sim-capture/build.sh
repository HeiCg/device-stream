#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "[sim-capture] Building release binary..."
swift build -c release 2>&1

BINARY=".build/release/sim-capture"

# On ARM64 Macs, swift build places the binary under .build/arm64-apple-macosx/release/
# Create a symlink so the expected path always works.
if [ ! -f "$BINARY" ]; then
    ARCH_BINARY=$(find .build -path '*/release/sim-capture' -not -path '*/release/sim-capture.build/*' 2>/dev/null | head -1)
    if [ -n "$ARCH_BINARY" ]; then
        mkdir -p "$(dirname "$BINARY")"
        ln -sf "$(cd "$(dirname "$ARCH_BINARY")" && pwd)/sim-capture" "$BINARY"
        echo "[sim-capture] Created symlink: $BINARY -> $ARCH_BINARY"
    fi
fi

if [ -f "$BINARY" ]; then
    echo "[sim-capture] Build successful: $SCRIPT_DIR/$BINARY"
    echo "[sim-capture] Size: $(du -h "$BINARY" | cut -f1)"
else
    echo "[sim-capture] Build failed: binary not found"
    exit 1
fi
