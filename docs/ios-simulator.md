# @device-stream/ios-simulator

iOS Simulator streaming via ScreenCaptureKit (sim-capture) + polling fallback.

## System Requirements

| Requirement | Details |
|-------------|---------|
| **OS** | macOS only |
| **Xcode** | Required (for `xcrun simctl`) |
| **Swift** | 5.9+ (included with Xcode, for building sim-capture) |

## How It Works

### sim-capture (Primary)

`sim-capture` is a Swift CLI binary that uses ScreenCaptureKit to capture the simulator window at up to 30fps. It outputs JPEG frames via a binary protocol on stdout, which the `CaptureService` parses and relays to consumers.

```
┌─────────────────────────────────────────────────────────────┐
│  iOS Simulator                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Simulator Window                                      │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           │ ScreenCaptureKit
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  sim-capture binary                                         │
│  ├─ ScreenCaptureKit (captures window at 30fps)             │
│  ├─ JPEG encoding (configurable quality + scale)            │
│  └─ Binary protocol → stdout                                │
└─────────────────────────────────────────────────────────────┘
                           │ Binary protocol (stdout)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  CaptureService (Node.js)                                   │
│  ├─ Spawns sim-capture process                              │
│  ├─ Parses binary header + JPEG frames                      │
│  └─ Emits 'frame' events → WebSocket / consumers            │
└─────────────────────────────────────────────────────────────┘
```

### Polling Fallback

If sim-capture is not available, the service falls back to polling screenshots at ~15fps using `xcrun simctl io screenshot`.

## Setup

### 1. Build sim-capture

```bash
cd device-stream
npm run build:sim-capture
```

This builds the `sim-capture` Swift binary at `tools/sim-capture/.build/release/sim-capture`.

### 2. Install Dependencies

```bash
npm install @device-stream/ios-simulator
```

## Usage

### Basic Example

```typescript
import {
  IOSSimulatorManager,
  SimulatorStreamService,
  CaptureService,
  createCaptureService,
} from '@device-stream/ios-simulator';
import { WebSocketServer } from 'ws';

// Create manager
const manager = new IOSSimulatorManager({
  bootTimeout: 120000,
});

// Create simulator
const device = await manager.createDevice({
  platform: 'ios',
  deviceType: 'com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro',
});

// Boot simulator
await manager.startDevice(device.id);

// Stream via ScreenCaptureKit
const capture = createCaptureService();
capture.on('frame', (udid, jpegBuffer) => {
  // Forward to WebSocket clients, save to disk, etc.
});
await capture.start(device.id, { fps: 30, quality: 80, scale: 1 });

// Or use WebSocket relay
const streamService = new SimulatorStreamService();

const wss = new WebSocketServer({ port: 5001 });
wss.on('connection', (ws, req) => {
  const url = new URL(req.url!, `ws://${req.headers.host}`);
  const deviceId = url.searchParams.get('deviceId');

  if (url.pathname === '/ws/mirror/device') {
    streamService.handleDeviceConnection(ws, deviceId!);
  } else if (url.pathname === '/ws/mirror/browser') {
    streamService.handleBrowserConnection(ws, deviceId!);
  }
});
```

### Using Polling Fallback

```typescript
const streamService = new SimulatorStreamService();

// Start polling mode (15fps screenshots)
await streamService.startPollingFallback(deviceId, browserWebSocket);
```

## API Reference

### IOSSimulatorManager

```typescript
class IOSSimulatorManager extends EventEmitter {
  constructor(options?: IOSSimulatorManagerOptions);

  // Simulator lifecycle
  createDevice(options: CreateDeviceOptions): Promise<FarmDevice>;
  startDevice(deviceId: string): Promise<FarmDevice>;
  stopDevice(deviceId: string): Promise<void>;
  deleteDevice(deviceId: string): Promise<void>;

  // Streaming
  startStreaming(deviceId: string, serverHost?: string, serverPort?: number): Promise<StreamResult>;
  stopStreaming(deviceId: string): Promise<void>;

  // App management
  installApp(deviceId: string, appPath: string): Promise<InstallAppResult>;
  launchApp(deviceId: string, bundleId: string): Promise<boolean>;
  terminateApp(deviceId: string, bundleId: string): Promise<boolean>;

  // Device management
  getDevice(deviceId: string): FarmDevice | undefined;
  getAllDevices(): FarmDevice[];
  killAll(): Promise<void>;
  cleanup(): Promise<void>;

  // Runtime info
  listDeviceTypes(): Promise<string[]>;
  listRuntimes(): Promise<SimctlRuntime[]>;
  listExistingSimulators(): Promise<SimctlDevice[]>;
}
```

### CaptureService

```typescript
class CaptureService extends EventEmitter {
  start(udid: string, options?: { fps?: number; quality?: number; scale?: 1 | 2 | 4 }): Promise<void>;
  stop(udid: string): void;
  stopAll(): void;

  // Events
  on('frame', (udid: string, jpeg: Buffer) => void): this;
}
```

### SimulatorStreamService

```typescript
class SimulatorStreamService {
  // WebSocket handlers
  handleDeviceConnection(ws: WebSocket, deviceId: string): void;
  handleBrowserConnection(ws: WebSocket, deviceId: string): void;

  // Polling fallback
  startPollingFallback(deviceId: string, ws: WebSocket): Promise<void>;

  // Status
  isDeviceConnected(deviceId: string): boolean;
  getConnectedDevices(): string[];
  getDeviceStats(deviceId: string): DeviceStats | null;

  // Cleanup
  cleanup(): void;
}
```

## Events

The `IOSSimulatorManager` emits these events:

| Event | Payload | Description |
|-------|---------|-------------|
| `device:creating` | `FarmDevice` | Device creation started |
| `device:created` | `FarmDevice` | Device created successfully |
| `device:booting` | `FarmDevice` | Device boot started |
| `device:ready` | `FarmDevice` | Device fully booted |
| `device:stopping` | `FarmDevice` | Device shutdown started |
| `device:stopped` | `FarmDevice` | Device shut down |
| `device:busy` | `{ device, taskId }` | Device marked as busy |
| `device:released` | `FarmDevice` | Device released from task |
| `device:error` | `{ device, error }` | Error occurred |

## Troubleshooting

### sim-capture not working

1. Check that sim-capture is built: `ls tools/sim-capture/.build/release/sim-capture`
2. Verify the simulator is booted: `xcrun simctl list devices | grep Booted`
3. On first run, macOS may prompt for Screen Recording permission — grant it

### Low FPS with polling

Polling mode is limited to ~15fps due to screenshot capture overhead. For 30fps, build and use sim-capture.

## Limitations

- macOS only (requires Xcode + ScreenCaptureKit)
- sim-capture requires building from source (`swift build`)
- Polling fallback: ~15fps vs sim-capture 30fps
