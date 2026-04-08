# `@device-stream/stream-only` — Design Spec

## Purpose

Standalone package that streams device screens to browsers via WebSocket. No control APIs (tap, type, swipe), no session management, no mutex. Target audience: developers who only need to view device screens in a browser.

## Supported Platforms

- Android (via scrcpy H.264)
- iOS Simulator (via sim-capture MJPEG/ScreenCaptureKit)

iOS physical device is excluded from initial scope.

## Public API

```typescript
import { createStreamServer } from '@device-stream/stream-only';

const server = await createStreamServer({ port: 3456 });

// Discovery
const devices = await server.listDevices();
// → [{ serial: 'emulator-5554', name: 'Pixel 7', platform: 'android',
//      screenWidth: 1080, screenHeight: 1920 },
//    { serial: 'ABCD-1234', name: 'iPhone 15 Pro', platform: 'ios-simulator',
//      screenWidth: 1170, screenHeight: 2532 }]

// Start/stop streaming
await server.startStream('emulator-5554');
await server.stopStream('emulator-5554');

// Introspection
const active = server.activeStreams();
// → [{ serial: 'emulator-5554', platform: 'android', codec: 'h264' }]

// Shutdown
await server.close();
```

### `createStreamServer(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `3456` | HTTP + WebSocket server port |
| `host` | `string` | `'0.0.0.0'` | Bind address |

Returns `Promise<StreamServer>`.

### `StreamServer` methods

| Method | Returns | Description |
|--------|---------|-------------|
| `listDevices()` | `Promise<StreamDevice[]>` | Lists all available Android + iOS Simulator devices |
| `startStream(serial)` | `Promise<StreamInfo>` | Starts capture and enables WS connections for the device |
| `stopStream(serial)` | `Promise<void>` | Stops capture and disconnects all WS clients for the device |
| `activeStreams()` | `StreamInfo[]` | Returns currently active streams |
| `close()` | `Promise<void>` | Stops all streams, closes HTTP + WS server |

### Types

```typescript
interface StreamDevice {
  serial: string;
  platform: 'android' | 'ios-simulator';
  name: string;
  screenWidth: number;
  screenHeight: number;
}

interface StreamInfo {
  serial: string;
  platform: 'android' | 'ios-simulator';
  codec: 'h264' | 'mjpeg';
  width: number;
  height: number;
}
```

## WebSocket Endpoint

Clients connect to the WebSocket endpoint at `/stream/{serial}` to receive frames. The server binds plain HTTP/WS by default (suitable for local development); TLS termination is left to a reverse proxy in production.

Protocol reuses `@device-stream/core` message format:

1. On connect, server sends a `metadata` message: `{ type: 'metadata', codec, codecName, width, height, fps }`
2. Server sends continuous frame messages:
   - Android (H.264): `{ type: 'data', data: '<base64>', keyframe: boolean, pts: '<bigint>' }`
   - iOS Simulator (MJPEG): `{ type: 'frame', data: '<base64 jpeg>', pts: number, codec: 'mjpeg' }`
3. If the stream ends, server sends `{ type: 'device_disconnected', deviceId: serial }` and closes the WS.

If the stream for a serial hasn't been started yet when a WS client connects, the connection is held and frames begin once `startStream()` is called. This allows "connect first, start later" patterns.

## REST Endpoint

`GET /devices` returns `StreamDevice[]` as JSON. Convenience for HTTP-based discovery before opening a WebSocket.

## Package Structure

```
packages/stream-only/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # exports: createStreamServer, StreamServer, types
    ├── stream-server.ts      # StreamServer class — HTTP server, WS upgrade, routing
    ├── android-streamer.ts   # wraps AndroidDeviceService.listDevices() + ScrcpyService
    └── simulator-streamer.ts # wraps simctl discovery + CaptureService + SimulatorStreamService
```

### `stream-server.ts`

- Creates an `http.Server` and a `ws.WebSocketServer` (noServer mode, manual upgrade handling).
- Routes upgrade requests matching `/stream/:serial` to the correct platform streamer.
- Manages lifecycle: tracks active streams, handles WS client connect/disconnect, graceful shutdown.
- Serves `GET /devices` as a simple JSON response.

### `android-streamer.ts`

- Uses `AndroidDeviceService.listDevices()` for discovery (requires ADB server running).
- Uses `AndroidDeviceService.connect()` to get an ADB transport, then `ScrcpyService.startStream()` to pipe H.264 frames to WS clients.
- On `stopStream`, calls `ScrcpyService.stopStream()` and disconnects ADB.
- Supports multiple browser clients per device by creating one scrcpy session and broadcasting to all connected WS clients (the current ScrcpyService sends to a single WS — we'll add a broadcast layer).

### `simulator-streamer.ts`

- Uses `xcrun simctl list devices available` (via `child_process`) for discovery — no dependency on `appium-ios-simulator` (that's for lifecycle management, not needed for stream-only).
- Uses `CaptureService.startCapture()` + `SimulatorStreamService` for frame relay to multiple browsers.
- This path already supports multi-browser broadcast natively.

## Dependencies

```json
{
  "dependencies": {
    "@device-stream/core": "^1.1.0",
    "@device-stream/android": "^1.1.0",
    "@device-stream/ios-simulator": "^1.1.0",
    "ws": "^8.16.0"
  }
}
```

Note: `@device-stream/android` pulls in all TangoADB/scrcpy deps. `@device-stream/ios-simulator` pulls in `appium-ios-simulator` (unused at runtime for stream-only, but it's a transitive dep). We accept this for v1 — extracting a lighter simulator discovery path is a future optimization.

## What This Package Does NOT Include

- No `tap()`, `typeText()`, `pressKey()`, `swipe()`, `scroll()` methods
- No `DeviceMutexManager` usage
- No WDA session management
- No iOS physical device support
- No browser-side rendering code
- No built-in HTML viewer page

## Integration with Root Monorepo

- Add `"build:stream-only": "npm run build -w @device-stream/stream-only"` to root `package.json` scripts.
- Update root `build` script to include `stream-only` in the parallel build step (it depends on core, android, ios-simulator which build first).
- Add documentation in `docs/stream-only.md`.

## Android Multi-Client Broadcasting

The current `ScrcpyService.startStream()` accepts a single `WebSocket` and pipes frames directly to it. For stream-only, we need to support multiple browser clients viewing the same device simultaneously.

Approach: `android-streamer.ts` will create a lightweight broadcast wrapper. Instead of passing a real WS to `ScrcpyService`, it will:

1. Create a `ScrcpyService` session that pipes frames to an internal callback.
2. Maintain a `Set<WebSocket>` of connected browsers per device.
3. Broadcast each frame to all connected browsers.

This requires a small refactor of `ScrcpyService` to support a callback-based frame delivery (similar to how `CaptureService` already works via `setFrameCallback`). We'll add a `startStreamWithCallback()` method to `ScrcpyService` alongside the existing `startStream()` to avoid breaking the existing API.
