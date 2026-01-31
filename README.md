# @device-stream

Modular npm packages for mobile device video streaming - iOS simulators, iOS physical devices, and Android devices.

## Packages

| Package | Description | Platform |
|---------|-------------|----------|
| [@device-stream/core](./packages/core) | Shared types, interfaces, and utilities | All |
| [@device-stream/ios-simulator](./packages/ios-simulator) | iOS Simulator streaming via MirrorKit + polling | macOS |
| [@device-stream/ios-device](./packages/ios-device) | iOS physical device streaming via WDA MJPEG | macOS |
| [@device-stream/android](./packages/android) | Android streaming via TangoADB + scrcpy | All |

## Quick Start

```bash
# Enter the device-stream directory
cd device-stream

# Install dependencies
npm install

# Build all packages
npm run build

# Build MirrorKit for iOS Simulator (macOS only)
npm run build:mirrorkit
```

## Documentation

- [Getting Started](./docs/README.md)
- [iOS Simulator Streaming](./docs/ios-simulator.md)
- [iOS Device Streaming](./docs/ios-device.md)
- [Android Streaming](./docs/android.md)

## Architecture

```
device-stream/
├── packages/
│   ├── core/                    # @device-stream/core
│   │   └── src/
│   │       ├── types.ts         # Shared types
│   │       ├── interfaces.ts    # DeviceService interface
│   │       ├── protocol.ts      # WebSocket protocol
│   │       └── mutex.ts         # Thread-safety utilities
│   │
│   ├── ios-simulator/           # @device-stream/ios-simulator
│   │   └── src/
│   │       ├── simulator-manager.ts   # Simulator lifecycle
│   │       └── stream-service.ts      # WebSocket relay
│   │
│   ├── ios-device/              # @device-stream/ios-device
│   │   └── src/
│   │       ├── device-service.ts      # Main service
│   │       ├── go-ios-client.ts       # go-ios CLI wrapper
│   │       ├── wda-client.ts          # WebDriverAgent HTTP client
│   │       ├── mjpeg-client.ts        # MJPEG stream parser
│   │       └── quicktime-capture.ts   # H.264 fallback
│   │
│   └── android/                 # @device-stream/android
│       └── src/
│           ├── device-service.ts      # Main service
│           ├── scrcpy-service.ts      # Scrcpy streaming
│           └── scrcpy-setup.ts        # Server deployment
│
├── mirrorkit/                   # MirrorKit Swift source
│   ├── MirrorKit/               # App source
│   └── MirrorKit.xcodeproj/     # Xcode project
│
├── scripts/
│   └── build-mirrorkit.sh       # Build MirrorKit
│
└── docs/                        # Documentation
```

## System Requirements

### iOS Simulator
- macOS
- Xcode (for xcrun simctl)

### iOS Physical Device
- macOS
- go-ios (`brew install go-ios`)
- WebDriverAgent (signed and installed)
- qvh (optional, for H.264 fallback)

### Android
- macOS, Linux, or Windows
- ADB (`adb` in PATH)

## License

MIT
