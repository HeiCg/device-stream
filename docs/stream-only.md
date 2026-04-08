# @device-stream/stream-only

Stream device screens to browsers via WebSocket. No control APIs — just video.

## Supported Platforms

- **Android** — H.264 via scrcpy (requires ADB server running)
- **iOS Simulator** — MJPEG via ScreenCaptureKit (requires sim-capture binary built)

## Quick Start

```bash
npm install @device-stream/stream-only
```

```typescript
import { createStreamServer } from '@device-stream/stream-only';

const server = await createStreamServer({ port: 3456 });

// List available devices
const devices = await server.listDevices();
console.log(devices);

// Start streaming a device
await server.startStream(devices[0].serial);

// Browsers connect via WebSocket:
//   /stream/{serial}
//
// Protocol:
//   1. Server sends { type: 'metadata', codec, width, height }
//   2. Server sends continuous frame messages
//   3. On disconnect: { type: 'device_disconnected', deviceId }
```

## API

### `createStreamServer(options?)`

Creates and starts the stream server.

| Option | Type     | Default     | Description         |
|--------|----------|-------------|---------------------|
| `port` | `number` | `3456`      | Server port         |
| `host` | `string` | `'0.0.0.0'` | Bind address        |

### `StreamServer`

| Method            | Returns               | Description                          |
|-------------------|-----------------------|--------------------------------------|
| `listDevices()`   | `Promise<StreamDevice[]>` | List all available devices       |
| `startStream(serial)` | `Promise<StreamInfo>` | Start streaming a device         |
| `stopStream(serial)`  | `Promise<void>`      | Stop streaming a device          |
| `activeStreams()`  | `StreamInfo[]`        | List active streams                  |
| `close()`         | `Promise<void>`       | Shutdown everything                  |

### REST

`GET /devices` — Returns `StreamDevice[]` as JSON.

### WebSocket

Connect to `/stream/{serial}` to receive frames.

## Prerequisites

- **Android**: ADB server running (`adb start-server`)
- **iOS Simulator**: `sim-capture` binary built (`npm run build:sim-capture` from repo root)
